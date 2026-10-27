import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/request', () => ({ authStore: () => ({ authenticate: vi.fn() }), SESSION_COOKIE: 'kanban_session' }));
import { GET } from './route';

describe('board login entry', () => {
  afterEach(() => {
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
