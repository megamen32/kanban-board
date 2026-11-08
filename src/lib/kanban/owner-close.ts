import type { KanbanCard, KanbanCardUpdates } from './types';
import { sameTaskPerson } from './task-membership';

export function canOwnerClose(card: KanbanCard, actor: string | null | undefined): boolean {
  return card.column !== 'done' && card.column !== 'archived'
    && sameTaskPerson(card.owner || 'nikita', actor);
}

export function parseOwnerClose(value: unknown): { expectedVersion: number } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(key => key !== 'expectedVersion')
    || !Number.isSafeInteger(body.expectedVersion) || (body.expectedVersion as number) < 1) return null;
  return { expectedVersion: body.expectedVersion as number };
}

/** A human owner's decision is not a claim that AI work was verified. */
export function decideOwnerClose(card: KanbanCard, input: { expectedVersion: number }, actor: string):
  {kind: 'accepted'; patch: KanbanCardUpdates} | {kind: 'rejected'; status: 403 | 409; reason: string} {
  if (card.version !== input.expectedVersion) return {kind: 'rejected', status: 409, reason: 'version_conflict'};
  if (!sameTaskPerson(card.owner || 'nikita', actor)) return {kind: 'rejected', status: 403, reason: 'task_owner_required'};
  if (!canOwnerClose(card, actor)) return {kind: 'rejected', status: 409, reason: 'task_already_closed'};
  const completedAt = new Date().toISOString();
  return {kind: 'accepted', patch: {
    column: 'done', needsReview: false, completedBy: actor, completedAt, nextAction: null,
    completionEvidence: [...(card.completionEvidence ?? []), {
      type: 'owner_closed_without_verification', actor, origin: 'human-ui', decidedAt: completedAt,
    }],
  }};
}

/** An owner close is not a fresh acceptance of an earlier AI result. */
export function isOwnerClosedWithoutVerification(card: KanbanCard): boolean {
  return card.column === 'done' && !!card.completedAt
    && (card.completionEvidence ?? []).some(item =>
      item.type === 'owner_closed_without_verification' && item.origin === 'human-ui'
      && item.decidedAt === card.completedAt && item.actor === card.completedBy);
}
