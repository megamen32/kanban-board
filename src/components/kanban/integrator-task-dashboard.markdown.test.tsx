import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { KanbanCard } from '@/lib/kanban/types';

vi.stubGlobal('React', React);
// @ts-expect-error Vitest's runtime accepts virtual mocks; the installed type omits this option.
vi.mock('@/components/ui/button', () => ({ Button: ({ children, disabled, title }: { children: React.ReactNode; disabled?: boolean; title?: string }) => React.createElement('button', { disabled, title }, children) }), { virtual: true });
// @ts-expect-error Vitest's runtime accepts virtual mocks; the installed type omits this option.
vi.mock('@/components/ui/input', () => ({ Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => React.createElement('input', props) }), { virtual: true });
vi.mock('@/lib/kanban/types', () => ({
  DEFAULT_COLUMNS: [{ id: 'todo', title: 'К выполнению' }],
// @ts-expect-error Vitest's runtime accepts virtual mocks; the installed type omits this option.
}), { virtual: true });
import { IntegratorTaskDashboard } from './integrator-task-dashboard';

const card: KanbanCard = {
  id: 'markdown-qa', title: 'Markdown QA', description: '## Blocker\n\n- First item\n- Second item',
  column: 'todo', priority: 'medium', tags: [], order: 0,
  created: '2026-10-26T00:00:00.000Z', updated: '2026-10-26T00:00:00.000Z',
  fileName: 'markdown-qa.md', version: 1, project: 'UX QA', assignees: [], owner: 'qa', shared: false,
};

describe('integrator task description rendering', () => {
  it('formats Markdown headings and lists without exposing raw markers', () => {
    const html = renderToStaticMarkup(React.createElement(IntegratorTaskDashboard, {
      cards: [card], onOpen: () => undefined, onRefresh: () => undefined,
      canAssignReviewer: false, onAssignReviewer: async () => null,
    }));

    expect(html).toContain('<h2 class="text-base font-semibold leading-snug">Blocker</h2>');
    expect(html).toContain('<ul');
    expect(html).toMatch(/<li[^>]*>First item<\/li>/);
    expect(html).not.toContain('## Blocker');
  });

  it('shows explicit edit and reviewer actions when a card is waiting for review without a reviewer', () => {
    const waiting: KanbanCard = { ...card, column: 'review', needsReview: true, requiresApprovalFrom: [] };
    const html = renderToStaticMarkup(React.createElement(IntegratorTaskDashboard, {
      cards: [waiting], onOpen: () => undefined, onRefresh: () => undefined,
      canAssignReviewer: true, onAssignReviewer: async () => waiting,
    }));

    expect(html).toContain('Изменить');
    expect(html).toContain('Назначить проверяющего');
  });

  it('explains that only the board owner can assign a reviewer', () => {
    const waiting: KanbanCard = { ...card, column: 'review', needsReview: true, requiresApprovalFrom: [] };
    const html = renderToStaticMarkup(React.createElement(IntegratorTaskDashboard, {
      cards: [waiting], onOpen: () => undefined, onRefresh: () => undefined,
      canAssignReviewer: false, onAssignReviewer: async () => null,
    }));

    expect(html).toContain('Назначить проверяющего');
    expect(html).toContain('Назначить проверяющего может только владелец доски');
    expect(html).toContain('Доступно владельцу доски.');
    expect(html).toContain('disabled="" title="Назначить проверяющего может только владелец доски"');
  });
});
