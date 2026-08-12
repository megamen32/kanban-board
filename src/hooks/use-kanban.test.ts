import { describe, expect, test } from 'vitest';
import { buildUpdateRequestBody } from './use-kanban';

describe('buildUpdateRequestBody', () => {
  test('preserves explicit reassignment intent and evidence', () => {
    expect(buildUpdateRequestBody({
      title: 'Task',
      assignees: ['marina'],
      reassignmentIntent: 'direct-owner-command',
      reassignmentEvidence: { source: 'owner-confirmation' },
    }, 3)).toEqual({
      title: 'Task',
      assignees: ['marina'],
      reassignmentIntent: 'direct-owner-command',
      reassignmentEvidence: { source: 'owner-confirmation' },
      expectedVersion: 3,
    });
  });

  test('does not add reassignment fields to ordinary edits', () => {
    expect(buildUpdateRequestBody({ title: 'Renamed' }, 3)).toEqual({
      title: 'Renamed',
      expectedVersion: 3,
    });
  });

  test('retains explicit planning clears in the JSON PATCH body', () => {
    const body = buildUpdateRequestBody({
      type: null, role: null, scheduledAt: null, todayRank: null,
      waitingFor: [], requiresApprovalFrom: [], suggestedAssignee: null, parent: null,
    } as never, 4);

    expect(JSON.parse(JSON.stringify(body))).toEqual({
      type: null, role: null, scheduledAt: null, todayRank: null,
      waitingFor: [], requiresApprovalFrom: [], suggestedAssignee: null, parent: null,
      expectedVersion: 4,
    });
  });
});
