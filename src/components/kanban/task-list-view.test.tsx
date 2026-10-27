import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { KanbanCard } from '@/lib/kanban/types';

// @ts-expect-error Vitest's runtime accepts virtual mocks; the installed type omits this option.
vi.mock('@/components/ui/button', () => ({ Button: ({ children, ...props }: any) => React.createElement('button', props, children) }), { virtual: true });
// @ts-expect-error Vitest's runtime accepts virtual mocks; the installed type omits this option.
vi.mock('@/lib/kanban/types', () => ({ DEFAULT_COLUMNS: [{ id: 'in-progress', title: 'В работе' }] }), { virtual: true });
vi.mock('../ui/button', () => ({ Button: ({ children, ...props }: any) => React.createElement('button', props, children) }));
vi.mock('../ui/textarea', () => ({ Textarea: (props: any) => React.createElement('textarea', props) }));

import { TaskListView } from './task-list-view';

const stuckCard: KanbanCard = {
  id: '11044d6a-0648-41a6-949e-6b3b3c1680c1',
  title: 'Форэнерго: оцифровать каталоги в JSON и передать Олегу для сравнения',
  description: '',
  column: 'in-progress',
  priority: 'medium',
  tags: [],
  order: 0,
  created: '2026-10-26T00:00:00Z',
  updated: '2026-10-26T00:00:00Z',
  fileName: 'stuck.md',
  version: 16,
  project: 'UX QA 2026-10-26',
  assignees: [],
  needsReview: true,
  requiresApprovalFrom: [],
  resultHistory: [],
};

describe('task list recovery layout', () => {
  it('keeps the title in the main column and places the recovery notice underneath it', () => {
    const html = renderToStaticMarkup(React.createElement(TaskListView, {
      cards: [stuckCard],
      username: 'nikita',
      onStatusChange: async () => ({}),
      onOpen: () => {},
    }));

    expect(html).toContain('grid-cols-[1.25rem_minmax(0,1fr)]');
    expect(html.indexOf(stuckCard.title)).toBeGreaterThan(-1);
    expect(html.indexOf('Приёмка заблокирована')).toBeGreaterThan(html.indexOf(stuckCard.title));
  });
});
