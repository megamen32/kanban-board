import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

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

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
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

it('returns a transcript for review without creating a card or notification', async () => {
  vi.stubEnv('KANBAN_WHISPER_API_KEY', 'fixture-only');
  vi.stubEnv('KANBAN_WHISPER_URL', 'https://whisper.fixture/v1');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ text: 'Проверить партнёрский Excel' }), {
    status: 200, headers: { 'content-type': 'application/json' },
  })));
  const form = new FormData();
  form.set('action', 'transcribe');
  form.set('audio', new File(['fixture audio'], 'voice.webm', { type: 'audio/webm' }));

  const response = await POST(new NextRequest('http://localhost/api/kanban/inbox-capture', { method: 'POST', body: form }));

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ text: 'Проверить партнёрский Excel' });
  expect(createCard).not.toHaveBeenCalled();
  expect(persistSecretaryTasks).not.toHaveBeenCalled();
  expect(dispatchNotification).not.toHaveBeenCalled();
});
