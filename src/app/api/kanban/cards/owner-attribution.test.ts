import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KanbanCard } from '@/lib/kanban/types';

const {
  createCard,
  updateCard,
  validateTransition,
  dispatchCardEvent,
  startDueReminderScheduler,
  tasksDirForScope,
  identity,
  authenticated,
  managerAuthorized,
} = vi.hoisted(() => ({
  createCard: vi.fn(),
  updateCard: vi.fn(),
  validateTransition: vi.fn(),
  dispatchCardEvent: vi.fn(),
  startDueReminderScheduler: vi.fn(),
  tasksDirForScope: vi.fn(),
  identity: { current: { username: 'anonymous', scope: 'work' } as { username: string; scope: 'work' | 'personal' } },
  authenticated: { current: null as null | { username: string; scope: 'work' | 'personal' } },
  managerAuthorized: { current: false },
}));

vi.mock('@/lib/kanban/file-store', () => ({ createCard, updateCard, getAllCards: vi.fn() }));
vi.mock('../../../../lib/kanban/project-store', () => ({ listProjects: vi.fn() }));
vi.mock('@/lib/kanban/due-at', () => ({ normalizeDueAt: vi.fn((value: unknown) => value) }));
vi.mock('@/lib/kanban/transition-policy', () => ({ validateTransition, NIKITA_ACTOR: 'nikita' }));
vi.mock('@/lib/auth/request', () => ({
  boardIdentityFromRequest: () => identity.current,
  managerRequestAuthorized: () => managerAuthorized.current,
  nativeProjectAccessContextFromRequest: vi.fn(async () => null),
}));
vi.mock('@/lib/auth/board-human', () => ({ boardHumanIdentityFromRequest: async () => authenticated.current }));
vi.mock('@/lib/auth/data-scope', () => ({ tasksDirForScope }));
vi.mock('@/lib/notifications/push', () => ({ dispatchCardEvent }));
vi.mock('@/lib/notifications/scheduler', () => ({ startDueReminderScheduler }));

import { POST } from './route';

const card = {
  id: 'created',
  title: 'QA task',
  description: '',
  column: 'inbox',
  priority: 'medium',
  tags: [],
  order: 0,
  created: '2026-10-26T00:00:00.000Z',
  updated: '2026-10-26T00:00:00.000Z',
  fileName: 'qa-task.md',
  version: 1,
  project: 'UX QA',
  assignees: [],
  owner: 'nikita',
} as KanbanCard;

describe('POST /api/kanban/cards owner attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    identity.current = { username: 'anonymous', scope: 'work' };
    authenticated.current = null;
    managerAuthorized.current = false;
    tasksDirForScope.mockReturnValue('/scoped/work');
    createCard.mockReturnValue(card);
    updateCard.mockImplementation((_id: string, updates: { owner?: string }) => ({ ...card, ...updates }));
    validateTransition.mockReturnValue({ kind: 'accepted', patch: {} });
    dispatchCardEvent.mockResolvedValue({ sent: 0, failed: 0, removed: 0, skipped: true });
  });

  it('uses the server-verified human identity instead of a request-body owner', async () => {
    authenticated.current = { username: 'marina', scope: 'work' };
    validateTransition.mockReturnValue({ kind: 'accepted', patch: { owner: 'marina' } });

    const response = await POST(new NextRequest('http://localhost/api/kanban/cards', {
      method: 'POST',
      body: JSON.stringify({ title: 'QA task', project: 'UX QA', owner: 'nikita' }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(201);
    expect(validateTransition).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ title: 'QA task', project: 'UX QA', owner: 'marina' }),
      expect.objectContaining({ origin: 'human-ui', actor: 'marina', isCreation: true }),
    );
    expect(updateCard).toHaveBeenCalledWith('created', { owner: 'marina' }, undefined, '/scoped/work');
    expect((await response.json()).card.owner).toBe('marina');
  });

  it('ignores a requested owner when there is no verified human session', async () => {
    const response = await POST(new NextRequest('http://localhost/api/kanban/cards', {
      method: 'POST',
      body: JSON.stringify({ title: 'QA task', project: 'UX QA', owner: 'marina' }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(201);
    expect(validateTransition.mock.calls[0][1]).not.toHaveProperty('owner');
    expect(updateCard).not.toHaveBeenCalled();
    expect((await response.json()).card.owner).toBe('nikita');
  });
});
