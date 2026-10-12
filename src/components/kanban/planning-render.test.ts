import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { KanbanCard } from '../../lib/kanban/types';

vi.stubGlobal('React', React);
vi.mock('../ui/button', () => ({ Button: ({ children, ...props }: any) => React.createElement('button', props, children) }));
vi.mock('../ui/badge', () => ({ Badge: ({ children }: any) => React.createElement('span', null, children) }));
import { PlanningCardList, WeeklyPlanView } from './planning-views';

const card = (id: string, title: string): KanbanCard => ({
  id, title, description: '', column: 'todo', priority: 'medium', tags: [], order: 0,
  created: '', updated: '', fileName: `${id}.md`, version: 1, project: 'QA', assignees: [],
});

describe('rendered weekly proposal (fast unit, expected <1s, maximum 10s)', () => {
  it('never renders undefined for a saved custom role', () => {
    const html = renderToStaticMarkup(React.createElement(PlanningCardList, {
      cards: [ { ...card('own', 'Own card'), role: 'own-role' } ],
      roles: [{ id: 'own-role', label: 'My saved role', order: 0 }],
      onOpen: () => {}, empty: '',
    }));
    expect(html).toContain('My saved role');
    expect(html).not.toContain('undefined');
  });
  it('renders the filtered candidates, not the global draft collection', () => {
    const own = card('own', 'Own visible candidate');
    const foreign = card('foreign', 'Hidden foreign candidate');
    const html = renderToStaticMarkup(React.createElement(WeeklyPlanView, {
      cards: [own], draft: { week: '2026-W42', cardIds: ['foreign'], cards: [foreign] },
      loading: false, error: null, canAccept: true, onLoad: () => {},
      onAccept: async () => {}, onOpen: () => {}, now: '2026-10-12T12:00:00Z',
    }));
    expect(html).toContain('Выбрать Big Rock: Own visible candidate');
    expect(html).not.toContain('Hidden foreign candidate');
  });
});
