import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KanbanCard } from '@/lib/kanban/types';

const { findCardById, updateCard, decideHumanReview, dispatchCardEvent, tasksDirForScope, identity, human } = vi.hoisted(() => ({
  findCardById: vi.fn(),
  updateCard: vi.fn(),
  decideHumanReview: vi.fn(),
  dispatchCardEvent: vi.fn(),
  tasksDirForScope: vi.fn(),
  identity: { current: { username: 'anonymous', scope: 'work' as const } },
  human: { current: { username: 'nikita', scope: 'work' as const } as { username: string; scope: 'work' } | null },
}));

vi.mock('@/lib/kanban/file-store', () => ({ findCardById, updateCard }));
vi.mock('@/lib/kanban/transition-policy', () => ({ decideHumanReview }));
vi.mock('@/lib/auth/request', () => ({ boardIdentityFromRequest: () => identity.current }));
vi.mock('@/lib/auth/board-human', () => ({ boardHumanIdentityFromRequest: async () => human.current }));
vi.mock('@/lib/auth/data-scope', () => ({ tasksDirForScope }));
vi.mock('@/lib/notifications/push', () => ({ dispatchCardEvent }));

import { POST } from './route';

const reviewCard: KanbanCard = {
  id: 'review-card', title: 'Review this result', description: '', column: 'review',
  priority: 'medium', tags: [], order: 0, created: '2026-10-20T10:00:00Z',
  updated: '2026-10-20T10:00:00Z', fileName: 'review.md', version: 3,
  project: 'fixture', assignees: ['executor'], needsReview: true,
  requiresApprovalFrom: ['nikita'], resultHistory: [{ summary: 'Done', evidenceRefs: ['event:1'],
    submittedBy: 'exmanager-service', submittedAt: '2026-10-20T10:00:00Z' }],
};

