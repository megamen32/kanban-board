import type { KanbanCard } from '@/lib/kanban/types';
import { toDateTimeLocalValue } from '../../lib/kanban/date-input';

export function initialPlanningMetadata(card: KanbanCard) {
  return {
    type: card.type ?? 'action' as const, role: card.role ?? '',
    important: card.important ?? false, urgent: card.urgent ?? false,
    scheduledAt: toDateTimeLocalValue(card.scheduledAt),
    todayRank: card.todayRank?.toString() ?? '', waitingFor: card.waitingFor?.join(', ') ?? '',
    requiresApprovalFrom: card.requiresApprovalFrom?.join(', ') ?? '',
    suggestedAssignee: card.suggestedAssignee ?? '', parent: card.parent ?? '',
  };
}
