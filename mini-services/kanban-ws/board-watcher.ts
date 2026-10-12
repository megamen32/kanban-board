import chokidar from 'chokidar';
import path from 'node:path';

/** Match the app's shared work store; TASKS_DIR is the legacy fallback only. */
export function boardTasksDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return env.KANBAN_SCOPE_ROOT
    ? path.join(env.KANBAN_SCOPE_ROOT, 'work')
    : env.TASKS_DIR || path.join(process.cwd(), '..', 'data', 'tasks');
}

export function watchBoard(tasksDir: string, onChange: (fileName: string) => void) {
  // Chokidar 4/5 watches paths, not glob strings. Watch the directory itself.
  const watcher = chokidar.watch(tasksDir, {
    ignoreInitial: true, depth: 0,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
  });
  watcher.on('all', (event, filePath) => {
    if (['add', 'change', 'unlink'].includes(event) && path.extname(filePath) === '.md') {
      onChange(path.basename(filePath));
    }
  });
  return watcher;
}
