import { describe, expect, it, vi } from 'vitest';
import type { ConflictInfo } from '@/lib/kanban/types';
import { retryConflictEdit } from './conflict-choice';

// Fast unit: user's conflict choice must actually save with CAS; <1s/max5s.
describe('explicit local conflict choice', () => {
  const conflict = {
    cardId: 'qa', serverVersion: 6, clientVersion: 5,
    clientCard: { id: 'qa', title: 'User edit' },
    serverCard: { id: 'qa', title: 'Other edit', version: 6 },
  } as ConflictInfo;
  it('saves only the original user patch against the displayed server version', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'qa', version: 7 });
    expect(await retryConflictEdit(conflict, update)).toEqual({ id: 'qa', version: 7 });
    expect(update).toHaveBeenCalledExactlyOnceWith('qa', { title: 'User edit' }, 6);
  });
  it('retains a second conflict rather than bypassing version protection', async () => {
    const update = vi.fn().mockResolvedValue(null);
    expect(await retryConflictEdit(conflict, update)).toBeNull();
    expect(update.mock.calls[0][2]).toBe(6);
  });
});
