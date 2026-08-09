import path from 'node:path';
import type { BoardScope } from './scopes';

/** Resolve only the two configured data roots; scope text never becomes a path. */
export function tasksDirForScope(scope: BoardScope): string {
  const scopeRoot = process.env.KANBAN_SCOPE_ROOT;
  if (scopeRoot) return path.join(scopeRoot, scope);
  if (scope === 'work') return process.env.TASKS_DIR || path.join(process.cwd(), 'data', 'tasks');
  throw new Error('personal scope is not configured');
}
