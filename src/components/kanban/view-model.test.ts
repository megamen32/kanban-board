import { describe, expect, it } from 'vitest';
import { filterCards, getProjectOptions, isSmartNotesInbox } from './view-model';
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
  it('returns unique sorted projects and keeps the explicit unassigned bucket', () => {
    expect(getProjectOptions([card(), card({ id: '2', project: 'Xcode' }), card({ id: '3', project: '' })]))
      .toEqual(['Hermes', 'Xcode', 'Без проекта']);
  });

  it('filters by project without changing the source card collection', () => {
    const cards = [card(), card({ id: '2', project: 'Xcode' })];
    expect(filterCards(cards, 'Hermes').map(item => item.id)).toEqual(['1']);
    expect(filterCards(cards, 'all')).toHaveLength(2);
  });

  it('keeps SmartNotes Inbox separate as a view over column inbox', () => {
    expect(isSmartNotesInbox(card())).toBe(true);
    expect(isSmartNotesInbox(card({ column: 'todo' }))).toBe(false);
  });
});
