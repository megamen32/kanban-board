import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KanbanCard } from '@/lib/kanban/types';

const { findCardById, updateCard, validateTransition, dispatchCardEvent, startDueReminderScheduler, tasksDirForScope, identity, authenticated } = vi.hoisted(() => ({
  findCardById: vi.fn(),
  updateCard: vi.fn(),
  validateTransition: vi.fn(),
  dispatchCardEvent: vi.fn(),
  startDueReminderScheduler: vi.fn(),
  tasksDirForScope: vi.fn(),
  identity: { current: { username: 'nikita', scope: 'work' as const } },
  authenticated: { current: { username: 'nikita', scope: 'work' as const } as { username: string; scope: 'work' } | null },
}));

vi.mock('@/lib/kanban/file-store', () => ({ findCardById, updateCard, deleteCard: vi.fn() }));
vi.mock('@/lib/kanban/due-at', () => ({ normalizeDueAt: vi.fn((value: unknown) => value) }));
vi.mock('@/lib/kanban/transition-policy', () => ({ validateTransition, NIKITA_ACTOR: 'nikita' }));
vi.mock('@/lib/auth/request', () => ({
  boardIdentityFromRequest: () => identity.current,
  identityFromRequest: () => authenticated.current,
}));
vi.mock('@/lib/auth/data-scope', () => ({ tasksDirForScope }));
vi.mock('@/lib/notifications/push', () => ({ dispatchCardEvent }));
vi.mock('@/lib/notifications/scheduler', () => ({ startDueReminderScheduler }));

import { PATCH } from './route';

const existingCard: KanbanCard = {
  id: 'card-1',
  title: 'Prepare report',
  description: '',
  column: 'todo',
  priority: 'medium',
  tags: [],
  order: 0,
  created: '2026-08-12T00:00:00.000Z',
  updated: '2026-08-12T00:00:00.000Z',
  fileName: 'card-1.md',
  version: 2,
  project: 'Work',
  assignees: ['marina'],
};

