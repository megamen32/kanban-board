import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { withSourceOperationLock } from './source-operation';
import { applyGraphLayoutChange, defaultGraphLayout, parseStoredGraphLayout,
  type GraphLayoutChange, type GraphLayoutPreferences } from './graph-layout-preferences';

function location(tasksDir: string, identity: { username: string; scope: string }) {
  // The filename contains no username, project name or untrusted path component.
  const key = createHash('sha256').update(JSON.stringify([identity.scope, identity.username])).digest('hex');
  const directory = path.join(tasksDir, '.graph-layouts');
  return { directory, file: path.join(directory, key + '.json') };
}
export function readGraphLayout(tasksDir: string, identity: { username: string; scope: string }): GraphLayoutPreferences {
  const { file } = location(tasksDir, identity);
  let content: string;
  try { content = fs.readFileSync(file, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultGraphLayout(); throw error; }
  const stored = parseStoredGraphLayout(JSON.parse(content));
  if (!stored) throw new Error('invalid_saved_graph_layout');
  return stored;
}
export function updateGraphLayout(tasksDir: string, identity: { username: string; scope: string },
  expectedVersion: number, change: GraphLayoutChange): { conflict: boolean; layout: GraphLayoutPreferences } {
  const { file, directory } = location(tasksDir, identity);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  // Reuse the application's kernel-lock helper, in the preference directory;
  // graph dragging never contends with or changes task journal operations.
  return withSourceOperationLock(directory, () => {
    const previous = readGraphLayout(tasksDir, identity);
    if (previous.version !== expectedVersion) return { conflict: true, layout: previous };
    const next = { ...applyGraphLayoutChange(previous, change), version: previous.version + 1, updatedAt: new Date().toISOString() };
    const temporary = file + '.' + randomUUID() + '.tmp';
    try {
      const fd = fs.openSync(temporary, 'wx', 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(next) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(temporary, file);
    } finally { try { fs.unlinkSync(temporary); } catch { /* already renamed */ } }
    return { conflict: false, layout: next };
  });
}
