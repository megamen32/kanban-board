import { describe, expect, it } from 'vitest';
import type { KanbanCard } from '@/lib/kanban/types';
import {
  buildCalendarModel, calendarMonthCells, calendarTime, calendarWeekLabel,
  formatStamp, isCalendarDay, moscowDay, parseCalendarDate, shiftCalendarMonth,
} from './kontur-calendar-model';

const NOW = new Date('2026-11-07T12:00:00Z');
function card(id: string, values: Partial<KanbanCard> = {}): KanbanCard {
  return {
    id, title: `Тест ${id}`, description: '', column: 'todo', priority: 'medium',
    tags: [], order: 0, created: '2026-11-01T12:00:00Z', updated: '2026-11-06T12:00:00Z',
    fileName: `${id}.md`, version: 1, project: 'Синтетический проект', assignees: [], ...values,
  };
}

describe('calendar dates and Moscow boundaries', () => {
  it('rejects Gregorian overflow instead of silently moving an impossible date', () => {
    for (const value of ['2026-02-29', '2026-02-30', '2026-04-31', '2026-13-01', '2026-00-01', '2026-01-00', '0000-01-01']) {
      expect(isCalendarDay(value)).toBe(false);
      expect(parseCalendarDate(value)).toBeNull();
      expect(parseCalendarDate(`${value}T12:00:00Z`)).toBeNull();
    }
    expect(isCalendarDay('2024-02-29')).toBe(true);
    expect(isCalendarDay('2000-02-29')).toBe(true);
    expect(isCalendarDay('1900-02-29')).toBe(false);
  });

  it('keeps date-only values without inventing midnight or a time', () => {
    const date = parseCalendarDate('2026-11-07');
    expect(date).toEqual({ day: '2026-11-07', timestamp: null, hasTime: false });
    expect(calendarTime(date!)).toBe('без времени');
    expect(formatStamp('2026-11-07')).not.toMatch(/\d{2}:\d{2}/);
  });

  it('groups offset timestamps by the Moscow day, independent of host timezone', () => {
    expect(moscowDay('2026-11-07T20:59:59Z')).toBe('2026-11-07');
    expect(moscowDay('2026-11-07T21:00:00Z')).toBe('2026-11-08');
    expect(moscowDay('2026-11-08T01:30:00+05:00')).toBe('2026-11-07');
    expect(moscowDay(new Date('2026-11-07T21:00:00Z'))).toBe('2026-11-08');
    expect(calendarTime(parseCalendarDate('2026-11-07T21:00:00Z')!)).toBe('00:00');
  });

  it('rejects ambiguous or invalid clocks rather than assigning the browser timezone', () => {
    for (const value of ['2026-11-07T10:00', '2026-11-07T24:00:00Z', '2026-11-07T12:60:00Z', '2026-11-07T12:00:60Z', '2026-11-07T12:00:00+24:00', '2026-11-07T12:00:00+03:60', '11/07/2026', 'not-a-date']) {
      expect(parseCalendarDate(value)).toBeNull();
      expect(formatStamp(value)).toBe('неизвестно');
    }
  });

  it('keeps the Monday-first grid and month changes correct across year and leap boundaries', () => {
    expect(shiftCalendarMonth('2026-12-01', 1)).toBe('2027-01-01');
    expect(shiftCalendarMonth('2026-01-01', -1)).toBe('2025-12-01');
    const february = calendarMonthCells('2024-02-01');
    expect(february).toHaveLength(42);
    expect(february[0]).toBe('2024-01-29');
    expect(february).toContain('2024-02-29');
    expect(new Set(february).size).toBe(42);
  });

  it('validates ISO weeks without inventing a particular date', () => {
    expect(calendarWeekLabel('2026-W53')).toBe('Неделя 2026-W53 · день неизвестен');
    expect(calendarWeekLabel('2025-W53')).toBe('Неделя: неизвестно');
    expect(calendarWeekLabel('2026-W00')).toBe('Неделя: неизвестно');
    expect(calendarWeekLabel(undefined)).toBeNull();
  });
});

