import { describe, expect, test } from 'vitest';
import { decideHumanReview, validateTransition } from './transition-policy';
import type { KanbanCard } from './types';

const baseCard: KanbanCard = {
  id: 'card-1',
  title: 'Ship policy',
  description: '',
  column: 'in-progress',
  priority: 'medium',
  tags: [],
  order: 0,
  created: '2026-08-12T09:00:00+03:00',
  updated: '2026-08-12T09:00:00+03:00',
  fileName: 'ship-policy-card-1.md',
  version: 1,
  project: 'alpha',
  assignees: ['nikita'],
  completionEvidence: [],
  approvalEvidence: [],
};

describe('kanban transition policy', () => {
  test('owner recovers only a malformed in-progress review gate without accepting results', () => {
    const malformed: KanbanCard = { ...baseCard, owner: 'nikita', column: 'in-progress', needsReview: true, requiresApprovalFrom: [], resultHistory: [] };
    const decision = decideHumanReview(malformed, 'recover-rework', 'nikita', 'Проверить статус и продолжить работу');
    expect(decision).toMatchObject({ kind: 'accepted', patch: {
      column: 'in-progress', needsReview: false, nextAction: 'Проверить статус и продолжить работу',
      reviewHistory: [{ decision: 'rework', actor: 'nikita', note: 'Проверить статус и продолжить работу' }],
    } });
    expect((decision as { patch?: Record<string, unknown> }).patch).not.toHaveProperty('resultHistory');
    expect(decideHumanReview(malformed, 'recover-rework', 'oleg', 'Проверить')).toMatchObject({ kind: 'rejected', reason: 'task_not_waiting_for_review' });
    expect(decideHumanReview({ ...malformed, requiresApprovalFrom: ['nikita'] }, 'recover-rework', 'nikita', 'Проверить')).toMatchObject({ kind: 'rejected', reason: 'task_not_waiting_for_review' });
    expect(decideHumanReview({ ...malformed, resultHistory: [{ summary: 'Done', evidenceRefs: [], submittedBy: 'worker', submittedAt: new Date().toISOString() }] }, 'recover-rework', 'nikita', 'Проверить')).toMatchObject({ kind: 'rejected', reason: 'task_not_waiting_for_review' });
    expect(decideHumanReview({ ...malformed, taskExecutionHistory: [{ operationId: 'op', requestHash: 'hash', lastBoardVersion: 1, createInputId: 'create', messageInputId: 'message', phase: 'running', hostId: 'host', harness: 'codex', startedBy: 'nikita', createdAt: '', updatedAt: '' }] }, 'recover-rework', 'nikita', 'Проверить')).toMatchObject({ kind: 'rejected', reason: 'task_not_waiting_for_review' });
    expect(decideHumanReview({ ...malformed, column: 'review' }, 'recover-rework', 'nikita', 'Проверить')).toMatchObject({ kind: 'rejected', reason: 'task_not_waiting_for_review' });
    expect(decideHumanReview(malformed, 'recover-rework', 'nikita', '   ')).toMatchObject({ kind: 'rejected', reason: 'rework_note_required' });
  });

  test('v7 legacy review without result: only authenticated owner may return it with a reason', () => {
    const legacy: KanbanCard = {
      ...baseCard,
      id: '3e66870b-e11c-4548-a771-c4c753e2e83f',
      version: 7, owner: 'nikita', column: 'review', needsReview: false,
      requiresApprovalFrom: [], resultHistory: [], reviewHistory: [], taskExecutionHistory: [],
    };
    // A saved column alone is never completion evidence.
    expect(validateTransition(legacy, { completionEvidence: [{ type: 'inferred' }] },
      { origin: 'mcp', actor: 'dot' })).toMatchObject({
      kind: 'rejected', reason: 'review_requires_explicit_decision',
    });
    expect(decideHumanReview(legacy, 'accept', 'nikita')).toMatchObject({
      kind: 'rejected', reason: 'task_not_waiting_for_review',
    });
    expect(decideHumanReview(legacy, 'rework', 'nikita', 'Rework')).toMatchObject({
      kind: 'rejected', reason: 'task_not_waiting_for_review',
    });
    expect(decideHumanReview(legacy, 'recover-rework', 'dot', 'Rework')).toMatchObject({
      kind: 'rejected', reason: 'task_not_waiting_for_review',
    });
    expect(decideHumanReview(legacy, 'recover-rework', 'nikita', '  ')).toMatchObject({
      kind: 'rejected', reason: 'rework_note_required',
    });
    const decision = decideHumanReview(legacy, 'recover-rework', 'nikita',
      'Logging runtime ещё не установлен; acceptance pending');
    expect(decision).toMatchObject({kind:'accepted',patch:{
      column:'in-progress',needsReview:false,
      nextAction:'Logging runtime ещё не установлен; acceptance pending',
      reviewHistory:[{decision:'rework',actor:'nikita',note:'Logging runtime ещё не установлен; acceptance pending'}],
    }});
    if (decision.kind !== 'accepted') throw new Error('Owner recovery unexpectedly rejected');
    expect(decision.patch).not.toHaveProperty('completedBy');
    expect(decision.patch).not.toHaveProperty('completionEvidence');
    expect(decision.patch).not.toHaveProperty('requiresApprovalFrom');
    expect(decision.patch).not.toHaveProperty('owner');
    for (const altered of [
      {owner:'oleg'}, {requiresApprovalFrom:['nikita']},
      {resultHistory:[{summary:'Already submitted',evidenceRefs:[],submittedBy:'worker',submittedAt:'2026-11-02T15:00:00Z'}]},
      {reviewHistory:[{decision:'accepted' as const,actor:'nikita',decidedAt:'2026-11-02T15:00:00Z'}]},
      {completionEvidence:[{type:'manual_confirmation'}]},
      {completedAt:'2026-11-02T15:00:00Z'},
      {taskExecutionHistory:[{operationId:'active'} as NonNullable<KanbanCard['taskExecutionHistory']>[number]]},
      {pendingQuestion:{id:'pending',text:'?',choices:[],askedAt:'2026-11-02T15:00:00Z',attemptOperationId:'active'}},
      {needsReview:true}, {column:'done' as const},
    ]) {
      expect(decideHumanReview({...legacy,...altered},'recover-rework','nikita','Fix')).toMatchObject({
        kind:'rejected',reason:'task_not_waiting_for_review',
      });
    }
  });

  test('owner may accept an actual result when no reviewer was assigned, but cannot bypass an explicit reviewer', () => {
    const ready: KanbanCard = {
      ...baseCard,
      column: 'review',
      needsReview: true,
      requiresApprovalFrom: [],
      resultHistory: [{ summary: 'Тендерный список сверён', evidenceRefs: ['qa:result:1'], submittedBy: 'executor', submittedAt: '2026-10-27T00:00:00.000Z' }],
    };
    expect(decideHumanReview(ready, 'accept', 'nikita')).toMatchObject({
      kind: 'accepted', patch: { column: 'done', needsReview: false, completedBy: 'nikita' },
    });
    expect(decideHumanReview(ready, 'accept', 'oleg')).toMatchObject({ kind: 'rejected', reason: 'reviewer_not_authorized' });
    expect(decideHumanReview({ ...ready, requiresApprovalFrom: ['oleg'] }, 'accept', 'nikita'))
      .toMatchObject({ kind: 'rejected', reason: 'reviewer_not_authorized' });
    expect(decideHumanReview({ ...ready, resultHistory: [] }, 'accept', 'nikita'))
      .toMatchObject({ kind: 'rejected', reason: 'reviewer_not_authorized' });
  });

  test('clears the rework next action when an assigned reviewer accepts the result', () => {
    const waiting: KanbanCard = {
      ...baseCard,
      column: 'review',
      needsReview: true,
      requiresApprovalFrom: ['testlogin'],
      nextAction: 'Результат доработки готов к проверке назначенным участником.',
      resultHistory: [{ summary: 'v2', evidenceRefs: [], submittedBy: 'executor', submittedAt: '2026-10-28T00:00:00.000Z' }],
    };

    expect(decideHumanReview(waiting, 'accept', 'testlogin')).toMatchObject({
      kind: 'accepted', patch: { column: 'done', needsReview: false, nextAction: null, completedBy: 'testlogin' },
    });
  });

  test('owner may assign a reviewer without changing a card already waiting for review', () => {
    const waiting: KanbanCard = { ...baseCard, column: 'review', needsReview: true, requiresApprovalFrom: [] };
    const ownerContext = {
      origin: 'human-ui' as const,
      actor: 'nikita',
      ownerAuthorization: {
        actor: 'nikita',
        evidence: { type: 'reviewer-assignment', origin: 'rest', actor: 'nikita' },
      },
    };

    expect(validateTransition(waiting, { requiresApprovalFrom: ['oleg'] }, ownerContext)).toMatchObject({
      kind: 'accepted',
      patch: { requiresApprovalFrom: ['oleg'] },
    });
    expect(validateTransition(waiting, { requiresApprovalFrom: ['oleg'], description: 'changed' }, ownerContext)).toMatchObject({
      kind: 'rejected',
      reason: 'review_requires_explicit_decision',
    });
    expect(validateTransition(waiting, { requiresApprovalFrom: ['oleg'] }, { origin: 'human-ui', actor: 'oleg' })).toMatchObject({
      kind: 'rejected',
      reason: 'review_requires_explicit_decision',
    });
  });

  test('requires a separate blocker explanation before entering the blocked state', () => {
    expect(validateTransition(baseCard, { column: 'blocked' }, { origin: 'human-ui', actor: 'nikita' }))
      .toMatchObject({ kind: 'rejected', reason: 'blocked_reason_required' });
    expect(validateTransition(baseCard, { column: 'blocked', blockerReason: 'Ждём файл партнёра' }, { origin: 'human-ui', actor: 'nikita' }))
      .toMatchObject({ kind: 'accepted', patch: { column: 'blocked', blockerReason: 'Ждём файл партнёра' } });
  });

  test('allows the authenticated UI to edit the next action while ignoring automation-supplied text', () => {
    expect(validateTransition(baseCard, { nextAction: 'Ask the supplier for the workbook' }, { origin: 'human-ui', actor: 'nikita' }))
      .toMatchObject({ kind: 'accepted', patch: { nextAction: 'Ask the supplier for the workbook' } });
    expect(validateTransition(baseCard, { nextAction: 'Caller supplied text' }, { origin: 'automation', actor: 'agent' }))
      .toMatchObject({ kind: 'accepted', patch: {} });
  });

  test('records manual confirmation for a human UI DONE transition', () => {
    const decision = validateTransition(baseCard, { column: 'done' }, {
      origin: 'human-ui',
      actor: 'nikita',
    });

    expect(decision).toMatchObject({
      kind: 'accepted',
      patch: {
        column: 'done',
        completedBy: 'nikita',
        completedAt: expect.any(String),
        completionEvidence: [{ type: 'manual_confirmation', actor: 'nikita', origin: 'human-ui' }],
      },
    });
  });

  test.each(['automation', 'mcp'] as const)('redirects %s DONE without machine evidence to review', (origin) => {
    const decision = validateTransition(baseCard, { column: 'done' }, { origin, actor: 'agent' });

    expect(decision).toMatchObject({
      kind: 'redirected',
      patch: {
        column: 'review',
        needsReview: true,
        requiresApprovalFrom: ['nikita'],
      },
    });
  });

  test.each(['automation', 'mcp'] as const)('accepts %s DONE with server-generated completion timestamp', (origin) => {
    const evidence = { type: 'machine-verifiable' as const, check: 'deploy-health-200' };
    const decision = validateTransition(baseCard, {
      column: 'done',
      completedAt: '2000-01-01T00:00:00.000Z',
    }, { origin, actor: 'agent', trustedCompletionEvidence: [evidence] });

    expect(decision).toMatchObject({
      kind: 'accepted',
      patch: {
        column: 'done',
        completedBy: 'agent',
        completedAt: expect.any(String),
        completionEvidence: [evidence],
      },
    });
    expect(decision).not.toMatchObject({ patch: { completedAt: '2000-01-01T00:00:00.000Z' } });
  });

  test('accepts only an exact trusted owner completion from review and records owner audit evidence', () => {
    const authorization = {
      actor: 'nikita',
      evidence: { type: 'signed-owner-command', actor: 'nikita', confirmation: 'exact-card-completion' },
    };
    for (const state of [
      { column: 'review' as const, needsReview: true },
      { column: 'in-progress' as const, needsReview: true },
    ]) {
      const waiting: KanbanCard = {
        ...baseCard, ...state, owner: 'nikita', requiresApprovalFrom: ['nikita'],
      };
      const context = { origin: 'mcp' as const, actor: 'mcp', ownerCompletionAuthorization: authorization };
      const decision = validateTransition(waiting, { column: 'done' }, context);
      expect(decision).toMatchObject({ kind: 'accepted', patch: {
        column: 'done', needsReview: false, requiresApprovalFrom: [], completedBy: 'nikita',
        completedAt: expect.any(String),
        completionEvidence: [{ type: 'owner_confirmed_completion', actor: 'nikita', origin: 'mcp', evidence: authorization.evidence }],
      } });

      expect(validateTransition(waiting, { column: 'done', title: 'Mixed edit' }, context)).toMatchObject({
        kind: 'rejected', reason: 'review_requires_explicit_decision',
      });
      expect(validateTransition(waiting, { column: 'done' }, {
        ...context, ownerCompletionAuthorization: { ...authorization, actor: 'oleg' },
      })).toMatchObject({ kind: 'rejected', reason: 'review_requires_explicit_decision' });
      expect(validateTransition({ ...waiting, requiresApprovalFrom: ['oleg'] }, { column: 'done' }, context)).toMatchObject({
        kind: 'rejected', reason: 'review_requires_explicit_decision',
      });
      expect(validateTransition(waiting, { column: 'done' }, { origin: 'mcp', actor: 'mcp' })).toMatchObject({
        kind: 'rejected', reason: 'review_requires_explicit_decision',
      });
    }
  });

  test.each(['automation', 'mcp'] as const)('does not trust caller-supplied machine evidence for %s DONE', (origin) => {
    const evidence = { type: 'machine-verifiable' as const, check: 'caller-claimed' };
    const decision = validateTransition(baseCard, {
      column: 'done',
      completionEvidence: [evidence],
    }, { origin, actor: 'agent' });

    expect(decision).toMatchObject({
      kind: 'redirected',
      patch: {
        column: 'review',
        needsReview: true,
        requiresApprovalFrom: ['nikita'],
      },
    });
  });

  test('rejects an inferred assignee change and permits a direct owner change with evidence', () => {
    const rejected = validateTransition(baseCard, { assignees: ['marina'] }, {
      origin: 'automation',
      actor: 'agent',
    });
    expect(rejected).toMatchObject({ kind: 'rejected' });
    expect(rejected).toHaveProperty('reason', 'assignee_change_requires_owner_authorization');

    const ownerOnly = validateTransition(baseCard, { assignees: ['marina'] }, {
      origin: 'human-ui',
      actor: 'nikita',
    });
    expect(ownerOnly).toMatchObject({
      kind: 'rejected',
      reason: 'assignee_change_requires_owner_authorization',
    });

    const authorized = validateTransition(baseCard, { assignees: ['marina'] }, {
      origin: 'human-ui',
      actor: 'nikita',
      ownerAuthorization: {
        actor: 'nikita',
        evidence: { type: 'direct-owner-command' },
      },
    });
    expect(authorized).toMatchObject({
      kind: 'accepted',
      patch: {
        assignees: ['marina'],
        approvalEvidence: [{ type: 'assignee_authorization', actor: 'nikita', origin: 'human-ui' }],
      },
    });
  });

  test('permits explicit initial assignees only for authenticated human creation', () => {
    const decision = validateTransition(
      { ...baseCard, assignees: [] },
      { assignees: ['marina'] },
      { origin: 'human-ui', actor: 'nikita', isCreation: true },
    );

    expect(decision).toMatchObject({ kind: 'accepted', patch: { assignees: ['marina'] } });
  });

  test('rejects initial assignees for a non-owner human creation', () => {
    const decision = validateTransition(
      { ...baseCard, assignees: [] },
      { assignees: ['marina'] },
      { origin: 'human-ui', actor: 'marina', isCreation: true },
    );

    expect(decision).toMatchObject({
      kind: 'rejected',
      reason: 'assignee_change_requires_owner_authorization',
    });
  });

  test('strips caller audit fields from a non-completion update', () => {
    const decision = validateTransition(baseCard, {
      title: 'Updated',
      completedBy: 'attacker',
      completedAt: '2000-01-01T00:00:00.000Z',
      completionEvidence: [{ type: 'machine-verifiable', check: 'caller-claimed' }],
      approvalEvidence: [{ type: 'direct-owner-command', actor: 'attacker' }],
    }, { origin: 'human-ui', actor: 'nikita' });

    expect(decision.kind).toBe('accepted');
    if (decision.kind !== 'accepted') throw new Error('expected accepted transition');
    expect(decision.patch).toMatchObject({ title: 'Updated' });
    expect(decision.patch).not.toHaveProperty('completedBy');
    expect(decision.patch).not.toHaveProperty('completedAt');
    expect(decision.patch).not.toHaveProperty('completionEvidence');
    expect(decision.patch).not.toHaveProperty('approvalEvidence');
  });

  test('does not permit initial assignees for automation creation', () => {
    const decision = validateTransition(
      { ...baseCard, assignees: [] },
      { assignees: ['marina'] },
      { origin: 'automation', actor: 'agent', isCreation: true },
    );

    expect(decision).toMatchObject({
      kind: 'rejected',
      reason: 'assignee_change_requires_owner_authorization',
    });
  });

  test('rejects an inferred deadline change from automation or MCP', () => {
    for (const origin of ['automation', 'mcp'] as const) {
      const decision = validateTransition(baseCard, { dueAt: '2026-08-13T10:00:00+03:00' }, {
        origin,
        actor: 'agent',
      });
      expect(decision).toMatchObject({
        kind: 'rejected',
        reason: 'deadline_change_requires_human_ui',
      });
    }
  });

  test('does not mutate the input card or requested patch', () => {
    const patch = { column: 'done' as const };
    const before = structuredClone(baseCard);
    validateTransition(baseCard, patch, { origin: 'automation', actor: 'agent' });
    expect(baseCard).toEqual(before);
    expect(patch).toEqual({ column: 'done' });
  });

  test('rejects direct weekly commitment writes outside batch acceptance', () => {
    const decision = validateTransition(baseCard, { week: '2026-W33', bigRock: true }, {
      origin: 'mcp',
      actor: 'agent',
    });

    expect(decision).toEqual({ kind: 'rejected', reason: 'weekly_plan_requires_batch_acceptance' });
  });

  test('accepts weekly commitment only with owner batch context and server evidence', () => {
    const decision = validateTransition(baseCard, { week: '2026-W33', bigRock: true }, {
      origin: 'human-ui',
      actor: 'nikita',
      weeklyPlanAcceptance: {
        actor: 'nikita',
        week: '2026-W33',
        evidence: { type: 'weekly_plan_acceptance', batchId: 'batch-1' },
      },
    });

    expect(decision).toMatchObject({
      kind: 'accepted',
      patch: {
        week: '2026-W33',
        bigRock: true,
        approvalEvidence: [{
          type: 'weekly_plan_acceptance',
          actor: 'nikita',
          week: '2026-W33',
        }],
      },
    });
  });
});