function request(body: unknown) {
  return new NextRequest('http://localhost/api/kanban/cards/review-card/review', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('POST /api/kanban/cards/[id]/review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    identity.current = { username: 'anonymous', scope: 'work' };
    human.current = { username: 'nikita', scope: 'work' };
    tasksDirForScope.mockReturnValue('/tmp/disposable-work');
    findCardById.mockReturnValue(reviewCard);
    decideHumanReview.mockImplementation((_card, action, actor, note) => {
      if (actor !== 'nikita') return { kind: 'rejected', reason: 'reviewer_not_authorized' };
      if (action === 'rework' && !String(note).trim()) return { kind: 'rejected', reason: 'rework_note_required' };
      return { kind: 'accepted', patch: action === 'accept'
        ? { column: 'done', completedBy: actor, needsReview: false, reviewHistory: [{ decision: 'accepted', actor }] }
        : { column: 'in-progress', nextAction: note, reviewHistory: [{ decision: 'rework', actor, note }] } };
    });
    updateCard.mockImplementation((_id, patch, _version) => ({ ...reviewCard, ...patch, version: 4 }));
    dispatchCardEvent.mockResolvedValue({ skipped: false });
  });

  it('denies service and unauthenticated callers, regardless of asserted body actor', async () => {
    human.current = null;
    const response = await POST(request({ action: 'accept', expectedVersion: 3, actor: 'nikita' }), {
      params: Promise.resolve({ id: reviewCard.id }),
    });
    expect(response.status).toBe(401);
    expect(updateCard).not.toHaveBeenCalled();
  });

  it('rejects a currently authenticated person absent from the card reviewer grant', async () => {
    human.current = { username: 'marina', scope: 'work' };
    const response = await POST(request({ action: 'accept', expectedVersion: 3, actor: 'nikita' }), {
      params: Promise.resolve({ id: reviewCard.id }),
    });
    expect(response.status).toBe(403);
    expect(updateCard).not.toHaveBeenCalled();
  });

  it('requires an exact version and an explicit rework note', async () => {
    const response = await POST(request({ action: 'rework', expectedVersion: 3, note: '   ' }), {
      params: Promise.resolve({ id: reviewCard.id }),
    });
    expect(response.status).toBe(400);
    expect(updateCard).not.toHaveBeenCalled();
  });

  it('accepts only an assigned human reviewer and records the versioned decision', async () => {
    const response = await POST(request({ action: 'accept', expectedVersion: 3 }), {
      params: Promise.resolve({ id: reviewCard.id }),
    });
    expect(response.status).toBe(200);
    expect(updateCard).toHaveBeenCalledWith(reviewCard.id, expect.objectContaining({
      column: 'done', completedBy: 'nikita', needsReview: false,
      reviewHistory: [expect.objectContaining({ decision: 'accepted', actor: 'nikita' })],
    }), 3, '/tmp/disposable-work');
    expect(decideHumanReview).toHaveBeenCalledWith(reviewCard, 'accept', 'nikita', '');
  });

  it('records rework while preserving executor evidence and conflicts on a stale version', async () => {
    updateCard.mockReturnValue({ conflict: true, serverCard: { ...reviewCard, version: 4 } });
    const response = await POST(request({ action: 'rework', expectedVersion: 3, note: 'Add the source comparison.' }), {
      params: Promise.resolve({ id: reviewCard.id }),
    });
    expect(response.status).toBe(409);
    expect(updateCard).toHaveBeenCalledWith(reviewCard.id, expect.objectContaining({
      column: 'in-progress', nextAction: 'Add the source comparison.',
      reviewHistory: [expect.objectContaining({ decision: 'rework', note: 'Add the source comparison.' })],
    }), 3, '/tmp/disposable-work');
    expect(dispatchCardEvent).not.toHaveBeenCalled();
  });

  it('recovers only the owner-controlled malformed gate with CAS and without push or result acceptance', async () => {
    const malformed = { ...reviewCard, column: 'in-progress', needsReview: true, requiresApprovalFrom: [], resultHistory: [] } as KanbanCard;
    findCardById.mockReturnValue(malformed);
    decideHumanReview.mockReturnValue({ kind: 'accepted', patch: {
      column: 'in-progress', needsReview: false, nextAction: 'Проверить задачу',
      reviewHistory: [{ decision: 'rework', actor: 'nikita', note: 'Проверить задачу' }],
    } });
    updateCard.mockReturnValue({ ...malformed, needsReview: false, version: 4 });
    const response = await POST(request({ action: 'recover-rework', expectedVersion: 3, note: 'Проверить задачу' }), {
      params: Promise.resolve({ id: malformed.id }),
    });
    expect(response.status).toBe(200);
    expect(decideHumanReview).toHaveBeenCalledWith(malformed, 'recover-rework', 'nikita', 'Проверить задачу');
    expect(updateCard).toHaveBeenCalledWith(malformed.id, expect.objectContaining({ column: 'in-progress', needsReview: false }), 3, '/tmp/disposable-work');
    expect(dispatchCardEvent).not.toHaveBeenCalled();
  });

  it('rejects malformed-gate recovery for non-owner and rejects missing note before update', async () => {
    const malformed = { ...reviewCard, column: 'in-progress', needsReview: true, requiresApprovalFrom: [], resultHistory: [] } as KanbanCard;
    findCardById.mockReturnValue(malformed);
    human.current = { username: 'oleg', scope: 'work' };
    const forbidden = await POST(request({ action: 'recover-rework', expectedVersion: 3, note: 'Retry safely' }), { params: Promise.resolve({ id: malformed.id }) });
    expect(forbidden.status).toBe(403);
    expect(updateCard).not.toHaveBeenCalled();
    human.current = { username: 'nikita', scope: 'work' };
    const missingNote = await POST(request({ action: 'recover-rework', expectedVersion: 3, note: '  ' }), { params: Promise.resolve({ id: malformed.id }) });
    expect(missingNote.status).toBe(400);
    expect(updateCard).not.toHaveBeenCalled();
  });
});
