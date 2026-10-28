import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';
import type { KanbanCard } from '@/lib/kanban/types';
import { CardHierarchyPanel } from './card-hierarchy-panel';

vi.mock('../ui/button', () => ({ Button: ({ children, ...props }: React.ComponentProps<'button'>) => React.createElement('button', props, children) }));

function card(id: string, title: string, parent?: string): KanbanCard {
  return {
    id, title, description: '', parent, project: 'Synthetic ForEnergo', owner: 'synthetic-owner',
    column: 'todo', priority: 'medium', tags: [], order: 0, created: '2026-10-28T00:00:00Z', updated: '2026-10-28T00:00:00Z',
    fileName: `${id}.md`, version: 1, assignees: [],
  };
}

describe('CardHierarchyPanel', () => {
  test('shows a parent breadcrumb and visible children as quick navigation buttons', () => {
    const root = card('synthetic-root-id', 'ForEnergo');
    const tender = card('synthetic-tender-id', 'Тендер', root.id);
    const pilot = card('synthetic-pilot-id', 'Пилот', tender.id);
    const other = card('synthetic-other-id', 'Другая подзадача', tender.id);
    const onSelectCard = vi.fn();
    const html = renderToStaticMarkup(<CardHierarchyPanel card={tender} relatedCards={[root, tender, pilot, other]} onSelectCard={onSelectCard} />);
    expect(html).toContain('ForEnergo');
    expect(html).toContain('Путь к задаче');
    expect(html).toContain('Дочерние задачи');
    expect(html).toContain('Пилот');
    expect(html).not.toContain('synthetic-root-id');
  });

  test('keeps a child breadcrumb visible without rendering the hidden parent card', () => {
    const child = card('synthetic-child-id', 'Пилот', 'filtered-parent-id');
    const html = renderToStaticMarkup(<CardHierarchyPanel card={child} relatedCards={[child]} breadcrumbCards={[child]} />);
    expect(html).toContain('Родительская задача скрыта текущей выборкой.');
    expect(html).not.toContain('filtered-parent-id');
  });

  test('keeps long parent labels readable and clickable within a narrow breadcrumb row', () => {
    const root = card('synthetic-root-id', 'Долгий путь реализации плана мероприятий ForEnergo');
    const child = card('synthetic-child-id', 'Проработка обязательных документов и материалов', root.id);
    const onSelectCard = vi.fn();
    const html = renderToStaticMarkup(<CardHierarchyPanel card={child} relatedCards={[root, child]} onSelectCard={onSelectCard} />);
    expect(html).toContain('Долгий путь реализации плана мероприятий ForEnergo</button>');
    expect(html).toContain('whitespace-normal');
    expect(html).toContain('break-words');
    expect(html).toContain('min-w-0');
  });
});
