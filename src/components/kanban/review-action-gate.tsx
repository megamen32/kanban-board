import type { ReactNode } from 'react';

export type ReviewActionCard = {
  column: string;
  needsReview?: boolean;
  requiresApprovalFrom?: string[];
};

export type ReviewActionAccess = 'not-awaiting-review' | 'login-required' | 'reviewer-required' | 'authorized';

/** Decide the UI affordance from server-verified identity, never the selected board persona. */
export function reviewActionAccess(card: ReviewActionCard, verifiedUsername: string | null | undefined): ReviewActionAccess {
  if (card.column !== 'review' || card.needsReview !== true) return 'not-awaiting-review';
  if (!verifiedUsername) return 'login-required';
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
  if (access === 'authorized') return <>{children}</>;
  if (access === 'login-required') {
    return <p role="status">Войдите под учёткой владельца задачи, чтобы принять результат или вернуть его на доработку.</p>;
  }
  if (access === 'reviewer-required') {
    return <p role="status">Решение доступно только назначенному проверяющему этой задачи.</p>;
  }
  return null;
}
