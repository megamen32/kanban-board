import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { boardTasksDirectory, watchBoard } from './board-watcher';

describe('board file change notifications', () => {
  // Fast unit: prevent observing retired mount; expected <1s, maximum 5s.
  it('uses the same shared work directory as the API', () => {
    expect(boardTasksDirectory({ KANBAN_SCOPE_ROOT: '/data/scopes', TASKS_DIR: '/data/tasks' })).toBe('/data/scopes/work');
    expect(boardTasksDirectory({ TASKS_DIR: '/legacy/tasks' })).toBe('/legacy/tasks');
  });
  // Focused integration: real pinned Chokidar add/change/delete; expected 1s/max5s.
  it('observes real Markdown writes without unsupported glob watches', async () => {
    const root = path.join(process.cwd(), '.tmp');
    await fs.mkdir(root, { recursive: true });
    const dir = await fs.mkdtemp(path.join(root, 'board-watch-'));
    const events: string[] = [];
    const watcher = watchBoard(dir, fileName => events.push(fileName));
    try {
      await new Promise<void>(resolve => watcher.once('ready', resolve));
      const file = path.join(dir, 'isolated-qa.md');
      await fs.writeFile(file, 'version: 1');
      await expect.poll(() => events.length, { timeout: 1000 }).toBe(1);
      await fs.writeFile(file, 'version: 2');
      await expect.poll(() => events.length, { timeout: 1000 }).toBe(2);
      await fs.unlink(file);
      await expect.poll(() => events.length, { timeout: 1000 }).toBe(3);
      expect(events).toEqual(Array(3).fill('isolated-qa.md'));
    } finally {
      await watcher.close();
      await fs.rm(dir, { recursive: true });
    }
  }, 5000);
});
