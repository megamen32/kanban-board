import type { ReactNode } from 'react';
import { isOwnerReviewRecoveryCandidate } from '../../lib/kanban/transition-policy';
import { sameTaskPerson } from '../../lib/kanban/task-membership';

export type ReviewActionCard = {
  column: string;
  owner?: string;
  needsReview?: boolean;
  requiresApprovalFrom?: string[];
  resultHistory?: unknown[];
  taskExecutionHistory?: unknown[];
  reviewHistory?: unknown[];
  completionEvidence?: unknown[];
  completedBy?: string;
  completedAt?: string;
  pendingQuestion?: {answer?: unknown};
};

export type ReviewActionAccess = 'not-awaiting-review' | 'login-required' | 'reviewer-required' | 'authorized' | 'owner-review' | 'owner-recovery';

/** Decide the UI affordance from server-verified identity, never the selected board persona. */
export function reviewActionAccess(card: ReviewActionCard, verifiedUsername: string | null | undefined): ReviewActionAccess {
  if (card.column === 'review' && card.owner && verifiedUsername && sameTaskPerson(card.owner, verifiedUsername)
      && !(card.requiresApprovalFrom ?? []).length
      && !(card.pendingQuestion && !card.pendingQuestion.answer)) return 'owner-review';
  const malformedRecovery = isOwnerReviewRecoveryCandidate(card);
  if (malformedRecovery) {
    if (!verifiedUsername) return 'login-required';
    return verifiedUsername === 'nikita' ? 'owner-recovery' : 'reviewer-required';
  }
  if (card.column !== 'review' || card.needsReview !== true) return 'not-awaiting-review';
  if (!verifiedUsername) return 'login-required';
  if (!(card.requiresApprovalFrom?.length) && (card.resultHistory?.length ?? 0) > 0) {
    return verifiedUsername === 'nikita' ? 'owner-review' : 'reviewer-required';
  }
  return (card.requiresApprovalFrom ?? []).some(person => sameTaskPerson(person, verifiedUsername)) ? 'authorized' : 'reviewer-required';
}

export function ReviewActionGate({
  card, verifiedUsername, children,
}: {
  card: ReviewActionCard;
  /** Comes from the server-verified /api/auth/session response. */
  verifiedUsername: string | null | undefined;
  children?: ReactNode;
}) {
  const access = reviewActionAccess(card, verifiedUsername);
  if (access === 'authorized' || access === 'owner-review') return <>{children}</>;
  if (access === 'login-required') {
    return <p role="status">Войдите под учёткой владельца задачи, чтобы принять результат или вернуть его на доработку.</p>;
  }
  if (access === 'reviewer-required') {
    return <p role="status">Решение доступно только назначенному проверяющему этой задачи.</p>;
  }
  if (access === 'owner-recovery') return <>{children}</>;
  return null;
}
