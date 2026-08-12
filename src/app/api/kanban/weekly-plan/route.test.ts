import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KanbanCard } from '@/lib/kanban/types';

const { getAllCards, findCardById, updateCard, validateTransition, tasksDirForScope, identity, authenticated } = vi.hoisted(() => ({
  getAllCards: vi.fn(),
  findCardById: vi.fn(),
  updateCard: vi.fn(),
  validateTransition: vi.fn(),
  tasksDirForScope: vi.fn(),
  identity: { current: { username: 'nikita', scope: 'work' as const } },
  authenticated: { current: { username: 'nikita', scope: 'work' as const } as { username: string; scope: 'work' } | null },
}));

vi.mock('@/lib/kanban/file-store', () => ({ getAllCards, findCardById, updateCard }));
vi.mock('@/lib/auth/request', () => ({
  boardIdentityFromRequest: () => identity.current,
  identityFromRequest: () => authenticated.current,
}));
vi.mock('@/lib/auth/data-scope', () => ({ tasksDirForScope }));
vi.mock('@/lib/kanban/transition-policy', () => ({
  validateTransition,
  NIKITA_ACTOR: 'nikita',
}));
vi.mock('@/lib/kanban/weekly-plan', () => ({
  buildWeeklyDraft: (cards: KanbanCard[]) => ({ week: '2026-W33', cardIds: cards.map(card => card.id), cards }),
  runAtomicWrites: <T>(writes: Array<{ write: () => T; rollback: () => void }>) => {
    const completed: Array<{ write: () => T; rollback: () => void }> = [];
    const results: T[] = [];
    try {
      for (const operation of writes) {
        results.push(operation.write());
        completed.push(operation);
      }
      return results;
    } catch (error) {
      for (const operation of completed.reverse()) operation.rollback();
      throw error;
    }
  },
}));
vi.mock('@/lib/kanban/planning-views', () => ({ moscowIsoWeek: () => '2026-W33' }));

import { GET, POST } from './route';

const card = (id: string): KanbanCard => ({
  id,
  title: id,
  description: '',
  column: 'todo',
  priority: 'medium',
  tags: [],
  order: Number(id.replace(/\D/g, '')) || 0,
  created: '2026-08-12T00:00:00.000Z',
  updated: '2026-08-12T00:00:00.000Z',
  fileName: `${id}.md`,
  version: 1,
  project: 'Work',
  assignees: ['nikita'],
});

describe('/api/kanban/weekly-plan', () => {
  let failSecondWrite = false;

  beforeEach(() => {
    vi.clearAllMocks();
    failSecondWrite = false;
    identity.current = { username: 'nikita', scope: 'work' };
    authenticated.current = { username: 'nikita', scope: 'work' };
    tasksDirForScope.mockReturnValue('/scoped/work');
    getAllCards.mockReturnValue([card('card-1'), card('card-2')]);
    findCardById.mockImplementation((id: string) => getAllCards().find((item: KanbanCard) => item.id === id) ?? null);
    updateCard.mockImplementation((id: string, patch: Partial<KanbanCard>) => ({ ...card(id), ...patch }));
    validateTransition.mockImplementation((_before: KanbanCard, patch: Partial<KanbanCard>, context: { weeklyPlanAcceptance?: { actor: string; week: string } }) => ({
      kind: 'accepted',
      patch: context.weeklyPlanAcceptance
        ? {
            ...patch,
            approvalEvidence: [{
              type: 'weekly_plan_acceptance',
              actor: context.weeklyPlanAcceptance.actor,
              week: context.weeklyPlanAcceptance.week,
            }],
          }
        : patch,
    }));
  });

  it('returns a pure draft without writing', async () => {
    const response = await GET(new NextRequest('http://localhost/api/kanban/weekly-plan?now=2026-08-12T10:00:00%2B03:00'));

    expect(response.status).toBe(200);
    expect((await response.json()).week).toBe('2026-W33');
    expect(updateCard).not.toHaveBeenCalled();
  });

  it('requires authenticated Nikita for acceptance', async () => {
    authenticated.current = { username: 'marina', scope: 'work' };
    identity.current = { username: 'marina', scope: 'work' };

    const response = await POST(new NextRequest('http://localhost/api/kanban/weekly-plan', {
      method: 'POST', body: JSON.stringify({ cardIds: ['card-1'] }), headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(403);
    expect(updateCard).not.toHaveBeenCalled();
  });

  it('rejects duplicate or more than six card IDs before any write', async () => {
    const response = await POST(new NextRequest('http://localhost/api/kanban/weekly-plan', {
      method: 'POST', body: JSON.stringify({ cardIds: ['card-1', 'card-1'] }), headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(400);
    expect(updateCard).not.toHaveBeenCalled();
  });

  it('rejects seven card IDs before reading or writing cards', async () => {
    const response = await POST(new NextRequest('http://localhost/api/kanban/weekly-plan', {
      method: 'POST', body: JSON.stringify({ cardIds: ['1', '2', '3', '4', '5', '6', '7'] }), headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(400);
    expect(getAllCards).not.toHaveBeenCalled();
    expect(updateCard).not.toHaveBeenCalled();
  });

  it('accepts a batch and persists owner evidence for the Moscow week', async () => {
    const response = await POST(new NextRequest('http://localhost/api/kanban/weekly-plan?now=2026-08-12T10:00:00%2B03:00', {
      method: 'POST', body: JSON.stringify({ cardIds: ['card-1', 'card-2'], now: '2026-08-12T10:00:00+03:00', batchId: 'batch-1' }), headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(200);
    expect(updateCard).toHaveBeenCalledTimes(2);
    expect(updateCard).toHaveBeenCalledWith('card-1', expect.objectContaining({ week: '2026-W33', bigRock: true, approvalEvidence: expect.any(Array) }), undefined, '/scoped/work');
    expect(validateTransition).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ week: '2026-W33', bigRock: true }), expect.objectContaining({ actor: 'nikita', weeklyPlanAcceptance: expect.any(Object) }));
  });

  it('rolls back every selected card when the second Markdown write fails', async () => {
    const cards = [card('card-1'), card('card-2')];
    getAllCards.mockReturnValue(cards);
    const committedCards = new Map(cards.map(item => [item.id, { ...item }]));
    updateCard.mockImplementation((id: string, patch: Partial<KanbanCard>) => {
      if (failSecondWrite && id === 'card-2') throw new Error('forced-second-write-failure');
      if (patch.week === undefined && patch.bigRock === undefined && patch.approvalEvidence === undefined) {
        const original = cards.find(item => item.id === id)!;
        committedCards.set(id, { ...original });
        return original;
      }
      const updated = { ...committedCards.get(id)!, ...patch, version: committedCards.get(id)!.version + 1 };
      committedCards.set(id, updated);
      return updated;
    });
    failSecondWrite = true;

    const response = await POST(new NextRequest('http://localhost/api/kanban/weekly-plan?now=2026-08-12T10:00:00%2B03:00', {
      method: 'POST', body: JSON.stringify({ cardIds: ['card-1', 'card-2'], now: '2026-08-12T10:00:00+03:00' }), headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(400);
    expect(committedCards.get('card-1')).toEqual(cards[0]);
    expect(committedCards.get('card-2')).toEqual(cards[1]);
  });
});
