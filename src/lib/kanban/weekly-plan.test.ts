import { describe, expect, it } from 'vitest';
import { runAtomicWrites } from './weekly-plan';

describe('runAtomicWrites', () => {
  it('compensates completed writes when a later write fails', () => {
    const state = { first: false, second: false };

    expect(() => runAtomicWrites([
      {
        write: () => { state.first = true; return 'first'; },
        rollback: () => { state.first = false; },
      },
      {
        write: () => { throw new Error('forced-second-write-failure'); },
        rollback: () => { state.second = false; },
      },
    ])).toThrow('forced-second-write-failure');

    expect(state).toEqual({ first: false, second: false });
  });
});
