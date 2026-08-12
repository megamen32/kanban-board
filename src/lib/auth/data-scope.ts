import path from 'node:path';
import type { BoardScope } from './scopes';

/**
 * The human board is one shared Markdown store. OAuth scopes still label the
 * caller for ChatGPT, but they no longer select a second copy of the tasks.
 */
export function tasksDirForScope(scope: BoardScope): string {
  const scopeRoot = process.env.KANBAN_SCOPE_ROOT;
  if (scopeRoot) return path.join(scopeRoot, 'work');
  if (scope === 'work') return process.env.TASKS_DIR || path.join(process.cwd(), 'data', 'tasks');
  throw new Error('personal scope is not configured');
}
