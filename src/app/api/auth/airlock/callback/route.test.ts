import { NextRequest } from 'next/server';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthStore } from '../../../../../lib/auth/store';
import { AIRLOCK_TODO_NATIVE_IDENTITY_HEADER, requestPathAndQuery } from '../../../../../lib/auth/airlock-native-identity';

const { createRelaySession } = vi.hoisted(() => ({
  createRelaySession: vi.fn((_username: string) => 'opaque-relay-session'),
}));

vi.mock('../../../../../lib/auth/request', () => ({
  authStore: () => ({ createRelaySession }),
  SESSION_COOKIE: 'kanban_session',
}));

import { GET } from './route';
import {
  AIRLOCK_RELAY_COOKIE,
  airlockRelayConfig,
  createRelayHandshake,
  relayHandshakeCookie,
} from '../../../../../lib/auth/airlock-relay';

const config = {
  KANBAN_AIRLOCK_RELAY_URL: 'https://airlock.bezrabotnyi.com/auth/relay',
  KANBAN_AIRLOCK_AGENT_ORIGIN: 'https://todo-board.airlock.bezrabotnyi.com',
  KANBAN_AIRLOCK_ACCOUNT_MAP: '{"u-test-0001":"qa_airlock_test","u-test-a":"qa_a","u-test-b":"qa_b"}',
};

const nativePair = generateKeyPairSync('ed25519');
const nativePublicKey = nativePair.publicKey.export({ format: 'pem', type: 'spki' }).toString();
const nativeSigningDomain = Buffer.from('airlock-todo-native-identity-v1\n', 'utf8');

const callerHeader = (user: Record<string, unknown> | null, kind = 'user', access = 'user') =>
  Buffer.from(JSON.stringify({
    kind, access,
    ...(user ? { user, initiator: user } : {}),
    origin: { interface: 'web', platform: '', clientId: '', execution: '' },
  }), 'utf8').toString('base64url');

const testUser = { id: 'u-test-0001', email: 'qa@example.com', displayName: 'QA', platformMember: true };

function callbackRequest(options: {
  host?: string;
  nonceCookie?: string;
  caller?: string;
} = {}): NextRequest {
  const headers = new Headers();
  headers.set('x-forwarded-proto', 'https');
  headers.set('host', options.host ?? new URL(config.KANBAN_AIRLOCK_AGENT_ORIGIN).host);
  if (options.caller !== undefined) headers.set('x-airlock-caller', options.caller);
  if (options.nonceCookie !== undefined) headers.set('cookie', `${AIRLOCK_RELAY_COOKIE}=${options.nonceCookie}`);
  return new NextRequest(`${config.KANBAN_AIRLOCK_AGENT_ORIGIN}/api/auth/airlock/callback`, { headers });
}

function nativeCallbackRequest(options: {
  userId?: string;
  path?: string;
  signedPath?: string;
  method?: string;
  signedMethod?: string;
  signedBody?: string;
  project?: string;
  issuedAtMs?: number;
  expiresAtMs?: number;
  nonceCookie?: string;
  host?: string;
  caller?: string;
} = {}): NextRequest {
  const headers = new Headers();
  headers.set('x-forwarded-proto', 'https');
  headers.set('host', options.host ?? new URL(config.KANBAN_AIRLOCK_AGENT_ORIGIN).host);
  if (options.caller !== undefined) headers.set('x-airlock-caller', options.caller);
  if (options.nonceCookie !== undefined) headers.set('cookie', `${AIRLOCK_RELAY_COOKIE}=${options.nonceCookie}`);
  const pathValue = options.path ?? '/api/auth/airlock/callback';
  const request = new NextRequest(`${config.KANBAN_AIRLOCK_AGENT_ORIGIN}${pathValue}`, {
    method: options.method ?? 'GET', headers,
  });
  const issuedAtMs = options.issuedAtMs ?? Date.now();
  const payload = {
    v: 1,
    userId: options.userId ?? 'u-test-a',
    method: options.signedMethod ?? options.method ?? 'GET',
    path: options.signedPath ?? requestPathAndQuery(request),
    bodySha256: createHash('sha256').update(options.signedBody ?? '').digest('base64url'),
    project: options.project ?? '',
    issuedAtMs,
    expiresAtMs: options.expiresAtMs ?? issuedAtMs + 60_000,
  };
  const bytes = Buffer.from(JSON.stringify(payload));
  const assertion = `${bytes.toString('base64url')}.${sign(null, Buffer.concat([nativeSigningDomain, bytes]), nativePair.privateKey).toString('base64url')}`;
  request.headers.set(AIRLOCK_TODO_NATIVE_IDENTITY_HEADER, assertion);
  return request;
}

