import { describe, expect, it } from 'vitest';
import { filterCards, filterWorkspaceCards, getAssigneeOptions, getPlanningTabCards, getPrimaryBoardLaneCards, getProjectOptions, isSmartNotesInbox, resolveInitialWorkspaceView, searchCards } from './view-model';
import type { KanbanCard } from '@/lib/kanban/types';

const card = (overrides: Partial<KanbanCard> = {}): KanbanCard => ({
  id: '1',
  title: 'Task',
  description: '',
  column: 'inbox',
  priority: 'medium',
  tags: [],
  order: 0,
  created: '2026-08-09T00:00:00Z',
  updated: '2026-08-09T00:00:00Z',
  fileName: 'task-1.md',
  version: 1,
  project: 'Hermes',
  assignees: [],
  ...overrides,
});

describe('kanban view model', () => {
  it('shows the server-authorized QA fixture to testlogin without changing its owner or other workspace defaults', () => {
    const qaCard = card({
      id: '43687640-5245-4ec4-b29c-2b8970cb9d30',
      title: 'UX QA: testlogin visibility',
      owner: 'nikita',
      project: 'UX QA 2026-10-26',
    });
    const qaView = resolveInitialWorkspaceView('qa-board.bezrabotnyi.com', 'testlogin', 'mine');

    expect(qaView).toBe('all');
    const visible = filterWorkspaceCards([qaCard], 'testlogin', qaView!);
    expect(visible).toEqual([qaCard]);
    expect(visible[0]).toBe(qaCard);
    expect(visible[0].owner).toBe('nikita');

    expect(resolveInitialWorkspaceView('todo-board.airlock.bezrabotnyi.com', 'testlogin', 'mine')).toBe('mine');
    expect(resolveInitialWorkspaceView('qa-board.bezrabotnyi.com', 'qa_exmanager_a', 'all')).toBe('mine');
    expect(resolveInitialWorkspaceView('todo-board.airlock.bezrabotnyi.com', 'nikita', 'all')).toBe('all');
  });

  it('returns unique sorted projects and keeps the explicit unassigned bucket', () => {
    expect(getProjectOptions([card(), card({ id: '2', project: 'Xcode' }), card({ id: '3', project: '' })]))
      .toEqual(['Hermes', 'Xcode', 'Без проекта']);
  });

  it('filters by project without changing the source card collection', () => {
    const cards = [card(), card({ id: '2', project: 'Xcode' })];
    expect(filterCards(cards, 'Hermes').map(item => item.id)).toEqual(['1']);
    expect(filterCards(cards, 'all')).toHaveLength(2);
  });

  it('finds people by card owner, assignee and reviewer', () => {
    const cards = [
      card({ id: 'owner', owner: 'nikita' }),
      card({ id: 'assignee', assignees: ['oleg'] }),
      card({ id: 'reviewer', requiresApprovalFrom: ['marina'] }),
    ];

    expect(searchCards(cards, 'nikita').map(item => item.id)).toEqual(['owner']);
    expect(searchCards(cards, 'oleg').map(item => item.id)).toEqual(['assignee']);
    expect(searchCards(cards, 'marina').map(item => item.id)).toEqual(['reviewer']);
  });

  it('returns unique sorted roles from card assignees', () => {
    expect(getAssigneeOptions([
      card({ assignees: ['Секретарь', 'Алексей'] }),
      card({ id: '2', assignees: ['Алексей', 'Марина'] }),
    ])).toEqual(['Алексей', 'Марина', 'Секретарь']);
  });

  it('filters cards by the selected role while keeping unfiltered behavior', () => {
    const cards = [
      card({ assignees: ['Секретарь'] }),
      card({ id: '2', assignees: ['Марина'] }),
      card({ id: '3', assignees: [] }),
    ];
    expect(filterCards(cards, 'all', 'Секретарь').map(item => item.id)).toEqual(['1']);
    expect(filterCards(cards, 'all', 'all')).toHaveLength(3);
  });

  it('keeps SmartNotes Inbox separate as a view over column inbox', () => {
    expect(isSmartNotesInbox(card())).toBe(true);
    expect(isSmartNotesInbox(card({ column: 'todo' }))).toBe(false);
  });

  it('groups inbox, to-do and backlog into one incoming queue ordered by urgency and deadline', () => {
    const cards = [
      card({ id: 'late', column: 'todo', dueAt: '2026-11-03T12:00:00Z' }),
      card({ id: 'urgent', column: 'inbox', urgent: true, dueAt: '2026-11-08T12:00:00Z' }),
      card({ id: 'soon', column: 'someday', dueAt: '2026-10-27T12:00:00Z' }),
      card({ id: 'working', column: 'in-progress' }),
      card({ id: 'blocked', column: 'blocked' }),
      card({ id: 'review', column: 'review' }),
    ];

    expect(getPrimaryBoardLaneCards(cards, 'incoming').map(item => item.id)).toEqual(['urgent', 'soon', 'late']);
    expect(getPrimaryBoardLaneCards(cards, 'in-progress').map(item => item.id)).toEqual(['working', 'blocked']);
    expect(getPrimaryBoardLaneCards(cards, 'review').map(item => item.id)).toEqual(['review']);
    expect(getPlanningTabCards(cards, 'inbox').map(item => item.id)).toEqual(['urgent', 'soon', 'late']);
  });

  it('shows active cards in the dashboard and leaves completed work in the closed view', () => {
    const cards = [card(), card({ id: '2', column: 'review', needsReview: true }), card({ id: '3', column: 'done' })];
    expect(getPlanningTabCards(cards, 'dashboard').map(item => item.id)).toEqual(['1', '2']);
    expect(getPlanningTabCards(cards, 'closed').map(item => item.id)).toEqual(['3']);
  });
});
