import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tasksDirForScope: vi.fn(),
  dispatchCardEvent: vi.fn(),
}));

vi.mock('@/lib/auth/request', async () => import('../../../../../../lib/auth/request'));
vi.mock('@/lib/auth/data-scope', () => ({ tasksDirForScope: mocks.tasksDirForScope }));
vi.mock('@/lib/notifications/push', () => ({ dispatchCardEvent: mocks.dispatchCardEvent }));
vi.mock('@/lib/auth/board-human', async () => import('../../../../../../lib/auth/board-human'));
vi.mock('@/lib/kanban/file-store', async () => import('../../../../../../lib/kanban/file-store'));
vi.mock('@/lib/kanban/transition-policy', async () => import('../../../../../../lib/kanban/transition-policy'));

import { POST } from './route';
import { createCard, findCardById, updateCard } from '../../../../../../lib/kanban/file-store';

describe('authenticated human review route with the real store and policy', () => {
  let tasksDir: string;
  const authFetch = vi.fn();

  beforeEach(() => {
    tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-review-auth-'));
    mocks.tasksDirForScope.mockReturnValue(tasksDir);
    mocks.dispatchCardEvent.mockResolvedValue({ skipped: true });
    authFetch.mockReset().mockResolvedValue(new Response(null, {
      status: 204, headers: { 'X-GPTAdmin-User': 'roomhacker' },
    }));
    vi.stubGlobal('fetch', authFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(tasksDir, { recursive: true, force: true });
  });

  function authenticatedRequest(id: string, body: unknown) {
    return new NextRequest(`https://todo.bezrabotnyi.com/api/kanban/cards/${id}/review`, {
      method: 'POST',
      headers: { cookie: 'gptadmin_auth=verified-existing-session', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  function waitingCard(title: string) {
    const card = createCard(title, '', 'review', 'medium', [], 'fixture', ['executor'], tasksDir);
    const waiting = updateCard(card.id, {
      needsReview: true,
      requiresApprovalFrom: ['nikita'],
      resultHistory: [{ summary: 'Executor result', evidenceRefs: ['source:event-1'],
        submittedBy: 'exmanager-service', submittedAt: '2026-10-20T12:00:00Z' }],
    }, card.version, tasksDir);
    if ('conflict' in waiting) throw new Error('unexpected fixture conflict');
    return waiting;
  }

  it('accepts only the identity verified from the existing gateway cookie and checks the version', async () => {
    const waiting = waitingCard('Human accept');
    const stale = await POST(authenticatedRequest(waiting.id, {
      action: 'accept', expectedVersion: waiting.version - 1, actor: 'marina',
    }), { params: Promise.resolve({ id: waiting.id }) });
    expect(stale.status).toBe(409);
    expect(findCardById(waiting.id, tasksDir)).toEqual(waiting);

    const response = await POST(authenticatedRequest(waiting.id, {
      action: 'accept', expectedVersion: waiting.version, actor: 'marina',
    }), { params: Promise.resolve({ id: waiting.id }) });
    expect(response.status).toBe(200);
    expect(authFetch).toHaveBeenCalledWith('https://auth.bezrabotnyi.com/check', expect.objectContaining({
      headers: { Cookie: 'gptadmin_auth=verified-existing-session' }, redirect: 'error', cache: 'no-store',
    }));
    expect((await response.json()).card).toMatchObject({
      column: 'done', needsReview: false, completedBy: 'nikita',
      resultHistory: waiting.resultHistory,
      reviewHistory: [expect.objectContaining({ decision: 'accepted', actor: 'nikita' })],
    });
  });

  it('records authenticated human rework and preserves the earlier executor result', async () => {
    const waiting = waitingCard('Human rework');
    const response = await POST(authenticatedRequest(waiting.id, {
      action: 'rework', expectedVersion: waiting.version, note: 'Add the missing source comparison.', actor: 'marina',
    }), { params: Promise.resolve({ id: waiting.id }) });
    expect(response.status).toBe(200);
    const { card } = await response.json();
    expect(card).toMatchObject({
      column: 'in-progress', needsReview: false, nextAction: 'Add the missing source comparison.',
      resultHistory: waiting.resultHistory,
    });
    expect(card).not.toHaveProperty('completedBy');
    expect(card.reviewHistory[0]).toMatchObject({
      decision: 'rework', actor: 'nikita', note: 'Add the missing source comparison.',
    });
  });
});
