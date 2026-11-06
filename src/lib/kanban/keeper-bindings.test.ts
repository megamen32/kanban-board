import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  acquireCalendarSyncLock,
  calendarSyncKey,
  calendarSyncLockPath,
  keeperBindingStore,
  withCalendarSyncLock,
  type CalendarSyncRecord,
} from './keeper-bindings';

let authDir: string;

const bound = (eventId: string): CalendarSyncRecord => ({
  state: 'bound',
  eventId,
  startTime: '2026-11-09T10:00:00.000Z',
  endTime: '2026-11-09T11:00:00.000Z',
  titleHash: 'a'.repeat(64),
  syncedAt: '2026-11-06T18:00:00.000Z',
});

beforeEach(() => {
  authDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-bindings-'));
  process.env.KANBAN_AUTH_DIR = authDir;
});

afterEach(() => {
  fs.rmSync(authDir, { recursive: true, force: true });
  delete process.env.KANBAN_AUTH_DIR;
});

describe('per-user binding records (one file per user+card)', () => {
  test('set/get/clear round-trips bound and pending records', () => {
    expect(keeperBindingStore.get('nikita', 'card-1')).toBeNull();
    keeperBindingStore.set('nikita', 'card-1', bound('evt_1'));
    expect(keeperBindingStore.get('nikita', 'card-1')).toMatchObject({ state: 'bound', eventId: 'evt_1' });
    expect(keeperBindingStore.clear('nikita', 'card-1')).toBe(true);
    expect(keeperBindingStore.get('nikita', 'card-1')).toBeNull();
    expect(keeperBindingStore.clear('nikita', 'card-1')).toBe(false);

    keeperBindingStore.set('nikita', 'card-1', { state: 'pending', phase: 'create', startedAt: '2026-11-06T18:00:00.000Z' });
    expect(keeperBindingStore.get('nikita', 'card-1')).toMatchObject({ state: 'pending', phase: 'create' });
  });

  test('records of different users never mix even for the same card', () => {
    keeperBindingStore.set('nikita', 'card-1', bound('evt_nikita'));
    expect(keeperBindingStore.get('oleg', 'card-1')).toBeNull();
    keeperBindingStore.set('oleg', 'card-1', bound('evt_oleg'));
    expect(keeperBindingStore.get('nikita', 'card-1')).toMatchObject({ eventId: 'evt_nikita' });
    expect(keeperBindingStore.get('oleg', 'card-1')).toMatchObject({ eventId: 'evt_oleg' });
    keeperBindingStore.clear('nikita', 'card-1');
    expect(keeperBindingStore.get('oleg', 'card-1')).toMatchObject({ eventId: 'evt_oleg' });
  });

  test('JSON keys cannot collide across usernames containing the separator', () => {
    expect(calendarSyncKey('a::b', 'c')).not.toBe(calendarSyncKey('a', 'b::c'));
  });

  test('concurrent writes for different users/cards never lose a record', async () => {
    const writes: Promise<void>[] = [];
    for (let i = 0; i < 20; i++) {
      writes.push(Promise.resolve().then(() => keeperBindingStore.set('nikita', `card-${i % 2}`, bound(`evt_n${i}`))));
      writes.push(Promise.resolve().then(() => keeperBindingStore.set('oleg', `card-${i % 2}`, bound(`evt_o${i}`))));
    }
    await Promise.all(writes);
    expect(keeperBindingStore.get('nikita', 'card-0')).toMatchObject({ state: 'bound' });
    expect(keeperBindingStore.get('nikita', 'card-1')).toMatchObject({ state: 'bound' });
    expect(keeperBindingStore.get('oleg', 'card-0')).toMatchObject({ state: 'bound' });
    expect(keeperBindingStore.get('oleg', 'card-1')).toMatchObject({ state: 'bound' });
  });

  test('a corrupt or malformed record fails closed instead of looking empty', () => {
    const dir = path.join(authDir, 'calendar-bindings');
    fs.mkdirSync(dir, { recursive: true });
    const { createHash } = require('node:crypto') as typeof import('node:crypto');
    const file = path.join(dir, `${createHash('sha256').update(calendarSyncKey('nikita', 'card-1')).digest('hex')}.json`);
    fs.writeFileSync(file, '{broken');
    expect(() => keeperBindingStore.get('nikita', 'card-1')).toThrow('corrupt');
    fs.writeFileSync(file, JSON.stringify({ version: 1, record: { state: 'nonsense' } }));
    expect(() => keeperBindingStore.get('nikita', 'card-1')).toThrow('corrupt');
  });

  test('records live under the protected auth root only', () => {
    keeperBindingStore.set('nikita', 'card-1', bound('evt_1'));
    const listing = fs.readdirSync(path.join(authDir, 'calendar-bindings'));
    expect(listing).toHaveLength(1);
    expect(listing[0]).toMatch(/\.json$/);
    expect(listing[0]).not.toContain('nikita');
  });
});

describe('inter-process sync lock (mkdir, fail closed)', () => {
  test('acquire and release leave the lock reusable', () => {
    const first = acquireCalendarSyncLock('nikita', 'card-1');
    expect(first.acquired).toBe(true);
    if (first.acquired) first.release();
    const second = acquireCalendarSyncLock('nikita', 'card-1');
    expect(second.acquired).toBe(true);
    if (second.acquired) second.release();
  });

  test('a lock held by a live process refuses instead of allowing an unsafe create', () => {
    const lockPath = calendarSyncLockPath('nikita', 'card-1');
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.mkdirSync(lockPath);
    fs.writeFileSync(path.join(lockPath, 'lock.json'), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    const result = acquireCalendarSyncLock('nikita', 'card-1');
    expect(result).toEqual({ acquired: false, reason: 'held' });
    // No blind cleanup: the foreign lock dir is still there.
    expect(fs.existsSync(lockPath)).toBe(true);
  });

  test('fail closed on EEXIST even when the recorded holder pid is dead (no namespace-unsafe takeover)', () => {
    const dead = spawnSync('true');
    expect(typeof dead.pid).toBe('number');
    const lockPath = calendarSyncLockPath('nikita', 'card-1');
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.mkdirSync(lockPath);
    fs.writeFileSync(path.join(lockPath, 'lock.json'), JSON.stringify({ pid: dead.pid, startedAt: new Date().toISOString() }));
    expect(acquireCalendarSyncLock('nikita', 'card-1')).toEqual({ acquired: false, reason: 'held' });
    // The operator, not a heuristic, decides: the foreign lock dir survives.
    expect(fs.existsSync(lockPath)).toBe(true);
    fs.rmSync(lockPath, { recursive: true, force: true });
    expect(acquireCalendarSyncLock('nikita', 'card-1').acquired).toBe(true);
  });

  test('metadata-free fresh lock dirs fail closed', () => {
    const lockPath = calendarSyncLockPath('nikita', 'card-1');
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.mkdirSync(lockPath);
    expect(acquireCalendarSyncLock('nikita', 'card-1')).toEqual({ acquired: false, reason: 'held' });
  });

  test('in-process lock serializes operations on one key', async () => {
    const order: string[] = [];
    const run = (label: string, delay: number) => withCalendarSyncLock('nikita', 'card-1', async () => {
      order.push(`${label}-start`);
      await new Promise(resolve => setTimeout(resolve, delay));
      order.push(`${label}-end`);
    });
    await Promise.all([run('a', 20), run('b', 5)]);
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });
});
