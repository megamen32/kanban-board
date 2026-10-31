import type { KanbanCard } from '@/lib/kanban/types';
import { isTaskActor } from '../../lib/kanban/task-membership';

/** Show completion only to the actual owner or assignee of an ordinary card. */
export function canCompleteDirectly(
  card: Pick<KanbanCard, 'column' | 'needsReview' | 'owner' | 'assignee' | 'assignees'>,
  verifiedUsername: string | null | undefined,
): boolean {
  return !card.needsReview && !['review', 'done', 'archived'].includes(card.column)
    && isTaskActor(card, verifiedUsername);
}

/** Existing reviewer-reassignment operation, explicitly initiated by the real owner. */
export function canTakeOwnReview(
  card: Pick<KanbanCard, 'column' | 'needsReview' | 'owner' | 'requiresApprovalFrom'>,
  verifiedUsername: string | null | undefined,
): boolean {
  return card.column === 'review' && card.needsReview === true
    && card.owner === 'nikita' && verifiedUsername === 'nikita'
    && !(card.requiresApprovalFrom ?? []).includes('nikita');
}
