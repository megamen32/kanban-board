import { describe, expect, it } from 'vitest';
import { hasCardHistory } from './card-history';

describe('card history disclosure', () => {
  it('is hidden when the card has no saved result or review records', () => {
    expect(hasCardHistory({})).toBe(false);
    expect(hasCardHistory({ resultHistory: [], reviewHistory: [] })).toBe(false);
  });

  it('is shown only for actual saved result or review history', () => {
    expect(hasCardHistory({ resultHistory: [{ summary: 'saved', evidenceRefs: [], submittedBy: 'qa', submittedAt: '2026-10-28T00:00:00Z' }] })).toBe(true);
    expect(hasCardHistory({ reviewHistory: [{ decision: 'accepted', actor: 'qa', decidedAt: '2026-10-28T00:00:00Z' }] })).toBe(true);
  });
});
