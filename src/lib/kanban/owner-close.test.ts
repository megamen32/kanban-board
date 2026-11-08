import { describe, expect, it } from 'vitest';
import type { KanbanCard } from './types';
import { canOwnerClose, decideOwnerClose, parseOwnerClose, isOwnerClosedWithoutVerification } from './owner-close';

const card = {owner: 'nikita', column: 'review', version: 3} as KanbanCard;
describe('human owner closing', () => {
  it('accepts only a positive CAS version with no caller claims', () => {
    expect(parseOwnerClose({expectedVersion: 3})).toEqual({expectedVersion: 3});
    for (const value of [null, [], {}, {expectedVersion: 0}, {expectedVersion: '3'}, {expectedVersion: 3, actor: 'nikita'}]) {
      expect(parseOwnerClose(value)).toBeNull();
    }
  });
  it('uses authenticated owner aliases, including legacy owner fallback', () => {
    expect(canOwnerClose(card, 'roomhacker')).toBe(true);
    expect(canOwnerClose({...card, owner: undefined}, 'nikita')).toBe(true);
    expect(canOwnerClose(card, undefined)).toBe(false);
    expect(canOwnerClose({...card, owner: 'someone'}, 'nikita')).toBe(false);
    expect(canOwnerClose({...card, column: 'done'}, 'nikita')).toBe(false);
  });
  it('records the owner decision without declaring AI evidence verified', () => {
    const decision = decideOwnerClose(card, {expectedVersion: 3}, 'roomhacker');
    expect(decision.kind).toBe('accepted');
    if (decision.kind !== 'accepted') throw new Error('not accepted');
    expect(decision.patch).toMatchObject({column: 'done', completedBy: 'roomhacker', needsReview: false});
    expect(decision.patch).not.toHaveProperty('reviewHistory');
    expect(decision.patch.completionEvidence?.[0].type).toBe('owner_closed_without_verification');
  });
});

describe('owner-close audit and CAS regressions', () => {
  it('rejects future and stale versions before deriving an authorized patch', () => {
    for (const expectedVersion of [2, 4]) {
      expect(decideOwnerClose(card, {expectedVersion}, 'nikita')).toEqual({
        kind: 'rejected', status: 409, reason: 'version_conflict',
      });
    }
  });
  it('distinguishes a new owner close from an older accepted AI review', () => {
    const at = '2026-11-08T00:00:00Z';
    const closed = {...card, column: 'done', completedAt: at, completedBy: 'nikita',
      reviewHistory: [{decision: 'accepted', actor: 'reviewer', decidedAt: '2026-11-07T00:00:00Z'}],
      completionEvidence: [{type: 'owner_closed_without_verification', origin: 'human-ui', actor: 'nikita', decidedAt: at}]} as KanbanCard;
    expect(isOwnerClosedWithoutVerification(closed)).toBe(true);
    expect(isOwnerClosedWithoutVerification({...closed, completedAt: '2026-11-09T00:00:00Z'})).toBe(false);
    expect(isOwnerClosedWithoutVerification({...closed, column: 'todo'})).toBe(false);
  });
});
