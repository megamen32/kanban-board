import { describe, expect, it } from 'vitest';
import { canCorrectResult, correctedTaskResult, parseResultCorrectionInput } from './result-correction';
import type { KanbanCard } from './types';

const input = { expectedVersion: 11, summary: 'Current result', evidenceRefs: ['https://example.com/a', 'https://example.com/a'], nextAction: 'Manual review' };

describe('owner result correction', () => {
  it('accepts bounded content and removes duplicate references', () => {
    expect(parseResultCorrectionInput(input)).toEqual({ expectedVersion: 11, summary: 'Current result', evidenceRefs: ['https://example.com/a'], nextAction: 'Manual review' });
  });

  it('rejects caller-supplied identity and malformed result data', () => {
    expect(parseResultCorrectionInput({ ...input, submittedBy: 'nikita' })).toBeNull();
    expect(parseResultCorrectionInput({ ...input, expectedVersion: 0 })).toBeNull();
    expect(parseResultCorrectionInput({ ...input, evidenceRefs: [] })).toBeNull();
    expect(parseResultCorrectionInput(null)).toBeNull();
  });

  it('marks a correction distinctly and never manufactures a native run reference', () => {
    const result = correctedTaskResult(parseResultCorrectionInput(input)!, 'nikita', '2026-10-21T12:00:00.000Z');
    expect(result).toMatchObject({ submittedBy: 'owner-correction:nikita', submittedAt: '2026-10-21T12:00:00.000Z' });
    expect(result).not.toHaveProperty('runRef');
  });

  it('limits correction to the verified card owner while it is awaiting review', () => {
    const card = { owner: 'nikita', column: 'review', needsReview: true } as KanbanCard;
    expect(canCorrectResult(card, 'nikita')).toBe(true);
    expect(canCorrectResult(card, 'anonymous')).toBe(false);
    expect(canCorrectResult({ ...card, column: 'todo' }, 'nikita')).toBe(false);
  });
});
