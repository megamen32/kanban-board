import type { ConflictInfo, KanbanCardUpdates } from '@/lib/kanban/types';

/** Reapply only the user's original edit against the explicitly shown server
 * version. A second conflict must remain a conflict, not a forced overwrite.
 */
export function retryConflictEdit<T>(conflict: ConflictInfo,
  update: (id: string, patch: KanbanCardUpdates, expectedVersion: number) => Promise<T>) {
  const { id, ...patch } = conflict.clientCard;
  return update(id, patch, conflict.serverVersion);
}
