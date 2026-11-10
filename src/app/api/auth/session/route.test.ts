import { NextRequest } from 'next/server';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIRLOCK_TODO_NATIVE_IDENTITY_HEADER } from '../../../../lib/auth/airlock-native-identity';

const { human, createRelaySession } = vi.hoisted(() => ({ human: vi.fn(), createRelaySession: vi.fn(() => 'synthetic-mapped-session') }));
vi.mock('@/lib/auth/board-human', () => ({ boardHumanIdentityFromRequest: human }));
vi.mock('../../../../lib/auth/request', () => ({ authStore: () => ({ createRelaySession }), SESSION_COOKIE: 'kanban_session' }));
import { GET } from './route';
import { GET as login } from '../airlock/login/route';
import { GET as callback } from '../airlock/callback/route';
import { ownerBrowserReadAllowed } from '../../../../lib/auth/owner-browser-read';
const origin = 'https://todo-board.airlock.bezrabotnyi.com';
const pair = generateKeyPairSync('ed25519');
function request(options: { unsigned?: boolean; invalid?: boolean; userId?: string; project?: string; host?: string; path?: string } = {}) {
  const req = new NextRequest(origin + (options.path ?? '/api/auth/session'), { headers: { host: options.host ?? new URL(origin).host, cookie: 'kanban_session=synthetic-qa-session' } });
  if (!options.unsigned) {
    const now = Date.now();
    const payload = { v: 1, userId: options.userId ?? 'fixture-native-user', method: 'GET', path: options.path ?? '/api/auth/session', bodySha256: createHash('sha256').update('').digest('base64url'), project: options.project ?? '', issuedAtMs: now, expiresAtMs: now + 60_000 };
    const bytes = Buffer.from(JSON.stringify(payload));
    req.headers.set(AIRLOCK_TODO_NATIVE_IDENTITY_HEADER, options.invalid ? 'invalid' : bytes.toString('base64url') + '.' + sign(null, Buffer.concat([Buffer.from('airlock-todo-native-identity-v1\n'), bytes]), pair.privateKey).toString('base64url'));
  }
  return req;
}

describe('native browser session alignment (fast unit; expected1s, max20s)', () => {
  beforeEach(() => {
    vi.stubEnv('KANBAN_AIRLOCK_RELAY_URL', 'https://airlock.bezrabotnyi.com/auth/relay');
    vi.stubEnv('KANBAN_AIRLOCK_AGENT_ORIGIN', origin);
    vi.stubEnv('KANBAN_AIRLOCK_ACCOUNT_MAP', '{"fixture-native-user":"qa_member"}');
    vi.stubEnv('AIRLOCK_TODO_NATIVE_IDENTITY_PUBLIC_KEY', pair.publicKey.export({ format: 'pem', type: 'spki' }).toString());
    createRelaySession.mockClear();
    human.mockReset().mockResolvedValue({ username: 'qa_member', scope: 'work' });
  });
  afterEach(() => vi.unstubAllEnvs());
  it('returns401 for a foreign valid QA board session so AuthGate starts existing login', async () => {
    human.mockResolvedValue({ username: 'qa_foreign', scope: 'work' });
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ authenticated: false });
    expect(response.headers.get('set-cookie')).toBeNull();
  });
  it('recovers only the local QA cookie through existing native login and callback', async () => {
    human.mockImplementation(async (req: NextRequest) => ({ username: req.cookies.get('kanban_session')?.value === 'synthetic-mapped-session' ? 'qa_member' : 'qa_foreign', scope: 'work' }));
    expect((await GET(request())).status).toBe(401);
    const started = await login(request({ path: '/api/auth/airlock/login?next=%2F' }));
    expect(started.status).toBe(307);
    expect(started.headers.get('location')).toBe(origin + '/api/auth/airlock/callback');
    expect(createRelaySession).not.toHaveBeenCalled();
    const landing = request({ path: '/api/auth/airlock/callback' });
    landing.cookies.set('kanban_airlock_nonce', started.cookies.get('kanban_airlock_nonce')!.value);
    const admitted = await callback(landing);
    expect(admitted.status).toBe(307);
    expect(createRelaySession).toHaveBeenCalledExactlyOnceWith('qa_member');
    const probe = request();
    probe.cookies.set('kanban_session', admitted.cookies.get('kanban_session')!.value);
    expect((await GET(probe)).status).toBe(200);
    expect((await callback(landing)).status).toBe(403);
  });
  it('accepts only the existing matching mapped work session', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ authenticated: true, username: 'qa_member', scope: 'work' });
  });
  it('rejects invalid-present identity before a valid board cookie can be preferred', async () => {
    expect((await GET(request({ invalid: true }))).status).toBe(403);
    expect(human).not.toHaveBeenCalled();
  });
  it('requires a verifier key before consulting any board cookie', async () => {
    vi.stubEnv('AIRLOCK_TODO_NATIVE_IDENTITY_PUBLIC_KEY', '');
    expect((await GET(request())).status).toBe(503);
    expect(human).not.toHaveBeenCalled();
  });
  it('rejects nonempty project on the identity-only probe', async () => {
    expect((await GET(request({ project: 'unexpected' }))).status).toBe(403);
    expect(human).not.toHaveBeenCalled();
  });
  it('does not enroll an unmapped native caller or fall back to board cookie', async () => {
    expect((await GET(request({ userId: 'unmapped-user' }))).status).toBe(403);
    expect(human).not.toHaveBeenCalled();
  });
  it('requires the configured native origin', async () => {
    expect((await GET(request({ host: 'foreign.example' }))).status).toBe(404);
    expect(human).not.toHaveBeenCalled();
  });
  it('returns401 for wrong scope or absent board session', async () => {
    human.mockResolvedValueOnce({ username: 'qa_member', scope: 'personal' });
    expect((await GET(request())).status).toBe(401);
    human.mockResolvedValueOnce(null);
    expect((await GET(request())).status).toBe(401);
  });
  it('discriminates the existing cards mismatch branch from invalid signature with synthetic identities', async () => {
    vi.stubEnv('KANBAN_AIRLOCK_ACCOUNT_MAP', '{"fixture-native-user":"nikita"}');
    human.mockResolvedValue({ username: 'qa_foreign', scope: 'work' });
    await expect(ownerBrowserReadAllowed(request({ path: '/api/kanban/cards' }))).rejects.toThrow('native_owner_read_mismatch');
    await expect(ownerBrowserReadAllowed(request({ path: '/api/kanban/cards', invalid: true }))).rejects.toThrow('native_identity_invalid');
  });
  it('preserves the existing unsigned board session flow', async () => {
    human.mockResolvedValueOnce({ username: 'qa_foreign', scope: 'work' });
    expect((await GET(request({ unsigned: true }))).status).toBe(200);
  });
});
