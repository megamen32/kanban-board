import type { KanbanCard, KanbanCardUpdates } from './types';
import { decideHumanReview, validateTransition } from './transition-policy';
import { isTaskActor, sameTaskPerson } from './task-membership';

export interface ManualVerification {
  expectedVersion: number;
  confirmed: true;
  result: string;
  evidence: string;
}

export function parseManualVerification(value: unknown): ManualVerification | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const meaningful = (text: unknown): text is string => typeof text === 'string'
    && text.trim().length >= 3 && text.length <= 4000 && /[\p{L}\p{N}]/u.test(text)
    && !/^(неизвестно|unknown|n\/a|нет|не проверено)$/i.test(text.trim().replace(/[\s.!?,;:]+$/u, ''));
  if (Object.keys(body).some(key => !['expectedVersion', 'confirmed', 'result', 'evidence'].includes(key))
    || !Number.isSafeInteger(body.expectedVersion) || (body.expectedVersion as number) < 1
    || body.confirmed !== true || !meaningful(body.result) || !meaningful(body.evidence)) return null;
  return {expectedVersion: body.expectedVersion as number, confirmed: true, result: body.result.trim(), evidence: body.evidence.trim()};
}

type VerificationDecision = {kind: 'accepted'; patch: KanbanCardUpdates}
  | {kind: 'rejected'; status: 403 | 409; reason: string};

/** Add proof to the existing human policy, never grant a different actor or reviewer. */
export function decideManualVerification(card: KanbanCard, input: ManualVerification, actor: string): VerificationDecision {
  if (card.column === 'done' || card.column === 'archived') return {kind: 'rejected', status: 409, reason: 'task_already_closed'};
  if (card.pendingQuestion && !card.pendingQuestion.answer) return {kind: 'rejected', status: 409, reason: 'task_has_unanswered_question'};
  const note = `Проверенный результат: ${input.result}\nДоказательство: ${input.evidence}`;
  let patch: KanbanCardUpdates;
  if (card.column === 'review' || card.needsReview) {
    const decision = decideHumanReview(card, 'accept', actor, note);
    if (decision.kind !== 'accepted') return {kind: 'rejected', status: decision.reason === 'reviewer_not_authorized' ? 403 : 409, reason: decision.reason};
    patch = decision.patch;
  } else {
    if (!isTaskActor(card, actor) || (card.requiresApprovalFrom ?? []).some(person => !sameTaskPerson(person, actor))) {
      return {kind: 'rejected', status: 403, reason: 'reviewer_not_authorized'};
    }
    const decision = validateTransition(card, {column: 'done'}, {origin: 'human-ui', actor});
    if (decision.kind !== 'accepted') return {kind: 'rejected', status: 409, reason: decision.reason};
    patch = {...decision.patch, reviewHistory: [...(card.reviewHistory ?? []), {
      decision: 'accepted', actor, decidedAt: decision.patch.completedAt!, note,
    }]};
  }
  return {kind: 'accepted', patch: {...patch, nextAction: null, completionEvidence: [...(patch.completionEvidence ?? card.completionEvidence ?? []), {
    type: 'manual_result_verification', actor, origin: 'human-ui', checkedAt: patch.completedAt,
    result: input.result, evidence: input.evidence,
  }]}};
}
