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
      projects: [],
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

  it('returns only the current user project names, never credentials or calendar ids', async () => {
    writeCredentials(JSON.stringify({
      version: 1,
      credentials: {
        nikita: { bearer: 'kpr_nikita_private', calendarId: 'calendar-nikita-default', projectCalendars: { Zebra: 'calendar-nikita-z', Alpha: 'calendar-nikita-a' } },
        oleg: { bearer: 'kpr_oleg_private', calendarId: 'calendar-oleg-default', projectCalendars: { Other: 'calendar-oleg-other' } },
      },
    }));
    const request = () => new NextRequest('http://localhost/api/kanban/calendar/status');
    const nikita = await payload(request(), 200);
    expect(nikita).toEqual({ enabled: true, connected: true, projects: ['Alpha', 'Zebra'], publicUrl: process.env.KEEPER_PUBLIC_URL });
    identity.current = { username: 'oleg', scope: 'work' };
    const oleg = await payload(request(), 200);
    expect(oleg).toEqual({ enabled: true, connected: true, projects: ['Other'], publicUrl: process.env.KEEPER_PUBLIC_URL });
    for (const body of [nikita, oleg]) {
      expect(JSON.stringify(body)).not.toMatch(/kpr_|calendar-nikita|calendar-oleg|bearer|calendarId/);
    }
    identity.current = { username: 'unknown', scope: 'work' };
    const unknown = await payload(request(), 403);
    expect(unknown).toEqual({ error: 'calendar_bridge_not_available_for_account' });
    expect(JSON.stringify(unknown)).not.toMatch(/Alpha|Zebra|Other|kpr_|calendarId/);
  });

  it('does not expose another account mapping to an allowed user without credentials', async () => {
    writeCredentials(JSON.stringify({ version: 1, credentials: {
      nikita: { bearer: 'kpr_private', calendarId: 'calendar-private', projectCalendars: { PrivateProject: 'calendar-project-private' } },
    } }));
    identity.current = { username: 'oleg', scope: 'work' };
    expect(await payload(new NextRequest('http://localhost/x'), 200)).toEqual({
      enabled: true, connected: false, projects: [], publicUrl: process.env.KEEPER_PUBLIC_URL,
    });
  });

  it('reports a broken protected store as unavailable instead of a fake state', async () => {
    writeCredentials('{broken', 0o600);
    const body = await payload(new NextRequest('http://localhost/x'), 200);
    expect(body.enabled).toBe(true);
    expect(body.connected).toBe(false);
    expect(body.storeUnavailable).toBe(true);
  });
});
