import type { ReactNode } from 'react';

export type ReviewActionCard = {
  column: string;
  needsReview?: boolean;
  requiresApprovalFrom?: string[];
  resultHistory?: unknown[];
  taskExecutionHistory?: unknown[];
};

export type ReviewActionAccess = 'not-awaiting-review' | 'login-required' | 'reviewer-required' | 'authorized' | 'owner-review' | 'owner-recovery';

/** Decide the UI affordance from server-verified identity, never the selected board persona. */
export function reviewActionAccess(card: ReviewActionCard, verifiedUsername: string | null | undefined): ReviewActionAccess {
  const malformedRecovery = card.column === 'in-progress' && card.needsReview === true
    && !(card.requiresApprovalFrom?.length) && !(card.resultHistory?.length) && !(card.taskExecutionHistory?.length);
  if (malformedRecovery) {
    if (!verifiedUsername) return 'login-required';
    return verifiedUsername === 'nikita' ? 'owner-recovery' : 'reviewer-required';
  }
  if (card.column !== 'review' || card.needsReview !== true) return 'not-awaiting-review';
  if (!verifiedUsername) return 'login-required';
  if (!(card.requiresApprovalFrom?.length) && (card.resultHistory?.length ?? 0) > 0) {
    return verifiedUsername === 'nikita' ? 'owner-review' : 'reviewer-required';
  }
  return (card.requiresApprovalFrom ?? []).includes(verifiedUsername) ? 'authorized' : 'reviewer-required';
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
