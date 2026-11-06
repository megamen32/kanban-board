import { NextRequest } from 'next/server';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { identity } = vi.hoisted(() => ({
  identity: { current: null as { username: string; scope: 'work' | 'personal' } | null },
}));

vi.mock('@/lib/auth/board-human', () => ({
  boardHumanIdentityFromRequest: vi.fn(async () => identity.current),
}));

import { GET } from './route';

let authDir: string;

function writeCredentials(content: string, mode: number = 0o600): void {
  const filePath = path.join(authDir, 'keeper-credentials.json');
  fs.writeFileSync(filePath, content, { mode });
  fs.chmodSync(filePath, mode);
}

beforeEach(() => {
  authDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-status-'));
  process.env.KANBAN_AUTH_DIR = authDir;
  process.env.KEEPER_API_URL = 'http://keeper-calendar-internal';
  process.env.KEEPER_PUBLIC_URL = 'https://keeper-calendar.airlock.bezrabotnyi.com';
  identity.current = { username: 'nikita', scope: 'work' };
});

afterEach(() => {
  fs.rmSync(authDir, { recursive: true, force: true });
  delete process.env.KANBAN_AUTH_DIR;
  delete process.env.KEEPER_API_URL;
  delete process.env.KEEPER_PUBLIC_URL;
});

async function payload(request: NextRequest, status: number): Promise<Record<string, unknown>> {
  const response = await GET(request);
  expect(response.status).toBe(status);
  return await response.json().catch(() => ({}));
}

describe('calendar status endpoint (per user, no secrets)', () => {
  it('answers 401 without identity', async () => {
    identity.current = null;
    const body = await payload(new NextRequest('http://localhost/api/kanban/calendar/status'), 401);
    expect(body.error).toBe('authentication required');
  });

  it('answers 403 to service bearers and to non-board accounts', async () => {
    const bearer = await payload(new NextRequest('http://localhost/x', { headers: { Authorization: 'Bearer kanban_service_token' } }), 403);
    expect(bearer.error).toBe('service_bearer_forbidden');
    identity.current = { username: 'random_sso_user', scope: 'work' };
    const foreign = await payload(new NextRequest('http://localhost/x'), 403);
    expect(foreign.error).toBe('calendar_bridge_not_available_for_account');
    expect(JSON.stringify(foreign)).not.toContain('kpr_');
  });

  it('reports enabled with connected false while no user account exists', async () => {
    const body = await payload(new NextRequest('http://localhost/x'), 200);
    expect(body).toEqual({
      enabled: true,
      connected: false,
      publicUrl: 'https://keeper-calendar.airlock.bezrabotnyi.com',
    });
  });

  it('reports disabled when KEEPER_API_URL is not configured', async () => {
    delete process.env.KEEPER_API_URL;
    const body = await payload(new NextRequest('http://localhost/x'), 200);
    expect(body.enabled).toBe(false);
    expect(body.connected).toBe(false);
  });

  it('reports connected true only for the user with an operator-managed credential', async () => {
    writeCredentials(JSON.stringify({
      version: 1,
      credentials: { nikita: { bearer: 'kpr_secret', calendarId: 'cal-1' } },
    }));
    const body = await payload(new NextRequest('http://localhost/x'), 200);
    expect(body.enabled).toBe(true);
    expect(body.connected).toBe(true);
    expect(JSON.stringify(body)).not.toContain('kpr_secret');
    expect(JSON.stringify(body)).not.toContain('cal-1');
  });

  it('reports a broken protected store as unavailable instead of a fake state', async () => {
    writeCredentials('{broken', 0o600);
    const body = await payload(new NextRequest('http://localhost/x'), 200);
    expect(body.enabled).toBe(true);
    expect(body.connected).toBe(false);
    expect(body.storeUnavailable).toBe(true);
  });
});
