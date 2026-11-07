import { describe, expect, it } from 'vitest';
import { decideManualVerification, parseManualVerification, type ManualVerification } from './manual-verification';
import type { KanbanCard } from './types';

const input: ManualVerification = {
  expectedVersion: 7, confirmed: true,
  result: 'Проверено сохранение результата после перезагрузки',
  evidence: 'https://example.test/fixture-proof',
};

function card(overrides: Partial<KanbanCard> = {}): KanbanCard {
  return {
    id: 'fixture-manual-card', title: 'Синтетическая проверка', description: 'Исходная цель сохраняется',
    column: 'todo', priority: 'medium', project: 'Fixture', tags: [], order: 0,
    created: '2026-01-01T00:00:00Z', updated: '2026-01-01T00:00:00Z', fileName: 'fixture.md', version: 7,
    owner: 'fixture-owner', assignees: ['fixture-assignee'], requiresApprovalFrom: [],
    completionEvidence: [], reviewHistory: [], ...overrides,
  };
}

describe('manual verification input', () => {
  it('requires a bounded explicit result, evidence, confirmation and native version', () => {
    expect(parseManualVerification({ ...input, result: `  ${input.result}  `, evidence: ` ${input.evidence} ` })).toEqual(input);
    expect(parseManualVerification({ ...input, result: 'Р'.repeat(4000), evidence: 'Д'.repeat(4000) })).not.toBeNull();
    expect(parseManualVerification({ ...input, result: 'Р'.repeat(4001) })).toBeNull();
    expect(parseManualVerification({ ...input, evidence: 'Д'.repeat(4001) })).toBeNull();
  });

  it.each([null, undefined, [], 'verified', 1])('rejects a non-object request: %s', value => {
    expect(parseManualVerification(value)).toBeNull();
  });

  it.each([undefined, 0, -1, 1.5, '7', Number.MAX_SAFE_INTEGER + 1, Infinity])('rejects a missing or invalid version: %s', expectedVersion => {
    expect(parseManualVerification({ ...input, expectedVersion })).toBeNull();
  });

  it.each([undefined, false, 'true', 1])('requires literal human confirmation: %s', confirmed => {
    expect(parseManualVerification({ ...input, confirmed })).toBeNull();
  });

  it.each(['', '  ', 'ок', 'неизвестно', 'UNKNOWN', 'нет', 'n/a', '...', '---', 'неизвестно.'])
    ('rejects missing or placeholder proof: %s', value => {
      expect(parseManualVerification({ ...input, result: value })).toBeNull();
      expect(parseManualVerification({ ...input, evidence: value })).toBeNull();
    });

  it.each(['actor', 'completedBy', 'checkedAt', 'completedAt', 'origin', 'completionEvidence'])
    ('never accepts caller-owned audit identity or timestamp: %s', key => {
      expect(parseManualVerification({ ...input, [key]: 'forged' })).toBeNull();
    });
});

