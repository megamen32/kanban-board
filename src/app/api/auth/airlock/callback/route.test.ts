import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createRelaySession } = vi.hoisted(() => ({
  createRelaySession: vi.fn(() => 'opaque-relay-session'),
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
  KANBAN_AIRLOCK_ACCOUNT_MAP: '{"u-test-0001":"qa_airlock_test"}',
};

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

describe('airlock relay callback', () => {
  beforeEach(() => {
    createRelaySession.mockClear();
    createRelaySession.mockReturnValue('opaque-relay-session');
    Object.assign(process.env, config);
  });

  afterEach(() => {
    delete process.env.KANBAN_AIRLOCK_RELAY_URL;
    delete process.env.KANBAN_AIRLOCK_AGENT_ORIGIN;
    delete process.env.KANBAN_AIRLOCK_ACCOUNT_MAP;
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
