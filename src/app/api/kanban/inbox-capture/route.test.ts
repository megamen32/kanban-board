import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';

const { createCard, updateCard, extractSecretaryTasks, persistSecretaryTasks, dispatchNotification } = vi.hoisted(() => ({
  createCard: vi.fn(), updateCard: vi.fn(), extractSecretaryTasks: vi.fn(),
  persistSecretaryTasks: vi.fn(), dispatchNotification: vi.fn(),
}));
vi.mock('@/lib/kanban/file-store', () => ({ createCard, updateCard }));
vi.mock('@/lib/auth/request', () => ({ boardIdentityFromRequest: () => ({ username: 'nikita', scope: 'work' }) }));
vi.mock('@/lib/auth/data-scope', () => ({ tasksDirForScope: () => '/own-fixture' }));
vi.mock('@/lib/notifications/push', () => ({ dispatchNotification }));
vi.mock('@/lib/kanban/secretary', () => ({
  extractSecretaryTasks, persistSecretaryTasks, SecretaryUnavailableError: class extends Error {},
}));
import { POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  extractSecretaryTasks.mockResolvedValue([]);
  persistSecretaryTasks.mockReturnValue([]);
  createCard.mockReturnValue({ id: 'note', title: 'Own note' });
  updateCard.mockReturnValue({ id: 'note', title: 'Own note', column: 'inbox' });
  dispatchNotification.mockResolvedValue(undefined);
});

it('preserves a note when classification yields no tasks (fast unit, <1s/max10s)', async () => {
  const response = await POST(new NextRequest('http://localhost/api/kanban/inbox-capture', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'Own note', owner: 'own-fixture' }),
  }));
  expect(response.status).toBe(201);
  const data = await response.json();
  expect(data.cards).toHaveLength(1);
  expect(data.cards[0].column).toBe('inbox');
  expect(createCard).toHaveBeenCalledWith('Own note', 'Own note', 'inbox', 'medium', ['inbox-capture'], 'Inbox', [], '/own-fixture');
});
