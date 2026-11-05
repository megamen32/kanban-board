import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@dnd-kit/core', () => ({ useDroppable: () => ({ setNodeRef: () => {}, isOver: false }) }));
vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  verticalListSortingStrategy: {},
}));
vi.mock('./kanban-card', () => ({ KanbanCard: () => null }));

import { KanbanColumnComponent } from './kanban-column';

describe('empty kanban columns', () => {
  it('labels a zero count and explains how to create the first task', () => {
    const html = renderToStaticMarkup(React.createElement(KanbanColumnComponent, {
      id: 'todo', title: 'Входящие', color: 'bg-blue-500', cards: [],
    }));

    expect(html).toContain('0 задач');
    expect(html).toContain('Здесь пока нет задач');
    expect(html).toContain('Нажмите «+ Задача»');
    expect(html).not.toContain('Перетащите карточку в этот этап');
  });

  it('explains what should move into an empty execution stage', () => {
    const html = renderToStaticMarkup(React.createElement(KanbanColumnComponent, {
      id: 'in-progress', title: 'В работе', color: 'bg-amber-500', cards: [],
    }));

    expect(html).toContain('Переместите сюда задачу, когда начнёте её выполнять.');
  });
});
