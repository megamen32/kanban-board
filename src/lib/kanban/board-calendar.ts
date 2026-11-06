import type { KanbanCard } from './types';

export type CalendarPeriod = 'month' | 'week';
export interface PersonalCalendarEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  isAllDay: boolean;
}
export interface CalendarTask {
  card: KanbanCard;
  at: string;
  kind: 'scheduled' | 'due' | 'both';
}
const DAY = 86400000;

export function validCalendarDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value;
}
export function validTimeZone(value: string): boolean {
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return true; } catch { return false; }
}
export function calendarDay(value: string | Date, timeZone: string): string | null {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return validCalendarDay(value) ? value : null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function shiftDay(day: string, count: number): string {
  return new Date(Date.parse(day) + count * DAY).toISOString().slice(0, 10);
}
export function calendarDays(anchor: string, period: CalendarPeriod): string[] {
  const start = period === 'month' ? anchor.slice(0, 7) + '-01' : anchor;
  const weekday = (new Date(start).getUTCDay() + 6) % 7;
  const monday = shiftDay(start, -weekday);
  return Array.from({ length: period === 'month' ? 42 : 7 }, (_, index) => shiftDay(monday, index));
}
export function moveCalendar(anchor: string, period: CalendarPeriod, direction: number): string {
  if (period === 'week') return shiftDay(anchor, 7 * direction);
  const date = new Date(anchor);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + direction, 1)).toISOString().slice(0, 10);
}
export function calendarTasks(cards: KanbanCard[], timeZone: string): { dated: Map<string, CalendarTask[]>; undated: KanbanCard[] } {
  const dated = new Map<string, CalendarTask[]>();
  const undated: KanbanCard[] = [];
  for (const card of cards) {
    const scheduled = card.scheduledAt && calendarDay(card.scheduledAt, timeZone);
    const due = card.dueAt && calendarDay(card.dueAt, timeZone);
    if (!scheduled && !due) { undated.push(card); continue; }
    const add = (day: string, at: string, kind: CalendarTask['kind']) => {
      const items = dated.get(day) ?? [];
      items.push({ card, at, kind }); dated.set(day, items);
    };
    const same = scheduled && due && (card.scheduledAt === card.dueAt
      || (!validCalendarDay(card.scheduledAt!) && !validCalendarDay(card.dueAt!) && Date.parse(card.scheduledAt!) === Date.parse(card.dueAt!)));
    if (scheduled) add(scheduled, card.scheduledAt!, same ? 'both' : 'scheduled');
    if (due && !same) add(due, card.dueAt!, 'due');
  }
  for (const items of dated.values()) items.sort((a, b) => Number(!validCalendarDay(a.at)) - Number(!validCalendarDay(b.at)) || Date.parse(a.at) - Date.parse(b.at) || a.card.id.localeCompare(b.card.id));
  return { dated, undated };
}
export function personalEventOnDay(event: PersonalCalendarEvent, day: string, timeZone: string): boolean {
  // Keeper represents all-day civil dates at UTC midnight. Never shift them with the viewer's zone.
  const start = event.isAllDay ? event.startTime.slice(0, 10) : calendarDay(event.startTime, timeZone);
  const end = event.isAllDay
    ? event.endTime.slice(0, 10)
    : calendarDay(new Date(Math.max(Date.parse(event.startTime), Date.parse(event.endTime) - 1)), timeZone);
  return !!start && !!end && day >= start && (event.isAllDay ? day < end : day <= end);
}
export function calendarTime(value: string, timeZone: string): string {
  if (validCalendarDay(value)) return 'Без времени';
  return new Intl.DateTimeFormat('ru', { timeZone, hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
