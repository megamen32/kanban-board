import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { KanbanCard } from '@/lib/kanban/types';

vi.stubGlobal('React', React);
// @ts-expect-error Vitest's runtime accepts virtual mocks; the installed type omits this option.
vi.mock('../ui/button', () => ({ Button: () => null }), { virtual: true });
// @ts-expect-error Vitest's runtime accepts virtual mocks; the installed type omits this option.
vi.mock('../ui/badge', () => ({ Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }), { virtual: true });

import { PlanningCardList } from './planning-views';

const card: KanbanCard = {
  id: 'incoming-markdown', title: 'Incoming Markdown', description: '## Срочно\n\n- Срок **сегодня**',
  column: 'todo', priority: 'critical', tags: [], order: 0,
  created: '2026-10-26T00:00:00.000Z', updated: '2026-10-26T00:00:00.000Z',
  dueAt: '2026-10-26T23:00:00.000Z', fileName: 'incoming.md', version: 1, project: 'QA', assignees: [],
};

describe('planning card list Markdown and status labels', () => {
  it('renders Markdown, groups legacy todo as incoming, and marks urgent deadlines', () => {
    const html = renderToStaticMarkup(React.createElement(PlanningCardList, {
      cards: [card], onOpen: () => undefined, empty: 'Нет задач',
    }));

    expect(html).toContain('<h2 class="text-sm font-semibold leading-snug">Срочно</h2>');
    expect(html).toContain('<strong class="font-semibold">сегодня</strong>');
    expect(html).toContain('Входящие');
    expect(html).toContain('Срочно');
    expect(html).not.toContain('## Срочно');
  });
});
