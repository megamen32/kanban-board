import { describe, expect, it } from 'vitest';
import { isAutomatedQaAccount } from './qa-notification';

describe('isolated QA notification routing', () => {
  it('suppresses notifications to real humans only for dedicated QA accounts', () => {
    for (const owner of ['qa_exmanager_a', 'qa_exmanager_b', 'testlogin', ' QA_EXMANAGER_A '])
      expect(isAutomatedQaAccount(owner)).toBe(true);
    for (const owner of ['nikita', 'oleg', 'roomhacker', '', undefined])
      expect(isAutomatedQaAccount(owner)).toBe(false);
  });
});
