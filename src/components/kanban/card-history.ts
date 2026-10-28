import type { KanbanCard } from '@/lib/kanban/types';

export function hasCardHistory(card: Pick<KanbanCard, 'resultHistory' | 'reviewHistory'>): boolean {
  return (card.resultHistory?.length ?? 0) > 0 || (card.reviewHistory?.length ?? 0) > 0;
}