describe('PATCH /api/kanban/cards/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    identity.current = { username: 'nikita', scope: 'work' };
    authenticated.current = { username: 'nikita', scope: 'work' };
    tasksDirForScope.mockReturnValue('/scoped/work');
    findCardById.mockReturnValue(existingCard);
    updateCard.mockReturnValue({ ...existingCard, version: 3 });
    dispatchCardEvent.mockResolvedValue({ sent: 1, failed: 0, removed: 0, skipped: false });
  });

  it('returns 400 and does not persist an inferred assignee change', async () => {
    validateTransition.mockReturnValue({ kind: 'rejected', reason: 'assignee_change_requires_owner_authorization' });

    const response = await PATCH(new NextRequest('http://localhost/api/kanban/cards/card-1', {
      method: 'PATCH',
      body: JSON.stringify({ assignees: ['nikita'] }),
      headers: { 'content-type': 'application/json' },
    }), { params: Promise.resolve({ id: 'card-1' }) });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'assignee_change_requires_owner_authorization' });
    expect(updateCard).not.toHaveBeenCalled();
  });

  it('allows authenticated nikita to explicitly confirm reassignment with intent and evidence', async () => {
    validateTransition.mockReturnValue({ kind: 'accepted', patch: { assignees: ['nikita'] } });

    const response = await PATCH(new NextRequest('http://localhost/api/kanban/cards/card-1', {
      method: 'PATCH',
      body: JSON.stringify({
        assignees: ['nikita'],
        reassignmentIntent: 'direct-owner-command',
        reassignmentEvidence: {
          type: 'caller-claimed',
          actor: 'attacker',
          origin: 'untrusted-client',
          source: 'owner-confirmation',
          requestId: 'confirm-1',
        },
      }),
      headers: { 'content-type': 'application/json' },
    }), { params: Promise.resolve({ id: 'card-1' }) });

    expect(response.status).toBe(200);
    expect(validateTransition).toHaveBeenCalledWith(
      existingCard,
      expect.objectContaining({ assignees: ['nikita'] }),
      expect.objectContaining({
        origin: 'human-ui',
        actor: 'nikita',
        ownerAuthorization: {
          actor: 'nikita',
          evidence: expect.objectContaining({
            type: 'direct-owner-command',
            actor: 'nikita',
            origin: 'rest',
            source: 'owner-confirmation',
            requestId: 'confirm-1',
          }),
        },
      }),
    );
    expect(updateCard).toHaveBeenCalledWith('card-1', { assignees: ['nikita'] }, undefined, '/scoped/work');
  });

  it('rejects reassignment intent and evidence from an unauthenticated request', async () => {
    identity.current = { username: 'anonymous', scope: 'work' };
    authenticated.current = null;
    validateTransition.mockReturnValue({ kind: 'rejected', reason: 'assignee_change_requires_owner_authorization' });

    const response = await PATCH(new NextRequest('http://localhost/api/kanban/cards/card-1', {
      method: 'PATCH',
      body: JSON.stringify({
        assignees: ['nikita'],
        reassignmentIntent: 'direct-owner-command',
        reassignmentEvidence: { source: 'owner-confirmation' },
      }),
      headers: { 'content-type': 'application/json' },
    }), { params: Promise.resolve({ id: 'card-1' }) });

    expect(response.status).toBe(400);
    expect(validateTransition).toHaveBeenCalledWith(
      existingCard,
      expect.objectContaining({ assignees: ['nikita'] }),
      { origin: 'automation', actor: 'anonymous' },
    );
    expect(updateCard).not.toHaveBeenCalled();
  });

  it('returns 400 and does not persist an inferred deadline', async () => {
    validateTransition.mockReturnValue({ kind: 'rejected', reason: 'deadline_change_requires_human_ui' });

    const response = await PATCH(new NextRequest('http://localhost/api/kanban/cards/card-1', {
      method: 'PATCH',
      body: JSON.stringify({ dueAt: '2026-08-15T12:00:00.000Z' }),
      headers: { 'content-type': 'application/json' },
    }), { params: Promise.resolve({ id: 'card-1' }) });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'deadline_change_requires_human_ui' });
    expect(updateCard).not.toHaveBeenCalled();
  });

  it('does not treat anonymous public HTTP as a human completion confirmation', async () => {
    identity.current = { username: 'anonymous', scope: 'work' };
    authenticated.current = null;
    validateTransition.mockReturnValue({
      kind: 'redirected',
      reason: 'automation_done_requires_review',
      patch: { column: 'review', needsReview: true },
    });

    const response = await PATCH(new NextRequest('http://localhost/api/kanban/cards/card-1', {
      method: 'PATCH',
      body: JSON.stringify({ column: 'done' }),
      headers: { 'content-type': 'application/json' },
    }), { params: Promise.resolve({ id: 'card-1' }) });

    expect(response.status).toBe(200);
    expect(validateTransition).toHaveBeenCalledWith(
      existingCard,
      expect.objectContaining({ column: 'done' }),
      { origin: 'automation', actor: 'anonymous' },
    );
  });

  it('does not pass client completion or approval evidence to policy', async () => {
    validateTransition.mockReturnValue({ kind: 'accepted', patch: { title: 'Prepare report' } });

    const response = await PATCH(new NextRequest('http://localhost/api/kanban/cards/card-1', {
      method: 'PATCH',
      body: JSON.stringify({
        title: 'Prepare report',
        completionEvidence: [{ type: 'machine-verifiable', check: 'caller-claimed' }],
        approvalEvidence: [{ type: 'direct-owner-command', actor: 'nikita' }],
        completedBy: 'attacker',
        completedAt: '2000-01-01T00:00:00.000Z',
      }),
      headers: { 'content-type': 'application/json' },
    }), { params: Promise.resolve({ id: 'card-1' }) });

    expect(response.status).toBe(200);
    expect(validateTransition.mock.calls[0][1]).not.toEqual(expect.objectContaining({
      completionEvidence: expect.anything(),
      approvalEvidence: expect.anything(),
      completedBy: expect.anything(),
      completedAt: expect.anything(),
    }));
  });
});
