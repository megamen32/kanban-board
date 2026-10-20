import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-store-'));
process.env.TASKS_DIR = root;
const store = await import('./file-store');
afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
  delete process.env.TASKS_DIR;
});

describe('filesystem kanban contract', () => {
  test('long Cyrillic titles keep complete content and bounded UTF-8 filenames on create and rename', () => {
    const title = 'Русская задача с подробным заголовком '.repeat(6);
    const created = store.createCard(title, 'Details', 'todo', 'medium', [], 'alpha', ['alice']);
    expect(Buffer.byteLength(created.fileName, 'utf8')).toBeLessThanOrEqual(255 - Buffer.byteLength(`.${Number.MAX_SAFE_INTEGER}.${'0'.repeat(36)}.tmp`, 'utf8'));
    expect(store.readCardFile(path.join(root, created.fileName))?.title).toBe(title);
    const history = [{ summary: 'Результат исполнителя', evidenceRefs: ['source:event:1'],
      submittedBy: 'fixture', submittedAt: '2026-10-20T12:00:00Z' }];
    const reviewHistory = [{ decision: 'rework' as const, actor: 'nikita',
      decidedAt: '2026-10-20T12:30:00Z', note: 'Уточнить итог' }];
    const annotated = store.updateCard(created.id, { resultHistory: history, reviewHistory }, created.version);
    if (!annotated || 'conflict' in annotated) throw new Error('history update failed');
    const renamed = title + ' обновлено';
    const updated = store.updateCard(created.id, { title: renamed }, annotated.version);
    if (!updated || 'conflict' in updated) throw new Error('rename failed');
    expect(updated.id).toBe(created.id);
    expect(updated.title).toBe(renamed);
    expect(updated.resultHistory).toEqual(history);
    expect(updated.reviewHistory).toEqual(reviewHistory);
    expect(Buffer.byteLength(updated.fileName, 'utf8')).toBeLessThanOrEqual(255 - Buffer.byteLength(`.${Number.MAX_SAFE_INTEGER}.${'0'.repeat(36)}.tmp`, 'utf8'));
    expect(store.readCardFile(path.join(root, updated.fileName))?.title).toBe(renamed);
    expect(store.readCardFile(path.join(root, updated.fileName))?.id).toBe(created.id);
  });

  test('same long title keeps distinct UUID filename collision keys', () => {
    const title = 'Повторяющийся длинный заголовок '.repeat(8);
    const first = store.createCard(title, 'First body', 'todo', 'medium', [], 'alpha', ['alice']);
    const second = store.createCard(title, 'Second body', 'todo', 'medium', [], 'alpha', ['alice']);
    expect(first.id).not.toBe(second.id);
    expect(first.fileName).not.toBe(second.fileName);
    expect(store.readCardFile(path.join(root, first.fileName))?.description).toBe('First body');
    expect(store.readCardFile(path.join(root, second.fileName))?.description).toBe('Second body');
  });
  test('scans markdown recursively and preserves nested relative files', async () => {
    fs.mkdirSync(path.join(root, 'projects', 'alpha'), { recursive: true });
    fs.writeFileSync(path.join(root, 'projects', 'alpha', 'nested.md'), `---\nid: nested-id\ntitle: Nested\nproject: alpha\n---\nBody`);

    const [card] = store.getAllCards();
    expect(card.id).toBe('nested-id');
    expect(card.fileName).toBe(path.join('projects', 'alpha', 'nested.md'));
  });

  test('does not ingest hidden repository or vault directories', async () => {
    for (const hidden of ['.git', '.obsidian', 'nested/.git']) {
      const directory = path.join(root, hidden);
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, 'hidden.md'), '---\nid: hidden\ntitle: Hidden\n---\nDo not ingest');
    }

    expect(store.getAllCards().some(card => card.id === 'hidden')).toBe(false);
  });

  test('round-trips required project and assignees', async () => {
    const created = store.createCard('Project task', 'Details', 'todo', 'high', ['tag'], 'alpha', ['alice', 'bob']);
    const loaded = store.readCardFile(path.join(store.getTasksDir(), created.fileName));
    expect(loaded?.project).toBe('alpha');
    expect(loaded?.assignees).toEqual(['alice', 'bob']);
  });

  test('rejects clearing the required project on update', async () => {
    const created = store.createCard('Required project', '', 'todo', 'medium', [], 'alpha');
    expect(() => store.updateCard(created.id, { project: '   ' }, created.version)).toThrow('project is required');
  });

  test('uses a safe legacy project fallback without inventing assignees', async () => {
    fs.writeFileSync(path.join(root, 'legacy.md'), `---\nid: legacy-id\ntitle: Legacy\ncolumn: inbox\n---\nLegacy body`);
    const card = store.readCardFile(path.join(root, 'legacy.md'));
    expect(card?.project).toBe('legacy');
    expect(card?.assignees).toEqual([]);
  });

  test('keeps legacy cards visible when their old priority label is no longer supported', async () => {
    fs.writeFileSync(path.join(root, 'legacy-priority.md'), `---\nid: legacy-priority\ntitle: Legacy priority\nproject: personal\npriority: someday\n---\nBody`);
    expect(store.readCardFile(path.join(root, 'legacy-priority.md'))?.priority).toBe('medium');
  });
});
