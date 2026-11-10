import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { authenticate } = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock('@/lib/auth/request', () => ({ authStore: () => ({ authenticate }), SESSION_COOKIE: 'kanban_session' }));
import { GET, POST } from './route';

describe('board login entry', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    delete process.env.KANBAN_AIRLOCK_RELAY_URL;
    delete process.env.KANBAN_AIRLOCK_AGENT_ORIGIN;
    delete process.env.KANBAN_AIRLOCK_ACCOUNT_MAP;
  });

  it('offers the existing nonce-bound Airlock relay when configured and keeps only a local return path', async () => {
    process.env.KANBAN_AIRLOCK_RELAY_URL = 'https://airlock.bezrabotnyi.com/auth/relay';
    process.env.KANBAN_AIRLOCK_AGENT_ORIGIN = 'https://todo-board.airlock.bezrabotnyi.com';
    process.env.KANBAN_AIRLOCK_ACCOUNT_MAP = '{"airlock-test-user":"qa_airlock_test"}';
    const response = await GET(new NextRequest('https://todo-board.airlock.bezrabotnyi.com/auth/login?return_to=https%3A%2F%2Fevil.example%2Fx'));
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('/api/auth/airlock/login?next=%2F');
    expect(html).toContain('name="username"');
    expect(html).toContain('name="password"');
    expect(html).not.toContain('evil.example');
  });

  it('does not expose the Airlock relay when its server configuration is incomplete', async () => {
    const response = await GET(new NextRequest('https://todo-board.airlock.bezrabotnyi.com/auth/login'));
    expect(await response.text()).not.toContain('/api/auth/airlock/login');
  });
});

const PUBLIC_ORIGIN = 'http://127.0.0.1:43552';

function loginRequest(returnTo = '/', origin = 'http://localhost:3001'): NextRequest {
  return new NextRequest(`${origin}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      username: 'qa_exmanager_a', password: 'synthetic-password', totp: '123456', return_to: returnTo,
    }),
  });
}

describe('native form login redirect', () => {
  beforeEach(() => {
    vi.stubEnv('KANBAN_PUBLIC_ORIGIN', PUBLIC_ORIGIN);
    vi.stubEnv('NODE_ENV', 'production');
    authenticate.mockReturnValue('synthetic-session');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('returns to the configured public origin behind the internal gateway and keeps the session cookie', async () => {
    const response = await POST(loginRequest());
    expect(response.headers.get('location')).toBe(`${PUBLIC_ORIGIN}/`);
    const cookie = response.cookies.get('kanban_session');
    expect(cookie).toMatchObject({
      value: 'synthetic-session', httpOnly: true, secure: true, sameSite: 'lax', path: '/',
    });
  });

  it('uses 303 after form login so the browser follows with GET', async () => {
    const response = await POST(loginRequest('/', PUBLIC_ORIGIN));
    expect(response.status).toBe(303);
  });

  it.each(['/classic?view=mine#card', `${PUBLIC_ORIGIN}/classic?view=mine#card`])(
    'preserves the local return target %s',
    async returnTo => {
      const response = await POST(loginRequest(returnTo));
      expect(response.headers.get('location')).toBe(`${PUBLIC_ORIGIN}/classic?view=mine#card`);
    },
  );

  it('rejects an external return target', async () => {
    const response = await POST(loginRequest('https://attacker.invalid/collect'));
    expect(response.headers.get('location')).toBe(`${PUBLIC_ORIGIN}/`);
  });

  it.each([
    'https://qa-board.example.test//attacker.invalid/collect',
    '/.//attacker.invalid/collect',
  ])('does not reinterpret an already checked local pathname as another host: %s', async returnTo => {
    const origin = 'https://qa-board.example.test';
    vi.stubEnv('KANBAN_PUBLIC_ORIGIN', origin);
    const response = await POST(loginRequest(returnTo, origin));
    expect(new URL(response.headers.get('location')!).origin).toBe(origin);
  });

  it('does not preserve URL userinfo in the return target', async () => {
    const origin = 'https://qa-board.example.test';
    vi.stubEnv('KANBAN_PUBLIC_ORIGIN', origin);
    const response = await POST(loginRequest('https://user:password@qa-board.example.test/classic', origin));
    expect(response.headers.get('location')).toBe(`${origin}/classic`);
  });

  it('still rejects invalid credentials without a redirect or cookie', async () => {
    authenticate.mockReturnValue(null);
    const response = await POST(loginRequest());
    expect(response.status).toBe(401);
    expect(response.headers.has('location')).toBe(false);
    expect(response.cookies.get('kanban_session')).toBeUndefined();
  });
});
