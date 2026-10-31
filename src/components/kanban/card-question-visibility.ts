import type { KanbanCard } from '../../lib/kanban/types';

const ACTIVE_PHASES = ['created', 'dispatch-unknown', 'running', 'waiting'] as const;

/** Keep legacy Notice controls only for executions predating direct Board questions. */
export function usesLegacyNoticeQuestion(card: KanbanCard): boolean {
  if (card.pendingQuestion) return false;
  const attempt = card.taskExecutionHistory?.at(-1);
  if (!attempt) return false;
  // A pre-existing explicit Notice binding remains usable even if the same
  // execution also has a later executor-key field.
  if (attempt.taskDecisionRequest || attempt.executorQuestion) return true;
  if (attempt.executorKeyHash) return false;
  return Boolean(attempt.nativeSessionId && ACTIVE_PHASES.some(phase => phase === attempt.phase));
}

/** Poll only while an open task can receive a question/result or delivery receipt. */
export function shouldRefreshExecutionCard(card: KanbanCard): boolean {
  const attempt = card.taskExecutionHistory?.at(-1);
  return Boolean((attempt && ACTIVE_PHASES.some(phase => phase === attempt.phase))
    || (card.pendingQuestion && !card.pendingQuestion.deliveredAt));
}
