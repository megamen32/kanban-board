import { normalizeDueAt, dueAtTimestamp, formatDueAt } from './due-at';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { createCard, readCardFile, updateCard } from './file-store';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-due-at-'));

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('Kanban dueAt contract', () => {
  test('round-trips an explicit dueAt and allows clearing it', () => {
    const dueAt = '2030-01-02T03:04:05.000Z';
    const created = createCard('Due task', '', 'todo', 'medium', [], 'alpha', [], root, dueAt);
    expect(readCardFile(path.join(root, created.fileName), root)?.dueAt).toBe(dueAt);

    const cleared = updateCard(created.id, { dueAt: null }, undefined, root);
    expect('conflict' in cleared ? cleared : cleared.dueAt).toBeUndefined();
  });
});

describe('date-only deadlines', () => {
  test('stores a calendar date without inventing a time, including leap days', () => {
    const dueAt = normalizeDueAt('2032-02-29')!;
    expect(dueAt).toBe('2032-02-29');
    const created = createCard('Calendar task', '', 'todo', 'medium', [], 'alpha', [], root, dueAt);
    expect(readCardFile(path.join(root, created.fileName), root)?.dueAt).toBe(dueAt);
    const updated = updateCard(created.id, { dueAt: normalizeDueAt('2030-01-02') }, undefined, root);
    expect('conflict' in updated ? updated : updated.dueAt).toBe('2030-01-02');
  });

  test.each(['2030-02-29', '2030-02-30', '2030-04-31', '2030-13-01', '2030-00-10', '0000-01-01'])('rejects invalid calendar date %s', value => {
    expect(() => normalizeDueAt(value)).toThrow();
    expect(Number.isNaN(dueAtTimestamp(value))).toBe(true);
  });

  test('preserves timestamp normalization and nullable clearing', () => {
    expect(normalizeDueAt('2030-01-02T10:30:00+03:00')).toBe('2030-01-02T07:30:00.000Z');
    expect(normalizeDueAt(undefined)).toBeUndefined();
    expect(normalizeDueAt(null, true)).toBeNull();
  });

  test('uses the end of the Moscow day only for ordering and reminders', () => {
    const deadline = dueAtTimestamp('2030-01-02');
    expect(deadline).toBe(Date.parse('2030-01-02T20:59:59.999Z'));
    expect(deadline).toBeGreaterThan(Date.parse('2030-01-02T20:59:59.998Z'));
    expect(deadline).toBeLessThan(Date.parse('2030-01-02T21:00:00Z'));
    expect(dueAtTimestamp('2030-01-02T10:30:00+03:00')).toBe(Date.parse('2030-01-02T07:30:00Z'));
  });

  test('formats a date-only deadline without an hour or timezone date shift', () => {
    const label = formatDueAt('2030-01-02', {
      day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
      timeZone: 'America/Los_Angeles',
    });
    expect(label).toContain('02 января 2030');
    expect(label).not.toMatch(/\d{2}:\d{2}/);
  });
});
