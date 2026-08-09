import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AuthStore, hashPassword, verifyPassword } from './store';
import { generateTotpSecret, generateTotp } from './totp';

describe('AuthStore', () => {
  it('hashes passwords and verifies only the original', () => {
    const encoded = hashPassword('correct horse battery staple');
    expect(verifyPassword('correct horse battery staple', encoded)).toBe(true);
    expect(verifyPassword('wrong horse battery staple', encoded)).toBe(false);
  });

  it('requires TOTP for the owner session and isolates OAuth scope', () => {
    let now = 1_700_000_000;
    const store = new AuthStore({ rootDir: mkdtempSync(path.join(tmpdir(), 'kanban-auth-')), encryptionKey: 'a'.repeat(32), now: () => now });
    const secret = generateTotpSecret();
    store.bootstrap('owner', 'correct horse battery staple', secret);
    expect(store.authenticate('owner', 'correct horse battery staple', '000000')).toBeNull();
    const session = store.authenticate('owner', 'correct horse battery staple', generateTotp(secret, now * 1000));
    expect(session && store.validateSession(session)).toBe('owner');
    const code = store.createAuthorizationCode('owner', 'chatgpt-kanban', 'https://chat.openai.com/a/callback', 'openid kanban:work');
    const token = store.exchangeAuthorizationCode(code, 'chatgpt-kanban', 'https://chat.openai.com/a/callback');
    expect(token?.scope).toBe('work');
    expect(token && store.validateAccessToken(token.accessToken)?.scope).toBe('work');
    expect(token && store.validateAccessToken(token.accessToken)?.scope).not.toBe('personal');
    now += 31 * 24 * 60 * 60;
    expect(token && store.validateAccessToken(token.accessToken)).toBeNull();
  });
});