describe('airlock relay callback', () => {
  beforeEach(() => {
    createRelaySession.mockReset();
    createRelaySession.mockReturnValue('opaque-relay-session');
    Object.assign(process.env, config);
    process.env.AIRLOCK_TODO_NATIVE_IDENTITY_PUBLIC_KEY = nativePublicKey;
  });

  afterEach(() => {
    delete process.env.KANBAN_AIRLOCK_RELAY_URL;
    delete process.env.KANBAN_AIRLOCK_AGENT_ORIGIN;
    delete process.env.KANBAN_AIRLOCK_ACCOUNT_MAP;
    delete process.env.AIRLOCK_TODO_NATIVE_IDENTITY_PUBLIC_KEY;
  });

  function primeHandshake(): string {
    return relayHandshakeCookie(createRelayHandshake(airlockRelayConfig(process.env), '/x', Date.now()));
  }

  it('mints a local work-scope session for an allow-listed platform user after a valid handshake', async () => {
    const request = callbackRequest({ nonceCookie: primeHandshake(), caller: callerHeader(testUser) });
    const response = await GET(request);
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://todo-board.airlock.bezrabotnyi.com/');
    expect(createRelaySession).toHaveBeenCalledWith('qa_airlock_test');
    const sessionCookie = response.cookies.get('kanban_session');
    expect(sessionCookie?.value).toBe('opaque-relay-session');
    expect(sessionCookie?.httpOnly).toBe(true);
    expect(sessionCookie?.sameSite).toBe('lax');
    // The one-time handshake cookie is cleared after use.
    expect(response.cookies.get(AIRLOCK_RELAY_COOKIE)?.maxAge).toBe(0);
  });

  it('mints separate ordinary sessions for signed SDK A/B identities without changing the owner', async () => {
    const tempParent = path.join(process.cwd(), '.tmp');
    mkdirSync(tempParent, { recursive: true });
    const rootDir = mkdtempSync(path.join(tempParent, 'airlock-callback-auth-'));
    try {
      const store = new AuthStore({ rootDir, encryptionKey: 'callback-fixture-key-that-is-long-enough-32' });
      store.bootstrap('owner-fixture', 'Fixture-Only-Password-492!', 'fixture-totp-secret');
      createRelaySession.mockImplementation(username => store.createRelaySession(username));

      const responseA = await GET(nativeCallbackRequest({ userId: 'u-test-a', nonceCookie: primeHandshake() }));
      const responseB = await GET(nativeCallbackRequest({ userId: 'u-test-b', nonceCookie: primeHandshake() }));
      expect(responseA.status).toBe(307);
      expect(responseB.status).toBe(307);
      const sessionA = responseA.cookies.get('kanban_session')?.value ?? '';
      const sessionB = responseB.cookies.get('kanban_session')?.value ?? '';
      expect(sessionA).toBeTruthy();
      expect(sessionB).toBeTruthy();
      expect(sessionA).not.toBe(sessionB);
      expect(store.validateSession(sessionA)).toBe('qa_a');
      expect(store.validateSession(sessionB)).toBe('qa_b');
      expect(responseA.cookies.get(AIRLOCK_RELAY_COOKIE)?.maxAge).toBe(0);
      expect(responseB.cookies.get(AIRLOCK_RELAY_COOKIE)?.maxAge).toBe(0);
      const saved = JSON.parse(readFileSync(path.join(rootDir, 'state.json'), 'utf8')) as {
        owner: { username: string };
      };
      expect(saved.owner.username).toBe('owner-fixture');
      expect(createRelaySession).toHaveBeenNthCalledWith(1, 'qa_a');
      expect(createRelaySession).toHaveBeenNthCalledWith(2, 'qa_b');
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('fails closed for invalid, expired, unmapped, mismatched, and replayed native assertions', async () => {
    const unmapped = await GET(nativeCallbackRequest({ userId: 'u-not-mapped', nonceCookie: primeHandshake() }));
    expect(unmapped.status).toBe(403);
    expect(createRelaySession).not.toHaveBeenCalled();

    const badSignature = nativeCallbackRequest({ nonceCookie: primeHandshake(), caller: callerHeader(testUser) });
    const [payload, signature] = badSignature.headers.get(AIRLOCK_TODO_NATIVE_IDENTITY_HEADER)!.split('.');
    badSignature.headers.set(AIRLOCK_TODO_NATIVE_IDENTITY_HEADER,
      `${payload}.${signature!.slice(0, -1)}${signature!.endsWith('A') ? 'B' : 'A'}`);
    expect((await GET(badSignature)).status).toBe(403);
    expect(createRelaySession).not.toHaveBeenCalled();

    const now = Date.now();
    const expired = await GET(nativeCallbackRequest({ nonceCookie: primeHandshake(),
      issuedAtMs: now - 180_000, expiresAtMs: now - 120_000 }));
    expect(expired.status).toBe(403);
    expect(createRelaySession).not.toHaveBeenCalled();

    const wrongMethod = await GET(nativeCallbackRequest({ nonceCookie: primeHandshake(), method: 'POST' }));
    expect(wrongMethod.status).toBe(403);
    const wrongPath = await GET(nativeCallbackRequest({ nonceCookie: primeHandshake(),
      signedPath: '/api/auth/other/callback' }));
    expect(wrongPath.status).toBe(403);
    const wrongBody = await GET(nativeCallbackRequest({ nonceCookie: primeHandshake(), signedBody: '{"project":""}' }));
    expect(wrongBody.status).toBe(403);
    expect(createRelaySession).not.toHaveBeenCalled();

    const wrongHost = await GET(nativeCallbackRequest({ host: 'todo.bezrabotnyi.com', nonceCookie: primeHandshake() }));
    expect(wrongHost.status).toBe(404);
    expect(createRelaySession).not.toHaveBeenCalled();

    const replay = nativeCallbackRequest({ nonceCookie: primeHandshake() });
    const first = await GET(replay);
    const second = await GET(replay);
    expect(first.status).toBe(307);
    expect(second.status).toBe(403);
    expect(createRelaySession).toHaveBeenCalledTimes(1);
  });

  it('rejects a caller whose platform user is not allow-listed without minting a session', async () => {
    const response = await GET(callbackRequest({
      nonceCookie: primeHandshake(),
      caller: callerHeader({ ...testUser, id: 'u-stranger' }),
    }));
    expect(response.status).toBe(403);
    expect(createRelaySession).not.toHaveBeenCalled();
  });

  it('rejects anonymous, non-member, or unattributed callers', async () => {
    const anonymous = await GET(callbackRequest({
      nonceCookie: primeHandshake(),
      caller: callerHeader(null, 'anonymous', 'public'),
    }));
    expect(anonymous.status).toBe(403);
    const nonMember = await GET(callbackRequest({
      nonceCookie: primeHandshake(),
      caller: callerHeader({ ...testUser, platformMember: false }),
    }));
    expect(nonMember.status).toBe(403);
    const noHeader = await GET(callbackRequest({ nonceCookie: primeHandshake() }));
    expect(noHeader.status).toBe(403);
    expect(createRelaySession).not.toHaveBeenCalled();
  });

  it('requires the one-time handshake cookie and blocks replays', async () => {
    const caller = callerHeader(testUser);
    const noCookie = await GET(callbackRequest({ caller }));
    expect(noCookie.status).toBe(403);

    const nonceCookie = primeHandshake();
    const first = await GET(callbackRequest({ nonceCookie, caller }));
    expect(first.status).toBe(307);
    const second = await GET(callbackRequest({ nonceCookie, caller }));
    expect(second.status).toBe(403);
    expect(createRelaySession).toHaveBeenCalledTimes(1);
  });

  it('refuses to run on any host other than the configured agent origin', async () => {
    const response = await GET(callbackRequest({
      host: 'todo.bezrabotnyi.com',
      nonceCookie: primeHandshake(),
      caller: callerHeader(testUser),
    }));
    expect(response.status).toBe(404);
    expect(createRelaySession).not.toHaveBeenCalled();
  });

  it('is inert when the relay login is not configured', async () => {
    delete process.env.KANBAN_AIRLOCK_RELAY_URL;
    delete process.env.KANBAN_AIRLOCK_AGENT_ORIGIN;
    const response = await GET(callbackRequest({ caller: callerHeader(testUser) }));
    expect(response.status).toBe(404);
    expect(createRelaySession).not.toHaveBeenCalled();
  });
});
