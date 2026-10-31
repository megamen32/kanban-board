import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { defaultGraphLayout, parseGraphLayoutChange, parseStoredGraphLayout } from './graph-layout-preferences';
import { readGraphLayout, updateGraphLayout } from './graph-layout-store';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-layout-'));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const alice = { username: 'qa-alice', scope: 'work' };
const bob = { username: 'qa-bob', scope: 'work' };

describe('cloud-backed personal graph layout', () => {
  it('keeps status grouping opt-in and persists it without changing the old positions', () => {
    const legacy = { ...defaultGraphLayout(), version: 1 } as Record<string, unknown>;
    delete legacy.groupByStatus;
    expect(parseStoredGraphLayout(legacy)?.groupByStatus).toBe(false);
    expect(parseGraphLayoutChange({ groupByStatus: 'yes' })).toBeNull();
    const actor = { username: 'qa-grouping', scope: 'work' };
    const initial = updateGraphLayout(root, actor, 0, {
      placement: { direction: 'vertical', values: { legacyTask: { x: 32, y: 160 } } },
    });
    expect(initial.layout.groupByStatus).toBe(false);
    const selected = updateGraphLayout(root, actor, 1, { groupByStatus: true, placement: {
      direction: 'vertical', values: { '["status-groups","Проект","t1"]': { x: 400, y: 160 } },
    } });
    expect(selected.layout.groupByStatus).toBe(true);
    expect(selected.layout.positions.vertical.legacyTask).toEqual({ x: 32, y: 160 });
    expect(readGraphLayout(root, actor).groupByStatus).toBe(true);
    expect(updateGraphLayout(root, actor, 2, { groupByStatus: false }).layout.positions.vertical.legacyTask)
      .toEqual({ x: 32, y: 160 });
  });

  it('round-trips positions from disk for the same account and never changes tasks', () => {
    fs.writeFileSync(path.join(root, 'existing-card.md'), 'unchanged task');
    const change = parseGraphLayoutChange({ direction: 'vertical', columns: 3, projectOrder: ['project-b', 'project-a'],
      placement: { direction: 'vertical', values: { card1: { x: 32, y: 800 } } } })!;
    const saved = updateGraphLayout(root, alice, 0, change);
    expect(saved.conflict).toBe(false);
    expect(saved.layout.version).toBe(1);
    expect(readGraphLayout(root, alice)).toEqual(saved.layout);
    expect(fs.readFileSync(path.join(root, 'existing-card.md'), 'utf8')).toBe('unchanged task');
    const file = fs.readdirSync(path.join(root, '.graph-layouts')).find(name => name.endsWith('.json'))!;
    expect(fs.statSync(path.join(root, '.graph-layouts', file)).mode & 0o777).toBe(0o600);
  });
  it('separates people and refuses a stale version from another tab', () => {
    expect(readGraphLayout(root, bob).version).toBe(0);
    const conflict = updateGraphLayout(root, alice, 0, { direction: 'horizontal' });
    expect(conflict.conflict).toBe(true);
    expect(conflict.layout.direction).toBe('vertical');
    const result = updateGraphLayout(root, alice, 1, { direction: 'horizontal', placement: { direction: 'horizontal', values: { card2: { x: 400, y: 64 } } } });
    expect(result.layout.positions.vertical.card1).toEqual({ x: 32, y: 800 });
    expect(result.layout.positions.horizontal.card2).toEqual({ x: 400, y: 64 });
    const reset = updateGraphLayout(root, alice, 2, { placement: { direction: 'vertical', values: { card1: null } } });
    expect(reset.layout.positions.vertical).toEqual({});
    expect(reset.layout.positions.horizontal.card2).toBeDefined();
  });
  it('rejects malformed coordinates, unknown fields and unsafe object keys', () => {
    expect(parseGraphLayoutChange({ username: 'other-user' })).toBeNull();
    expect(parseGraphLayoutChange({ columns: 99 })).toBeNull();
    expect(parseGraphLayoutChange({ placement: { direction: 'vertical', values: { node: { x: -1, y: 0 } } } })).toBeNull();
    expect(parseGraphLayoutChange({ placement: { direction: 'vertical', values: { node: { x: Infinity, y: 0 } } } })).toBeNull();
    expect(parseGraphLayoutChange(JSON.parse('{"placement":{"direction":"vertical","values":{"__proto__":{"x":0,"y":0}}}}'))).toBeNull();
  });
});
