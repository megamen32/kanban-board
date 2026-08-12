import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import type { KanbanCard } from '@/lib/kanban/types';

vi.mock('../ui/badge', () => ({ Badge: () => null }));
vi.mock('../ui/button', () => ({ Button: () => null }));

import { getPlanningTabCards, getWeeklySelectionState } from './view-model';
import { getExecutionColumnCards, getWeeklyViewSections } from './planning-views';

const card = (overrides: Partial<KanbanCard> = {}): KanbanCard => ({
  id: 'one',
  title: 'Task',
  description: '',
  column: 'todo',
  priority: 'medium',
  tags: [],
  order: 0,
  created: '2026-08-12T00:00:00Z',
  updated: '2026-08-12T00:00:00Z',
  fileName: 'one.md',
  version: 1,
  project: '',
  assignees: [],
  ...overrides,
});

describe('planning UI projections', () => {
  it('projects the five tabs from the server-compatible card predicates', () => {
    const cards = [
      card({ id: 'inbox', column: 'inbox' }),
      card({ id: 'today', assignees: ['nikita'], scheduledAt: '2026-08-12T09:00:00+03:00' }),
      card({ id: 'archived', column: 'archived' }),
    ];

    expect(getPlanningTabCards(cards, 'execution', '2026-08-12T10:00:00+03:00').map(item => item.id))
      .toEqual(['inbox', 'today']);
    expect(getPlanningTabCards(cards, 'inbox').map(item => item.id)).toEqual(['inbox']);
    expect(getPlanningTabCards(cards, 'today', '2026-08-12T10:00:00+03:00').map(item => item.id)).toEqual(['today']);
  });

  it('does not render archived cards in an Execution column', () => {
    const archived = card({ id: 'archived', column: 'archived' });
    const active = card({ id: 'active', column: 'todo' });

    expect(getExecutionColumnCards([archived, active], 'todo').map(item => item.id)).toEqual(['active']);
    expect(getExecutionColumnCards([archived, active], 'archived')).toEqual([]);
  });

  it('allows only one to six proposed weekly cards', () => {
    expect(getWeeklySelectionState([])).toEqual({ selectedIds: [], canAccept: false });
    expect(getWeeklySelectionState(['a', 'b'])).toEqual({ selectedIds: ['a', 'b'], canAccept: true });
    expect(getWeeklySelectionState(['a', 'b', 'c', 'd', 'e', 'f', 'g']).canAccept).toBe(false);
  });

  it('shows accepted current-week rocks and supporting actions separately from the proposal', () => {
    const acceptedRock = card({ id: 'accepted-rock', week: '2026-W33', bigRock: true, important: true });
    const supportingAction = card({ id: 'supporting-action', week: '2026-W33', type: 'action', bigRock: false, todayRank: 1 });
    const unacceptedCandidate = card({ id: 'candidate', important: true, week: undefined, bigRock: false });

    const currentWeek = getPlanningTabCards(
      [acceptedRock, supportingAction, unacceptedCandidate],
      'week',
      '2026-08-12T10:00:00+03:00',
    );

    expect(currentWeek.map(item => item.id)).toEqual(['accepted-rock', 'supporting-action']);
    expect(getWeeklySelectionState(['candidate']).selectedIds).toEqual(['candidate']);
    expect(currentWeek).not.toContain(unacceptedCandidate);
  });

  it('uses the complete board card set for the accepted Week view when a proposal is loaded', () => {
    const acceptedRock = card({ id: 'accepted-rock', week: '2026-W33', bigRock: true });
    const proposalOnly = card({ id: 'proposal-only', important: true });
    const sections = getWeeklyViewSections(
      [acceptedRock, proposalOnly],
      { week: '2026-W33', cardIds: ['proposal-only'], cards: [proposalOnly] },
      '2026-08-12T10:00:00+03:00',
    );

    expect(sections.currentWeek.map(item => item.id)).toEqual(['accepted-rock']);
    expect(sections.proposal.map(item => item.id)).toEqual(['proposal-only']);
  });
});
