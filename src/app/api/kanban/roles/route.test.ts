import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  identity: null as { username: string; scope: 'work' | 'personal' } | null,
  manager: false,
  getRoles: vi.fn((owner: string) => [{ id: owner, label: owner, order: 0 }]),
  saveRoles: vi.fn((owner: string, roles: unknown[]) => roles),
}));

vi.mock('@/lib/auth/board-human', () => ({ boardHumanIdentityFromRequest: vi.fn(async () => mocks.identity) }));
vi.mock('@/lib/auth/request', () => ({ managerRequestAuthorized: vi.fn(() => mocks.manager) }));
vi.mock('@/lib/kanban/roles-store', () => ({ getRoles: mocks.getRoles, saveRoles: mocks.saveRoles }));
vi.mock('@/lib/kanban/transition-policy', () => ({ NIKITA_ACTOR: 'nikita' }));

import { GET, PUT } from './route';

describe('kanban roles API identity scope', () => {
  beforeEach(() => {
    mocks.identity = null;
    mocks.manager = false;
    mocks.getRoles.mockClear();
    mocks.saveRoles.mockClear();
  });

  it('requires a verified identity for role reads', async () => {
    const response = await GET(new NextRequest('https://todo.example.test/api/kanban/roles?owner=oleg'));
    expect(response.status).toBe(401);
    expect(mocks.getRoles).not.toHaveBeenCalled();
  });

  it('lets an account read and update its own roles but blocks another account', async () => {
    mocks.identity = { username: 'oleg', scope: 'work' };
    const own = await GET(new NextRequest('https://todo.example.test/api/kanban/roles?owner=oleg'));
    expect(own.status).toBe(200);

    const other = await GET(new NextRequest('https://todo.example.test/api/kanban/roles?owner=nikita'));
    expect(other.status).toBe(403);
    expect(mocks.getRoles).toHaveBeenCalledTimes(1);

    const updateOther = await PUT(new NextRequest('https://todo.example.test/api/kanban/roles', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ owner: 'nikita', roles: [{ id: 'x', label: 'X', order: 0 }] }),
    }));
    expect(updateOther.status).toBe(403);
    expect(mocks.saveRoles).not.toHaveBeenCalled();
  });

  it('lets the configured board super-admin inspect another account without changing identity', async () => {
    mocks.identity = { username: 'nikita', scope: 'work' };
    const response = await GET(new NextRequest('https://todo.example.test/api/kanban/roles?owner=oleg'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ owner: 'oleg' });
  });
});
