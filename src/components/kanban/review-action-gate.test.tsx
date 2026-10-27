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

  it('does not let the owner accept a review card without a result', () => {
    expect(reviewActionAccess({ ...ready, resultHistory: [] }, 'nikita')).toBe('reviewer-required');
  });
});
