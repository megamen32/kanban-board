import { isDateOnlyDueAt } from '@/lib/kanban/due-at';
import type { KanbanCard } from '@/lib/kanban/types';

export const MOSCOW_TIME_ZONE = 'Europe/Moscow';
export type CalendarKind = 'deadline' | 'plan';

export interface CalendarDate {
  day: string;
  timestamp: number | null;
  hasTime: boolean;
}

export interface CalendarEntry extends CalendarDate {
  id: string;
  card: KanbanCard;
  kind: CalendarKind;
  value: string;
}

export interface CalendarDateIssue {
  card: KanbanCard;
  fields: CalendarKind[];
}

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: MOSCOW_TIME_ZONE, calendar: 'gregory', numberingSystem: 'latn',
  year: 'numeric', month: '2-digit', day: '2-digit',
});
const timeFormatter = new Intl.DateTimeFormat('ru-RU', {
  timeZone: MOSCOW_TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false,
});

export function isCalendarDay(value: string): boolean { return isDateOnlyDueAt(value); }

function dayFromInstant(date: Date): string | null {
  if (!Number.isFinite(date.getTime())) return null;
  const parts = dayFormatter.formatToParts(date);
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  const day = `${part('year')?.padStart(4, '0')}-${part('month')}-${part('day')}`;
  return isCalendarDay(day) ? day : null;
}

/** A date-only value has no invented time; an instant must carry its offset. */
export function parseCalendarDate(value: string | null | undefined): CalendarDate | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const input = value.trim();
  if (isCalendarDay(input)) return { day: input, timestamp: null, hasTime: false };
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/i.exec(input);
  if (!match || !isCalendarDay(match[1]) || Number(match[2]) > 23
    || Number(match[3]) > 59 || Number(match[4] ?? 0) > 59) return null;
  if (match[5].toUpperCase() !== 'Z') {
    const [hours, minutes] = match[5].slice(1).split(':').map(Number);
    if (hours > 23 || minutes > 59) return null;
  }
  const timestamp = Date.parse(input);
  const day = dayFromInstant(new Date(timestamp));
  return day ? { day, timestamp, hasTime: true } : null;
}

export function moscowDay(value: string | Date | null | undefined): string | null {
  return value instanceof Date ? dayFromInstant(value) : parseCalendarDate(value)?.day ?? null;
}

export function formatStamp(value: string | null | undefined, dateOnly = false): string {
  const parsed = parseCalendarDate(value);
  if (!parsed) return 'неизвестно';
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: parsed.hasTime ? MOSCOW_TIME_ZONE : 'UTC',
    day: 'numeric', month: 'short', year: 'numeric',
    ...(parsed.hasTime && !dateOnly ? { hour: '2-digit' as const, minute: '2-digit' as const } : {}),
  }).format(parsed.timestamp === null ? new Date(`${parsed.day}T12:00:00Z`) : new Date(parsed.timestamp));
}

export function calendarTime(entry: CalendarDate): string {
  return entry.timestamp === null ? 'без времени' : timeFormatter.format(new Date(entry.timestamp));
}

export function calendarMonth(day: string): string { return `${day.slice(0, 7)}-01`; }

export function shiftCalendarMonth(month: string, delta: number): string {
  const date = new Date(`${month}T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return date.toISOString().slice(0, 10);
}

export function calendarMonthCells(month: string): string[] {
  const start = new Date(`${month}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

export function calendarMonthLabel(month: string): string {
  return new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}T12:00:00Z`));
}

export function calendarDayLabel(day: string): string {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', weekday: 'long', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
}

/** A week is a range, never evidence of a particular planned day. */
export function calendarWeekLabel(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  const match = /^(\d{4})-W(\d{2})$/.exec(value);
  if (!match || Number(match[1]) < 1) return 'Неделя: неизвестно';
  const year = Number(match[1]);
  const week = Number(match[2]);
  const firstDay = new Date(`${match[1]}-01-01T00:00:00Z`).getUTCDay();
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const lastWeek = firstDay === 4 || (firstDay === 3 && leap) ? 53 : 52;
  return week >= 1 && week <= lastWeek ? `Неделя ${value} · день неизвестен` : 'Неделя: неизвестно';
}

export function isCalendarCardClosed(card: KanbanCard): boolean {
  return card.column === 'done' || card.column === 'archived';
}

function compareEntries(left: CalendarEntry, right: CalendarEntry): number {
  return left.day.localeCompare(right.day)
    || (left.timestamp ?? Number.NEGATIVE_INFINITY) - (right.timestamp ?? Number.NEGATIVE_INFINITY)
    || left.card.title.localeCompare(right.card.title, 'ru')
    || left.card.id.localeCompare(right.card.id)
    || (left.kind === 'plan' ? 0 : 1) - (right.kind === 'plan' ? 0 : 1);
}

export function calendarEntryIsPast(entry: CalendarDate, now: Date): boolean {
  return entry.timestamp === null ? entry.day < moscowDay(now)! : entry.timestamp < now.getTime();
}

/** All derivation is read-only and uses the caller's explicit clock. */
export function buildCalendarModel(cards: readonly KanbanCard[], now: Date) {
  if (!moscowDay(now)) throw new Error('Calendar requires a valid observation time');
  const entries: CalendarEntry[] = [];
  const undated: KanbanCard[] = [];
  const invalidDates: CalendarDateIssue[] = [];
  for (const card of cards) {
    const before = entries.length;
    const invalid: CalendarKind[] = [];
    for (const [kind, value] of [['deadline', card.dueAt], ['plan', card.scheduledAt]] as const) {
      const date = parseCalendarDate(value);
      if (date && value) entries.push({ ...date, id: `${card.id}:${kind}`, card, kind, value });
      else if (typeof value === 'string' && value.trim()) invalid.push(kind);
    }
    if (entries.length === before) undated.push(card);
    if (invalid.length) invalidDates.push({ card, fields: invalid });
  }
  entries.sort(compareEntries);
  const byDay = new Map<string, CalendarEntry[]>();
  for (const entry of entries) {
    const group = byDay.get(entry.day) ?? [];
    group.push(entry);
    byDay.set(entry.day, group);
  }
  const upcoming = entries.filter(entry => !calendarEntryIsPast(entry, now));
  const past = entries.filter(entry => calendarEntryIsPast(entry, now)).sort((left, right) => compareEntries(right, left));
  const overdue = entries.filter(entry => entry.kind === 'deadline' && !isCalendarCardClosed(entry.card) && calendarEntryIsPast(entry, now));
  const nearest = upcoming.find(entry => !isCalendarCardClosed(entry.card))
    ?? past.find(entry => !isCalendarCardClosed(entry.card))
    ?? upcoming[0] ?? past[0] ?? null;
  const orderedUndated = [
    ...undated.filter(card => !isCalendarCardClosed(card)),
    ...undated.filter(isCalendarCardClosed),
  ];
  return {
    entries, byDay, upcoming, past, overdue, undated: orderedUndated, invalidDates, nearest,
    datedCardCount: new Set(entries.map(entry => entry.card.id)).size,
    issueByCard: new Map(invalidDates.map(issue => [issue.card.id, issue.fields])),
  };
}