describe('calendar task visibility', () => {
  it('shows a persisted plan without a deadline and keeps both labels when a task has both', () => {
    const onlyPlan = card('plan', { scheduledAt: '2026-11-08T09:00:00+03:00' });
    const both = card('both', { dueAt: '2026-11-08T12:00:00Z', scheduledAt: '2026-11-08T08:00:00Z' });
    const model = buildCalendarModel([onlyPlan, both], NOW);
    expect(model.entries.map(entry => [entry.card.id, entry.kind])).toEqual([
      ['plan', 'plan'], ['both', 'plan'], ['both', 'deadline'],
    ]);
    expect(model.datedCardCount).toBe(2);
    expect(model.byDay.get('2026-11-08')).toHaveLength(3);
    expect(model.undated).toEqual([]);
  });

  it('does not derive dates from created, updated, week, completion or execution history', () => {
    const source = card('week-only', { week: '2026-W45', completedAt: '2026-11-07T10:00:00Z' });
    const model = buildCalendarModel([source], NOW);
    expect(model.entries).toEqual([]);
    expect(model.undated).toEqual([source]);
    expect(model.nearest).toBeNull();
  });

  it('keeps invalid dates visible, including a task with a valid plan and invalid deadline', () => {
    const unknown = card('invalid', { dueAt: '2026-02-30' });
    const mixed = card('mixed', { dueAt: 'bad', scheduledAt: '2026-11-09T09:00:00+03:00' });
    const model = buildCalendarModel([unknown, mixed], NOW);
    expect(model.undated).toEqual([unknown]);
    expect(model.invalidDates.map(issue => [issue.card.id, issue.fields])).toEqual([
      ['invalid', ['deadline']], ['mixed', ['deadline']],
    ]);
    expect(model.entries).toHaveLength(1);
    expect(model.entries[0].card).toBe(mixed);
  });

  it('distinguishes overdue deadlines, past plans, closed cards and all-day deadlines', () => {
    const cards = [
      card('old-deadline', { dueAt: '2026-01-01' }),
      card('past-plan', { scheduledAt: '2026-11-06T09:00:00+03:00' }),
      card('done', { column: 'done', dueAt: '2026-01-01' }),
      card('archived', { column: 'archived', dueAt: '2026-01-01' }),
      card('today-all-day', { dueAt: '2026-11-07' }),
      card('today-expired', { dueAt: '2026-11-07T11:59:59Z' }),
      card('future', { dueAt: '2026-11-07T12:00:01Z' }),
    ];
    const model = buildCalendarModel(cards, NOW);
    expect(model.overdue.map(entry => entry.card.id)).toEqual(['old-deadline', 'today-expired']);
    expect(model.upcoming.map(entry => entry.card.id)).toEqual(['today-all-day', 'future']);
    expect(model.past).toHaveLength(5);
    expect(model.entries).toHaveLength(cards.length);
  });

  it('keeps dates outside the current month reachable, including a past-only board', () => {
    const model = buildCalendarModel([
      card('historical', { dueAt: '2025-01-01' }),
      card('later', { scheduledAt: '2027-03-01T09:00:00+03:00' }),
    ], NOW);
    expect(model.nearest?.card.id).toBe('later');
    expect(model.overdue).toHaveLength(1);
    expect(buildCalendarModel([card('historical', { dueAt: '2025-01-01' })], NOW).nearest?.day).toBe('2025-01-01');
  });

  it('retains filtered input, all undated tasks and stable source objects without mutations', () => {
    const cards = Array.from({ length: 70 }, (_, index) => Object.freeze(card(`undated-${index}`, { project: index % 2 ? 'Проект A' : 'Проект B' })));
    const frozen = Object.freeze(cards);
    const model = buildCalendarModel(frozen, NOW);
    expect(model.undated).toHaveLength(70);
    expect(model.undated[0]).toBe(cards[0]);
    expect(buildCalendarModel(cards.filter(item => item.project === 'Проект A'), NOW).undated).toHaveLength(35);
    expect(cards[0]).not.toHaveProperty('dueAt');
  });

  it('puts open undated tasks before closed ones while preserving each group and the source order', () => {
    const cards = Object.freeze([
      card('done-first', { column: 'done' }),
      card('open-second', { column: 'blocked' }),
      card('archived-third', { column: 'archived' }),
      card('open-fourth', { column: 'todo' }),
      card('done-fifth', { column: 'done' }),
    ]);
    expect(buildCalendarModel(cards, NOW).undated.map(item => item.id)).toEqual([
      'open-second', 'open-fourth', 'done-first', 'archived-third', 'done-fifth',
    ]);
    expect(cards.map(item => item.id)).toEqual([
      'done-first', 'open-second', 'archived-third', 'open-fourth', 'done-fifth',
    ]);
  });
});
