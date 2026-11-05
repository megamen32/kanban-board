import { describe, expect, it } from 'vitest';
import { reviewActionAccess } from './review-action-gate';

describe('review action access', () => {
  const ready = { column: 'review', needsReview: true, requiresApprovalFrom: [], resultHistory: [{ summary: 'Result' }] };

  it('lets the owner decide a saved result when no reviewer was assigned', () => {
    expect(reviewActionAccess(ready, 'nikita')).toBe('owner-review');
    expect(reviewActionAccess(ready, 'oleg')).toBe('reviewer-required');
  });

  it('keeps explicit reviewer grants authoritative', () => {
    expect(reviewActionAccess({ ...ready, requiresApprovalFrom: ['oleg'] }, 'nikita')).toBe('reviewer-required');
    expect(reviewActionAccess({ ...ready, requiresApprovalFrom: ['oleg'] }, 'oleg')).toBe('authorized');
  });

  it('recognizes the verified owner when the reviewer is stored under their display name', () => {
    expect(reviewActionAccess({ ...ready, owner: 'nikita', requiresApprovalFrom: ['Никита Розанов'] }, 'nikita')).toBe('authorized');
    expect(reviewActionAccess({ ...ready, owner: 'nikita', requiresApprovalFrom: ['Олег'] }, 'nikita')).toBe('reviewer-required');
  });

  it('lets the verified owner close their own unassigned review, without claiming a saved AI result', () => {
    expect(reviewActionAccess({ column: 'review', owner: 'nikita', needsReview: false }, 'nikita')).toBe('owner-review');
    expect(reviewActionAccess({ column: 'review', owner: 'nikita', needsReview: true, requiresApprovalFrom: ['oleg'] }, 'nikita')).toBe('reviewer-required');
  });

  it('exposes only owner recovery for a stranded v7 legacy review, never dot/reviewer acceptance', () => {
    const legacy = {column:'review',owner:'nikita',needsReview:false,
      requiresApprovalFrom:[],resultHistory:[],taskExecutionHistory:[],reviewHistory:[]};
    expect(reviewActionAccess(legacy,'nikita')).toBe('owner-review');
    expect(reviewActionAccess(legacy,'dot')).toBe('reviewer-required');
    expect(reviewActionAccess(legacy,'oleg')).toBe('reviewer-required');
    expect(reviewActionAccess(legacy,null)).toBe('login-required');
    expect(reviewActionAccess({...legacy, owner:'oleg'},'nikita')).toBe('not-awaiting-review');
    expect(reviewActionAccess({...legacy,resultHistory:[{summary:'result'}]},'nikita')).toBe('owner-review');
    expect(reviewActionAccess({...legacy,taskExecutionHistory:[{phase:'running'}]},'nikita')).toBe('owner-review');
  });

  it('does not let the owner accept a review card without a result', () => {
    expect(reviewActionAccess({ ...ready, resultHistory: [] }, 'nikita')).toBe('reviewer-required');
  });
});
