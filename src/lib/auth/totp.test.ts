import { describe, expect, it } from 'vitest';
import { generateTotp, verifyTotp } from './totp';

describe('TOTP', () => {
  it('matches RFC 6238 SHA-1 test vector at 59 seconds', () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    expect(generateTotp(secret, 59_000, 8)).toBe('94287082');
  });

  it('accepts a small clock skew but rejects invalid codes', () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    const code = generateTotp(secret, 30_000);
    expect(verifyTotp(secret, code, 30_000)).toBe(true);
    expect(verifyTotp(secret, code, 0)).toBe(true);
    expect(verifyTotp(secret, '00000000', 30_000)).toBe(false);
  });
});
