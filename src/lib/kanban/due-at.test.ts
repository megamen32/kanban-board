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
