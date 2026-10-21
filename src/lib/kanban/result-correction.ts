import type { KanbanCard, TaskResult } from './types';

export const MAX_CORRECTED_RESULT_SUMMARY = 12_000;
export const MAX_CORRECTED_RESULT_REFS = 30;

export type ResultCorrectionInput = {
  expectedVersion: number;
  summary: string;
  evidenceRefs: string[];
  nextAction?: string;
};

export function parseResultCorrectionInput(value: unknown): ResultCorrectionInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(key => !['expectedVersion', 'summary', 'evidenceRefs', 'nextAction'].includes(key))
      || !Number.isSafeInteger(body.expectedVersion) || (body.expectedVersion as number) < 1
      || typeof body.summary !== 'string' || !body.summary.trim() || body.summary.length > MAX_CORRECTED_RESULT_SUMMARY
      || !Array.isArray(body.evidenceRefs) || body.evidenceRefs.length < 1 || body.evidenceRefs.length > MAX_CORRECTED_RESULT_REFS
      || body.evidenceRefs.some(ref => typeof ref !== 'string' || !ref.trim() || ref.length > 2_000)
      || (body.nextAction !== undefined && (typeof body.nextAction !== 'string' || body.nextAction.length > 2_000))) return null;
  return {
    expectedVersion: body.expectedVersion as number,
    summary: body.summary.trim(),
    evidenceRefs: [...new Set((body.evidenceRefs as string[]).map(ref => ref.trim()))],
    ...(typeof body.nextAction === 'string' && body.nextAction.trim() ? { nextAction: body.nextAction.trim() } : {}),
  };
}

export function correctedTaskResult(input: ResultCorrectionInput, username: string, submittedAt: string): TaskResult {
  return {
    summary: input.summary,
    evidenceRefs: input.evidenceRefs,
    ...(input.nextAction ? { nextAction: input.nextAction } : {}),
    submittedBy: `owner-correction:${username}`,
    submittedAt,
  };
}

export function canCorrectResult(card: KanbanCard, username: string): boolean {
  return card.owner === username && card.column === 'review' && card.needsReview === true;
}
