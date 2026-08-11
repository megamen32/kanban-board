import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KanbanCard } from '@/lib/kanban/types';

const { reorderColumn, dispatchCardEvent, startDueReminderScheduler } = vi.hoisted(() => ({
  reorderColumn: vi.fn(),
  dispatchCardEvent: vi.fn(),
  startDueReminderScheduler: vi.fn(),
}));

vi.mock('@/lib/kanban/file-store', () => ({ reorderColumn }));
vi.mock('@/lib/auth/request', () => ({ boardIdentityFromRequest: () => ({ scope: 'work' }) }));
vi.mock('@/lib/auth/data-scope', () => ({ tasksDirForScope: () => '/tasks' }));
vi.mock('@/lib/notifications/push', () => ({ dispatchCardEvent }));
vi.mock('@/lib/notifications/scheduler', () => ({ startDueReminderScheduler }));

import { POST } from './route';

const firstCard: KanbanCard = {
  id: 'first',
  title: 'First card',
  description: '',
  column: 'todo',
  priority: 'medium',
  tags: [],
  order: 0,
  created: '2026-08-11T00:00:00.000Z',
  updated: '2026-08-11T00:00:00.000Z',
  fileName: 'first.md',
  version: 2,
  project: 'Kanban',
  assignees: [],
};

const secondCard: KanbanCard = { ...firstCard, id: 'second', title: 'Second card', order: 1, fileName: 'second.md' };

describe('POST /api/kanban/reorder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reorderColumn.mockReturnValue([firstCard, secondCard]);
    dispatchCardEvent.mockResolvedValue({ sent: 1, failed: 0, removed: 0, skipped: false });
  });

  it('dispatches one reorder notification for a column reorder with multiple cards', async () => {
    const response = await POST(new NextRequest('http://localhost/api/kanban/reorder', {
      method: 'POST',
      body: JSON.stringify({ column: 'todo', cardIds: [firstCard.id, secondCard.id] }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cards: [firstCard, secondCard] });
    expect(dispatchCardEvent).toHaveBeenCalledTimes(1);
    expect(dispatchCardEvent).toHaveBeenCalledWith('work', 'reordered', firstCard);
  });
});
