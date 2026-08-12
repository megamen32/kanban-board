import { describe, expect, test } from 'vitest';
import { validateTransition } from './transition-policy';
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
