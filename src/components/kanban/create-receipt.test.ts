import { describe, expect, it } from 'vitest';
import type { KanbanCard } from '@/lib/kanban/types';
import { moscowIsoWeek } from '../../lib/kanban/planning-views';

import {
  automaticRevealScope,
  describePlacement,
  placeCreatedCard,
  type BoardScope,
} from './create-receipt';

const card = (overrides: Partial<KanbanCard> = {}): KanbanCard => ({
  id: 'new-card',
  title: 'QA desktop ops: выпуск отчёта заблокирован',
  description: '',
  column: 'todo',
  priority: 'medium',
  tags: [],
  order: 0,
  created: '2026-10-26T00:00:00Z',
  updated: '2026-10-26T00:00:00Z',
  fileName: 'new-card.md',
  version: 1,
  project: 'UX QA 2026-10-26',
  owner: 'nikita',
  shared: false,
  assignees: [],
  ...overrides,
});

const scope = (overrides: Partial<BoardScope> = {}): BoardScope => ({
  workspaceView: 'shared',
  person: 'nikita',
  project: 'all',
  assignee: 'all',
  attention: 'all',
  inboxOnly: false,
  planningTab: 'dashboard',
  ...overrides,
});

describe('created card placement', () => {
  it('reports the workspace view that hides the card instead of widening it', () => {
    const placement = placeCreatedCard(card(), scope());
    expect(placement.visibleNow).toBe(false);
    expect(placement.issues.map(issue => issue.kind)).toContain('workspace');
  });

  it('never offers «Всё» as a target', () => {
    const other = scope({ person: 'Анна QA' });
    const placement = placeCreatedCard(card(), other);
    expect(placement.matchingView).toBeNull();
    expect(placement.location).toContain('в текущих фильтрах не видна');
    const automatic = automaticRevealScope(card(), other, placement);
    expect(automatic.workspaceView).toBe('shared');
    expect(automatic).toEqual(other);
  });

  it('narrows to the owner view of the card and never to «Всё»', () => {
    const placement = placeCreatedCard(card(), scope());
    expect(placement.matchingView).toBe('mine');
    const automatic = automaticRevealScope(card(), scope(), placement);
    expect(automatic.workspaceView).toBe('mine');
    expect(automatic.planningTab).toBe('dashboard');
    expect(placeCreatedCard(card(), automatic).visibleNow).toBe(true);
  });

  it('uses the board planning predicate for a card already visible in «Неделя»', () => {
    const week = moscowIsoWeek(new Date());
    expect(week).not.toBeNull();
    const scheduled = card({ week: week ?? undefined });
    const current = scope({ workspaceView: 'mine', planningTab: 'week' });
    const placement = placeCreatedCard(scheduled, current);

    expect(placement.issues.map(issue => issue.kind)).not.toContain('tab');
    expect(automaticRevealScope(scheduled, current, placement).planningTab).toBe('week');
  });

  it('keeps every filter when another one still hides the card', () => {
    const current = scope({ project: 'Другой проект', attention: 'blocked' });
    const placement = placeCreatedCard(card(), current);
    const automatic = automaticRevealScope(card(), current, placement);
    expect(automatic).toEqual(current);
    expect(placement.issues.map(issue => issue.kind)).toContain('project');
    expect(placement.issues.map(issue => issue.kind)).toContain('attention');
  });

  it('uses the shared view for a card that is shared', () => {
    const placement = placeCreatedCard(card({ shared: true }), scope({ person: 'Анна QA' }));
    expect(placement.matchingView).toBe('shared');
    const automatic = automaticRevealScope(card({ shared: true }), scope({ person: 'Анна QA' }), placement);
    expect(automatic.workspaceView).toBe('shared');
  });

  it('leaves a card that is already visible alone', () => {
    const inAll = placeCreatedCard(card(), scope({ workspaceView: 'all' }));
    expect(inAll.visibleNow).toBe(true);
    expect(inAll.matchingView).toBe('all');
    expect(inAll.issues).toEqual([]);
    const inMine = placeCreatedCard(card(), scope({ workspaceView: 'mine' }));
    expect(inMine.visibleNow).toBe(true);
    expect(inMine.matchingView).toBe('mine');
    expect(inMine.issues.map(issue => issue.kind)).not.toContain('workspace');
  });

  it('names the owner and the shared state in the confirmation', () => {
    const placement = placeCreatedCard(card(), scope());
    expect(placement.location).toContain('Владелец: nikita');
    expect(placement.location).toContain('Общая: нет');
    expect(placement.location).toContain('видна в режиме «Моё»');
  });

  it('describes the visible place without promising a wider scope', () => {
    const placement = placeCreatedCard(card(), scope());
    const automatic = automaticRevealScope(card(), scope(), placement);
    const visible = describePlacement(card(), placeCreatedCard(card(), automatic), { from: 'shared', to: 'mine' });
    expect(visible).toContain('создана и показана в режиме «Моё»');
    expect(visible).toContain('Режим переключён с «Общее» на «Моё»');
    expect(visible).toContain('Владелец: nikita');

    const hidden = describePlacement(card(), placement);
    expect(hidden).toContain('Сейчас её скрывает: режим «Общее»');
    expect(hidden).toContain('доска не расширяет видимость');
    expect(hidden).not.toContain('Показать в режиме «Всё»');
  });
});
