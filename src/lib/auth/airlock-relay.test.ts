import { describe, expect, it } from 'vitest';
import {
  airlockRelayConfig,
  airlockRelayLoginUrl,
  boardAccountForCaller,
  createRelayHandshake,
  readRelayHandshake,
  relayCallerIdentity,
  relayHandshakeCookie,
} from './airlock-relay';

const baseEnv = {
  KANBAN_AIRLOCK_RELAY_URL: 'https://airlock.bezrabotnyi.com/auth/relay',
  KANBAN_AIRLOCK_AGENT_ORIGIN: 'https://todo-board.airlock.bezrabotnyi.com',
  KANBAN_AIRLOCK_ACCOUNT_MAP: '{"u-test-0001":"qa_airlock_test"}',
};

const exampleEnv = {
  KANBAN_AIRLOCK_RELAY_URL: 'https://sso.example/auth/relay',
  KANBAN_AIRLOCK_RELAY_DOMAIN: 'example',
  KANBAN_AIRLOCK_AGENT_ORIGIN: 'https://board.airlock.example',
  KANBAN_AIRLOCK_ACCOUNT_MAP: '{"u-test-0001":"qa_airlock_test"}',
};

describe('airlock relay config', () => {
  it('is disabled unless the relay url and agent origin are configured', () => {
    expect(airlockRelayConfig({}).enabled).toBe(false);
    expect(airlockRelayConfig({ KANBAN_AIRLOCK_RELAY_URL: 'https://sso.example/auth/relay' }).enabled).toBe(false);
    expect(
      airlockRelayConfig({
        ...exampleEnv,
      }).enabled,
    ).toBe(true);
  });

  it('rejects a non-https relay url and accepts a configured relay domain', () => {
    expect(
      airlockRelayConfig({
        ...baseEnv,
        KANBAN_AIRLOCK_RELAY_URL: 'http://airlock.bezrabotnyi.com/auth/relay',
      }).enabled,
    ).toBe(false);
    expect(
      airlockRelayConfig({
        ...exampleEnv,
        KANBAN_AIRLOCK_RELAY_URL: 'http://sso.example/auth/relay',
      }).enabled,
    ).toBe(false);
  });
});

describe('airlock relay login url', () => {
  it('binds a fresh 32-byte nonce and returns the handshake for cookie storage', () => {
    const config = airlockRelayConfig(baseEnv);
    const handshake = createRelayHandshake(config, 'https://todo-board.airlock.bezrabotnyi.com/board', 1_000);
    expect(handshake.nonceRaw).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(handshake.nonceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(handshake.nonceHash).not.toContain(handshake.nonceRaw);
    expect(handshake.createdAtMs).toBe(1_000);
    const url = airlockRelayLoginUrl(config, handshake);
    expect(url.startsWith('https://airlock.bezrabotnyi.com/auth/relay?')).toBe(true);
    const parsed = new URL(url);
    expect(parsed.searchParams.get('nonce')).toBe(handshake.nonceRaw);
    expect(parsed.searchParams.get('return')).toBe(
      'https://todo-board.airlock.bezrabotnyi.com/api/auth/airlock/callback',
    );
  });
});

describe('readRelayHandshake', () => {
  it('accepts a matching unexpired nonce and consumes it', () => {
    const config = airlockRelayConfig(baseEnv);
    const handshake = createRelayHandshake(config, 'https://todo-board.airlock.bezrabotnyi.com/x', 1_000);
    const cookie = relayHandshakeCookie(handshake);
    expect(readRelayHandshake(cookie, 60_000)).toEqual({ ok: true });
    // One-time: the pending handshake is consumed after a successful read.
    expect(readRelayHandshake(cookie, 60_000)).toEqual({ ok: false, reason: 'state-mismatch' });
  });

  it('rejects a tampered cookie or expired handshake', () => {
    const config = airlockRelayConfig(baseEnv);
    const tamperHandshake = createRelayHandshake(config, 'https://todo-board.airlock.bezrabotnyi.com/x', 1_000);
    const cookie = relayHandshakeCookie(tamperHandshake);
    expect(readRelayHandshake('deadbeef.1000', 60_000)).toEqual({ ok: false, reason: 'state-mismatch' });
    expect(readRelayHandshake(`${cookie}x`, 60_000)).toEqual({ ok: false, reason: 'state-mismatch' });
    expect(readRelayHandshake(relayHandshakeCookie({ ...tamperHandshake, nonceHash: 'f'.repeat(64) }), 60_000)).toEqual({ ok: false, reason: 'state-mismatch' });

    const expiredHandshake = createRelayHandshake(config, 'https://todo-board.airlock.bezrabotnyi.com/x', 1_000);
    expect(readRelayHandshake(relayHandshakeCookie(expiredHandshake), 1_000 + 10 * 60_000 + 1)).toEqual({ ok: false, reason: 'expired' });
    expect(readRelayHandshake(undefined, 60_000)).toEqual({ ok: false, reason: 'missing' });
  });
});

describe('relayCallerIdentity', () => {
  const caller = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

  it('returns the platform-attributed user for a user-kind caller', () => {
    const header = caller({
      kind: 'user',
      access: 'user',
      user: { id: 'u-test-0001', email: 'qa@example.com', displayName: 'QA', platformMember: true },
      initiator: { id: 'u-test-0001', email: 'qa@example.com', displayName: 'QA', platformMember: true },
      origin: { interface: 'web', platform: '', clientId: '', execution: '' },
    });
    expect(relayCallerIdentity(header)).toEqual({
      kind: 'user',
      userId: 'u-test-0001',
      email: 'qa@example.com',
      displayName: 'QA',
      platformMember: true,
    });
  });

  it('returns null for anonymous, application, or malformed callers', () => {
    expect(relayCallerIdentity(caller({ kind: 'anonymous', access: 'public', origin: {} }))).toBeNull();
    expect(relayCallerIdentity(caller({ kind: 'application', access: 'user', origin: {} }))).toBeNull();
    expect(relayCallerIdentity(caller({ kind: 'user', access: 'public', user: { id: 'u1', platformMember: true }, initiator: { id: 'u1', platformMember: true }, origin: {} }))).toBeNull();
    expect(relayCallerIdentity('not-base64!!')).toBeNull();
    expect(relayCallerIdentity(caller({ kind: 'user', access: 'user', user: { id: '', platformMember: true } }))).toBeNull();
    expect(relayCallerIdentity(undefined)).toBeNull();
  });
});

describe('boardAccountForCaller', () => {
  it('maps only allow-listed airlock users to the existing test account', () => {
    const account = boardAccountForCaller({ kind: 'user', userId: 'u-test-0001', email: 'qa@example.com', displayName: 'QA', platformMember: true }, baseEnv);
    expect(account).toEqual({ username: 'qa_airlock_test', scope: 'work' });
  });

  it('rejects unmapped users instead of minting accounts or inheriting roles', () => {
    expect(boardAccountForCaller({ kind: 'user', userId: 'u-other', email: 'x@example.com', displayName: 'X', platformMember: true }, baseEnv)).toBeNull();
    expect(boardAccountForCaller({ kind: 'user', userId: 'u-test-0001', email: 'qa@example.com', displayName: 'QA', platformMember: false }, baseEnv)).toBeNull();
  });
});
