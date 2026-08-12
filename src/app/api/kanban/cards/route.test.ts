import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KanbanCard } from '@/lib/kanban/types';

const { createCard, updateCard, validateTransition, dispatchCardEvent, startDueReminderScheduler, tasksDirForScope, identity, authenticated } = vi.hoisted(() => ({
  createCard: vi.fn(),
  updateCard: vi.fn(),
  validateTransition: vi.fn(),
  dispatchCardEvent: vi.fn(),
  startDueReminderScheduler: vi.fn(),
  tasksDirForScope: vi.fn(),
  identity: { current: { username: 'nikita', scope: 'work' as const } },
  authenticated: { current: { username: 'nikita', scope: 'work' as const } as { username: string; scope: 'work' } | null },
}));

vi.mock('@/lib/kanban/file-store', () => ({ createCard, updateCard, getAllCards: vi.fn() }));
vi.mock('@/lib/kanban/due-at', () => ({ normalizeDueAt: vi.fn((value: unknown) => value) }));
vi.mock('@/lib/kanban/transition-policy', () => ({ validateTransition, NIKITA_ACTOR: 'nikita' }));
vi.mock('@/lib/auth/request', () => ({
  boardIdentityFromRequest: () => identity.current,
  identityFromRequest: () => authenticated.current,
}));
vi.mock('@/lib/auth/data-scope', () => ({ tasksDirForScope }));
vi.mock('@/lib/notifications/push', () => ({ dispatchCardEvent }));
vi.mock('@/lib/notifications/scheduler', () => ({ startDueReminderScheduler }));

import { POST } from './route';

const createdCard: KanbanCard = {
  id: 'created',
  title: 'Finish report',
  description: '',
  column: 'done',
  priority: 'medium',
  tags: [],
  order: 0,
  created: '2026-08-12T00:00:00.000Z',
  updated: '2026-08-12T00:00:00.000Z',
  fileName: 'created.md',
  version: 1,
  project: 'Work',
  assignees: [],
};

describe('POST /api/kanban/cards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    identity.current = { username: 'nikita', scope: 'work' };
    authenticated.current = { username: 'nikita', scope: 'work' };
    tasksDirForScope.mockReturnValue('/scoped/work');
    createCard.mockReturnValue(createdCard);
    updateCard.mockReturnValue(createdCard);
    dispatchCardEvent.mockResolvedValue({ sent: 1, failed: 0, removed: 0, skipped: false });
    validateTransition.mockReturnValue({ kind: 'accepted', patch: {} });
  });

  it('persists manual UI completion evidence with the authenticated actor', async () => {
    validateTransition.mockReturnValue({
      kind: 'accepted',
      patch: { column: 'done', completionEvidence: [{ type: 'manual_confirmation', actor: 'nikita' }] },
    });
    const response = await POST(new NextRequest('http://localhost/api/kanban/cards', {
      method: 'POST',
      body: JSON.stringify({ title: 'Finish report', project: 'Work', column: 'done' }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(201);
    expect(validateTransition).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ column: 'done' }),
      { origin: 'human-ui', actor: 'nikita', isCreation: true },
    );
    expect(updateCard).toHaveBeenCalledWith(
      'created',
      expect.objectContaining({
        column: 'done',
        completionEvidence: [expect.objectContaining({ type: 'manual_confirmation', actor: 'nikita' })],
      }),
      undefined,
      '/scoped/work',
    );
  });

  it('passes creation context so an authenticated human may choose initial assignees', async () => {
    validateTransition.mockReturnValue({ kind: 'accepted', patch: { assignees: ['marina'] } });
    const response = await POST(new NextRequest('http://localhost/api/kanban/cards', {
      method: 'POST',
      body: JSON.stringify({ title: 'Delegate report', project: 'Work', assignees: ['marina'] }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(201);
    expect(validateTransition).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ assignees: ['marina'] }),
      expect.objectContaining({ origin: 'human-ui', actor: 'nikita', isCreation: true }),
    );
    expect(validateTransition.mock.calls[0][2]).toEqual(expect.objectContaining({
      ownerAuthorization: {
        actor: 'nikita',
        evidence: expect.objectContaining({ type: 'direct-owner-command' }),
      },
    }));
  });

  it('does not authorize initial assignment for a non-owner authenticated user', async () => {
    authenticated.current = { username: 'marina', scope: 'work' };
    identity.current = { username: 'marina', scope: 'work' };
    validateTransition.mockReturnValue({ kind: 'rejected', reason: 'assignee_change_requires_owner_authorization' });

    const response = await POST(new NextRequest('http://localhost/api/kanban/cards', {
      method: 'POST',
      body: JSON.stringify({ title: 'Delegate report', project: 'Work', assignees: ['igor'] }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(400);
    expect(validateTransition.mock.calls[0][2]).toEqual({
      origin: 'human-ui',
      actor: 'marina',
      isCreation: true,
    });
    expect(createCard).not.toHaveBeenCalled();
  });

  it('does not pass client completion or approval evidence to policy', async () => {
    const response = await POST(new NextRequest('http://localhost/api/kanban/cards', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Forged audit',
        project: 'Work',
        completionEvidence: [{ type: 'machine-verifiable', check: 'caller-claimed' }],
        approvalEvidence: [{ type: 'direct-owner-command', actor: 'nikita' }],
        completedBy: 'attacker',
        completedAt: '2000-01-01T00:00:00.000Z',
      }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(201);
    expect(validateTransition.mock.calls[0][1]).not.toEqual(expect.objectContaining({
      completionEvidence: expect.anything(),
      approvalEvidence: expect.anything(),
      completedBy: expect.anything(),
      completedAt: expect.anything(),
    }));
  });

  it('does not let a request body escape the authenticated board scope', async () => {
    const response = await POST(new NextRequest('http://localhost/api/kanban/cards', {
      method: 'POST',
      body: JSON.stringify({ title: 'Scoped card', project: 'Work', scope: 'personal' }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(201);
    expect(tasksDirForScope).toHaveBeenCalledWith('work');
    expect(createCard).toHaveBeenCalledWith(
      'Scoped card',
      undefined,
      undefined,
      undefined,
      undefined,
      'Work',
      undefined,
      '/scoped/work',
      undefined,
    );
    expect(tasksDirForScope).not.toHaveBeenCalledWith('personal');
  });

  it('does not treat anonymous public HTTP as a human completion confirmation', async () => {
    identity.current = { username: 'anonymous', scope: 'work' };
    authenticated.current = null;
    validateTransition.mockReturnValue({
      kind: 'redirected',
      reason: 'automation_done_requires_review',
      patch: { column: 'review', needsReview: true },
    });

    const response = await POST(new NextRequest('http://localhost/api/kanban/cards', {
      method: 'POST',
      body: JSON.stringify({ title: 'Public completion', project: 'Work', column: 'done' }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(201);
    expect(validateTransition).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ column: 'done' }),
      { origin: 'automation', actor: 'anonymous', isCreation: true },
    );
  });

  it('accepts a personal role label rather than a global hardcoded role', async () => {
    const response = await POST(new NextRequest('http://localhost/api/kanban/cards', {
      method: 'POST',
      body: JSON.stringify({ title: 'Personal role', project: 'Work', role: 'Client success' }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(201);
    expect(createCard).toHaveBeenCalled();
  });
});
