import type { KanbanCard } from '@/lib/kanban/types';

/** Ordinary owner tasks can close directly. Review decisions use the review workflow. */
export function canCompleteDirectly(card: Pick<KanbanCard, 'column' | 'needsReview'>): boolean {
  return !card.needsReview && !['review', 'done', 'archived'].includes(card.column);
}