describe('manual verification policy', () => {
  it.each(['fixture-owner', 'fixture-assignee'])('allows an ordinary task actor and records the passed server actor: %s', actor => {
    const before = card({ nextAction: 'Старая инструкция', completionEvidence: [{ type: 'fixture-old-evidence', reference: 'fixture:old' }],
      reviewHistory: [{ decision: 'rework', actor: 'fixture-reviewer', decidedAt: '2026-01-01T01:00:00Z', note: 'Старое замечание' }],
    });
    const original = structuredClone(before);
    const decision = decideManualVerification(before, input, actor);
    expect(decision.kind).toBe('accepted');
    if (decision.kind !== 'accepted') throw new Error('expected accepted synthetic verification');
    expect(decision.patch).toMatchObject({ column: 'done', completedBy: actor, nextAction: null });
    expect(decision.patch.completedAt).toEqual(expect.any(String));
    expect(Number.isFinite(Date.parse(decision.patch.completedAt!))).toBe(true);
    expect(decision.patch.completionEvidence?.[0]).toEqual(before.completionEvidence?.[0]);
    expect(decision.patch.completionEvidence?.at(-1)).toEqual({
      type: 'manual_result_verification', actor, origin: 'human-ui', checkedAt: decision.patch.completedAt,
      result: input.result, evidence: input.evidence,
    });
    expect(decision.patch.reviewHistory?.[0]).toEqual(before.reviewHistory?.[0]);
    expect(decision.patch.reviewHistory?.at(-1)).toMatchObject({ decision: 'accepted', actor, decidedAt: decision.patch.completedAt });
    expect(decision.patch.reviewHistory?.at(-1)?.note).toContain(input.result);
    expect(decision.patch.reviewHistory?.at(-1)?.note).toContain(input.evidence);
    expect(decision.patch).not.toHaveProperty('resultHistory');
    expect(before).toEqual(original);
  });

  it('preserves existing normalized owner/assignee aliases', () => {
    expect(decideManualVerification(card({ owner: 'Никита Розанов', assignees: [] }), input, 'nikita').kind).toBe('accepted');
  });

  it('does not grant completion to a foreign reader or bypass another assigned reviewer', () => {
    expect(decideManualVerification(card(), input, 'fixture-other')).toMatchObject({ kind: 'rejected', status: 403 });
    expect(decideManualVerification(card(), input, '')).toMatchObject({ kind: 'rejected', status: 403 });
    expect(decideManualVerification(card({ requiresApprovalFrom: ['fixture-reviewer'] }), input, 'fixture-owner'))
      .toMatchObject({ kind: 'rejected', status: 403, reason: 'reviewer_not_authorized' });
  });

  it('uses designated human review policy instead of allowing the owner to override it', () => {
    const before = card({ column: 'review', needsReview: true, requiresApprovalFrom: ['fixture-reviewer'], resultHistory: [{
      summary: 'Заявленный результат', evidenceRefs: ['fixture:result:1'], submittedAt: '2026-01-01T02:00:00Z', submittedBy: 'fixture-executor',
    }] });
    expect(decideManualVerification(before, input, 'fixture-owner')).toMatchObject({ kind: 'rejected', status: 403 });
    expect(decideManualVerification(before, input, 'fixture-assignee')).toMatchObject({ kind: 'rejected', status: 403 });
    const accepted = decideManualVerification(before, input, 'fixture-reviewer');
    expect(accepted).toMatchObject({ kind: 'accepted', patch: { column: 'done', needsReview: false, completedBy: 'fixture-reviewer', nextAction: null } });
  });

  it.each(['todo', 'review'] as const)('refuses a task with an unanswered executor question in %s', column => {
    const before = card({ column, needsReview: column === 'review', requiresApprovalFrom: ['fixture-owner'], pendingQuestion: {
      id: 'fixture-question', text: 'Какое действие требуется?', choices: [], askedAt: '2026-01-01T01:00:00Z', attemptOperationId: 'a'.repeat(64),
    } });
    expect(decideManualVerification(before, input, 'fixture-owner')).toEqual({
      kind: 'rejected', status: 409, reason: 'task_has_unanswered_question',
    });
  });

  it.each(['done', 'archived'] as const)('refuses already closed %s without appending another verification', column => {
    const before = card({ column, completionEvidence: [{ type: 'fixture-prior-evidence' }] });
    const original = structuredClone(before);
    expect(decideManualVerification(before, input, 'fixture-owner')).toEqual({ kind: 'rejected', status: 409, reason: 'task_already_closed' });
    expect(before).toEqual(original);
  });

  it('does not silently accept an inconsistent legacy review flag on an in-progress card', () => {
    expect(decideManualVerification(card({ column: 'in-progress', needsReview: true }), input, 'fixture-owner'))
      .toMatchObject({ kind: 'rejected', status: 409, reason: 'task_not_waiting_for_review' });
  });
});
