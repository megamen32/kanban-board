import { describe, expect, it } from 'vitest';
import type { KanbanCard } from './types';
import { calendarDay, calendarDays, calendarTasks, moveCalendar, personalEventOnDay, validCalendarDay } from './board-calendar';
const card = (id: string, dates: Partial<KanbanCard> = {}) => ({ id, title: id, ...dates } as KanbanCard);
describe('calendar civil dates and task semantics', () => {
  it('uses the viewer timezone across midnight and DST without shifting date-only values', () => {
    expect(calendarDay('2026-11-06T22:30:00Z', 'Europe/Moscow')).toBe('2026-11-07');
    expect(calendarDay('2026-11-06T22:30:00Z', 'America/New_York')).toBe('2026-11-06');
    expect(calendarDay('2026-03-08T07:01:00Z', 'America/New_York')).toBe('2026-03-08');
    expect(calendarDay('2026-11-06', 'America/New_York')).toBe('2026-11-06');
    expect(validCalendarDay('2026-02-30')).toBe(false);
    expect(calendarDay('bad', 'UTC')).toBeNull();
  });
  it('builds complete Monday grids across year and leap-day boundaries', () => {
    expect(calendarDays('2026-11-06', 'month')).toHaveLength(42);
    expect(calendarDays('2026-11-06', 'month')[0]).toBe('2026-10-26');
    expect(calendarDays('2027-01-01', 'week')[0]).toBe('2026-12-28');
    expect(moveCalendar('2026-01-31', 'month', 1)).toBe('2026-02-01');
    expect(moveCalendar('2028-02-29', 'month', 1)).toBe('2028-03-01');
  });
  it('keeps scheduled time and deadline separate, without inventing a duration', () => {
    const task = card('a', { scheduledAt: '2026-11-07T10:00:00Z', dueAt: '2026-11-08T10:00:00Z' });
    const { dated, undated } = calendarTasks([task, card('b'), card('c', { dueAt: 'bad' })], 'UTC');
    expect(dated.get('2026-11-07')?.[0]).toEqual({ card: task, at: task.scheduledAt, kind: 'scheduled' });
    expect(dated.get('2026-11-08')?.[0].kind).toBe('due');
    expect(undated.map(c => c.id)).toEqual(['b', 'c']);
    expect(calendarTasks([card('d', { scheduledAt: '2026-11-07', dueAt: '2026-11-07' })], 'UTC').dated.get('2026-11-07')).toHaveLength(1);
  });
  it('sorts equivalent instants across offsets and only combines timestamp markers', () => {
    const { dated } = calendarTasks([
      card('later', { scheduledAt: '2026-11-07T08:00:00Z' }),
      card('earlier', { scheduledAt: '2026-11-07T10:00:00+03:00', dueAt: '2026-11-07T07:00:00.000Z' }),
      card('date-only', { scheduledAt: '2026-11-07', dueAt: '2026-11-07T00:00:00Z' }),
    ], 'UTC');
    expect(dated.get('2026-11-07')?.map(item => item.card.id)).toEqual(['date-only', 'date-only', 'earlier', 'later']);
    expect(dated.get('2026-11-07')?.find(item => item.card.id === 'earlier')?.kind).toBe('both');
  });
  it('keeps all-day events on their civil dates with an exclusive end', () => {
    const event = { id: 'e', title: 'Vacation', startTime: '2026-11-07T00:00:00Z', endTime: '2026-11-09T00:00:00Z', isAllDay: true };
    for (const zone of ['America/Los_Angeles', 'Pacific/Kiritimati']) {
      expect(personalEventOnDay(event, '2026-11-06', zone)).toBe(false);
      expect(personalEventOnDay(event, '2026-11-07', zone)).toBe(true);
      expect(personalEventOnDay(event, '2026-11-08', zone)).toBe(true);
      expect(personalEventOnDay(event, '2026-11-09', zone)).toBe(false);
    }
  });
  it('shows an overnight event on both dates but not at its exclusive midnight end', () => {
    const event = { id: 'e', title: 'Night', startTime: '2026-11-06T22:00:00Z', endTime: '2026-11-08T00:00:00Z', isAllDay: false };
    expect(personalEventOnDay(event, '2026-11-06', 'UTC')).toBe(true);
    expect(personalEventOnDay(event, '2026-11-07', 'UTC')).toBe(true);
    expect(personalEventOnDay(event, '2026-11-08', 'UTC')).toBe(false);
  });
});
