import { NextRequest } from 'next/server';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIRLOCK_TODO_NATIVE_IDENTITY_HEADER, requestPathAndQuery } from '../../../../../lib/auth/airlock-native-identity';
import { AIRLOCK_RELAY_COOKIE } from '../../../../../lib/auth/airlock-relay';

const { createRelaySession } = vi.hoisted(() => ({ createRelaySession: vi.fn(() => 'fixture-board-session') }));
vi.mock('../../../../../lib/auth/request', () => ({ authStore: () => ({ createRelaySession }), SESSION_COOKIE: 'kanban_session' }));
import { GET } from './route';
import { GET as callback } from '../callback/route';

const origin = 'https://todo-board.airlock.bezrabotnyi.com';
const loginPath = '/api/auth/airlock/login?next=%2F';
const pair = generateKeyPairSync('ed25519');
const domain = Buffer.from('airlock-todo-native-identity-v1\n');
function nativeRequest(path = loginPath, options: { signedPath?: string; method?: string; body?: string; project?: string; expired?: boolean; cookie?: string; host?: string } = {}) {
  const request = new NextRequest(origin + path, { headers: { host: options.host ?? new URL(origin).host, ...(options.cookie ? { cookie: options.cookie } : {}) } });
  const now = Date.now() - (options.expired ? 180_000 : 0);
  const payload = { v: 1, userId: 'fixture-user', method: options.method ?? 'GET', path: options.signedPath ?? requestPathAndQuery(request),
    bodySha256: createHash('sha256').update(options.body ?? '').digest('base64url'), project: options.project ?? '', issuedAtMs: now, expiresAtMs: now + 60_000 };
  const bytes = Buffer.from(JSON.stringify(payload));
  request.headers.set(AIRLOCK_TODO_NATIVE_IDENTITY_HEADER, bytes.toString('base64url') + '.' + sign(null, Buffer.concat([domain, bytes]), pair.privateKey).toString('base64url'));
  return request;
}

describe('Todo native login admission (fast unit; expected 2s, maximum 20s)', () => {
  beforeEach(() => {
    vi.stubEnv('KANBAN_AIRLOCK_RELAY_URL', 'https://airlock.bezrabotnyi.com/auth/relay');
    vi.stubEnv('KANBAN_AIRLOCK_AGENT_ORIGIN', origin);
    vi.stubEnv('KANBAN_AIRLOCK_ACCOUNT_MAP', '{"fixture-user":"fixture_member"}');
    vi.stubEnv('AIRLOCK_TODO_NATIVE_IDENTITY_PUBLIC_KEY', pair.publicKey.export({ format: 'pem', type: 'spki' }).toString());
    createRelaySession.mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('keeps an admitted native login inside the app and re-verifies identity at the one-time callback', async () => {
    const response = await GET(nativeRequest());
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(origin + '/api/auth/airlock/callback');
    const handshake = response.cookies.get(AIRLOCK_RELAY_COOKIE);
    expect(handshake?.httpOnly).toBe(true);
    expect(handshake?.secure).toBe(true);
    expect(response.cookies.get('kanban_session')).toBeUndefined();
    expect(createRelaySession).not.toHaveBeenCalled();
    const request = nativeRequest('/api/auth/airlock/callback', { cookie: AIRLOCK_RELAY_COOKIE + '=' + handshake!.value });
    const admitted = await callback(request);
    expect(admitted.status).toBe(307);
    expect(admitted.headers.get('location')).toBe(origin + '/');
    expect(admitted.cookies.get('kanban_session')?.value).toBe('fixture-board-session');
    expect(createRelaySession).toHaveBeenCalledWith('fixture_member');
    expect((await callback(request)).status).toBe(403);
  });

  it('preserves unsigned legacy relay even when a bare caller header is supplied', async () => {
    const request = new NextRequest(origin + loginPath, { headers: { 'x-airlock-caller': 'untrusted-caller' } });
    const response = await GET(request);
    const destination = new URL(response.headers.get('location')!);
    expect(destination.origin + destination.pathname).toBe('https://airlock.bezrabotnyi.com/auth/relay');
    expect(destination.searchParams.get('return')).toBe(origin + '/api/auth/airlock/callback');
    expect(destination.searchParams.get('nonce')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(response.cookies.get(AIRLOCK_RELAY_COOKIE)?.httpOnly).toBe(true);
  });

  it('rejects a present invalid signature without falling back to a caller header or relay', async () => {
    const request = nativeRequest();
    request.headers.set(AIRLOCK_TODO_NATIVE_IDENTITY_HEADER, 'invalid');
    request.headers.set('x-airlock-caller', 'untrusted-caller');
    const response = await GET(request);
    expect(response.status).toBe(403);
    expect(response.headers.get('location')).toBeNull();
    expect(response.cookies.get(AIRLOCK_RELAY_COOKIE)).toBeUndefined();
  });

  it.each([
    { expired: true }, { signedPath: '/api/auth/airlock/callback' }, { method: 'POST' },
    { body: 'different-body' }, { project: 'unexpected-project' },
  ])('rejects expired or request-mismatched native login %j', async options => {
    const response = await GET(nativeRequest(loginPath, options));
    expect(response.status).toBe(403);
    expect(response.headers.get('location')).toBeNull();
    expect(response.cookies.get(AIRLOCK_RELAY_COOKIE)).toBeUndefined();
  });

  it('fails closed when the native verifier is unconfigured', async () => {
    vi.stubEnv('AIRLOCK_TODO_NATIVE_IDENTITY_PUBLIC_KEY', '');
    expect((await GET(nativeRequest())).status).toBe(503);
  });

  it('rejects native login on an unconfigured host', async () => {
    expect((await GET(nativeRequest(loginPath, { host: 'foreign.example' }))).status).toBe(404);
  });
});
