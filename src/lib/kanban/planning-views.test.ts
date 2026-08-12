import { describe, expect, test } from 'vitest';
import type { KanbanCard } from './types';
import {
  getExecutionView,
  getInboxView,
  getRoleBalance,
  getTodayView,
  getWeekView,
} from './planning-views';

function card(overrides: Partial<KanbanCard> = {}): KanbanCard {
  return {
    id: 'card-1',
    title: 'Card',
    description: '',
    column: 'todo',
    priority: 'medium',
    tags: [],
    order: 0,
    created: '2026-08-10T09:00:00.000Z',
    updated: '2026-08-10T09:00:00.000Z',
    fileName: 'card-1.md',
    version: 1,
    project: 'alpha',
    assignees: [],
    type: 'action',
    important: false,
    urgent: false,
    bigRock: false,
    waitingFor: [],
    requiresApprovalFrom: [],
    ...overrides,
  };
}

describe('planning derived views', () => {
  test('groups every non-archived card by its execution column', () => {
    const result = getExecutionView([
      card({ id: 'inbox', column: 'inbox' }),
      card({ id: 'blocked', column: 'blocked' }),
      card({ id: 'done', column: 'done' }),
      card({ id: 'archived', column: 'archived' }),
    ]);

    expect(result.inbox.map(item => item.id)).toEqual(['inbox']);
    expect(result.blocked.map(item => item.id)).toEqual(['blocked']);
    expect(result.done.map(item => item.id)).toEqual(['done']);
    expect(result.archived).toEqual([]);
  });

  test('does not expose archived cards in any execution bucket', () => {
    const result = getExecutionView([
      card({ id: 'archived-inbox', column: 'archived' }),
    ]);

    expect(Object.values(result).flat().map(item => item.id)).toEqual([]);
  });

  test('selects Inbox as the persisted inbox column', () => {
    expect(getInboxView([
      card({ id: 'inbox', column: 'inbox' }),
      card({ id: 'todo', column: 'todo' }),
    ]).map(item => item.id)).toEqual(['inbox']);
  });

  test('selects the current ISO week using Europe/Moscow local time and puts rocks first', () => {
    const now = '2026-08-16T23:30:00.000Z'; // 2026-08-17 in Moscow, 2026-W34.
    const result = getWeekView([
      card({ id: 'supporting', week: '2026-W34', todayRank: 2 }),
      card({ id: 'rock', week: '2026-W34', bigRock: true, todayRank: 3 }),
      card({ id: 'previous', week: '2026-W33', bigRock: true }),
    ], now);

    expect(result.map(item => item.id)).toEqual(['rock', 'supporting']);
  });

  test('selects Nikita Today cards, applies Moscow scheduled date, and returns deterministic top three', () => {
    const now = '2026-08-12T00:30:00.000Z'; // 03:30 in Moscow.
    const result = getTodayView([
      card({ id: 'rank-2', assignees: ['nikita'], scheduledAt: '2026-08-12T23:00:00+03:00', todayRank: 2, order: 1 }),
      card({ id: 'quadrant-1', assignees: ['nikita'], scheduledAt: '2026-08-12T09:00:00+03:00', important: true, urgent: true, todayRank: 3, order: 2 }),
      card({ id: 'waiting', waitingFor: ['nikita'], scheduledAt: '2026-08-12T10:00:00+03:00', todayRank: 3, dueAt: '2026-08-12T12:00:00+03:00', order: 3 }),
      card({ id: 'approval', requiresApprovalFrom: ['nikita'], scheduledAt: '2026-08-12T11:00:00+03:00', todayRank: 3, dueAt: '2026-08-12T11:00:00+03:00', order: 4 }),
      card({ id: 'teammate', assignees: ['marina'], scheduledAt: '2026-08-12T09:00:00+03:00' }),
      card({ id: 'wrong-date', assignees: ['nikita'], scheduledAt: '2026-08-13T00:00:00+03:00' }),
      card({ id: 'done', assignees: ['nikita'], column: 'done', scheduledAt: '2026-08-12T09:00:00+03:00' }),
      card({ id: 'someday', assignees: ['nikita'], column: 'someday', scheduledAt: '2026-08-12T09:00:00+03:00' }),
    ], now);

    expect(result.map(item => item.id)).toEqual(['rank-2', 'quadrant-1', 'approval']);
  });

  test('includes singular planning assignee while preserving legacy waiting and approval fields', () => {
    const result = getTodayView([
      card({ id: 'singular-assignee', assignee: 'nikita', scheduledAt: '2026-08-12T09:00:00+03:00' }),
      card({ id: 'legacy-waiting', waitingFor: ['nikita'], scheduledAt: '2026-08-12T10:00:00+03:00' }),
      card({ id: 'legacy-approval', requiresApprovalFrom: ['nikita'], scheduledAt: '2026-08-12T11:00:00+03:00' }),
      card({ id: 'teammate', assignee: 'marina', assignees: ['marina'], scheduledAt: '2026-08-12T08:00:00+03:00' }),
    ], '2026-08-12T00:30:00.000Z');

    expect(result.map(item => item.id)).toEqual([
      'singular-assignee',
      'legacy-waiting',
      'legacy-approval',
    ]);
  });

  test('returns role balance for all stable roles and warns only when no accepted current-week rock exists', () => {
    const result = getRoleBalance([
      card({ id: 'rock', role: 'product-builder', week: '2026-W33', bigRock: true }),
      card({ id: 'needs-review-rock', role: 'client-integrator', week: '2026-W33', bigRock: true, needsReview: true }),
      card({ id: 'active', role: 'client-integrator', column: 'in-progress' }),
      card({ id: 'finished', role: 'client-integrator', column: 'done' }),
    ], '2026-08-12T09:00:00+03:00');

    expect(result['product-builder']).toMatchObject({
      acceptedBigRocks: ['rock'],
      activeActions: ['rock'],
      warning: false,
    });
    expect(result['client-integrator']).toMatchObject({
      acceptedBigRocks: [],
      activeActions: ['needs-review-rock', 'active'],
      warning: true,
    });
    expect(Object.keys(result)).toHaveLength(6);
  });
});
