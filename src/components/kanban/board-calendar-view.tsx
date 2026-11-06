'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { KanbanCard } from '@/lib/kanban/types';
import { calendarDay, calendarDays, calendarTasks, calendarTime, moveCalendar, personalEventOnDay, shiftDay, type CalendarPeriod, type PersonalCalendarEvent } from '@/lib/kanban/board-calendar';

import { watchPersonalCalendar, type CalendarFeed as Feed } from './board-calendar-feed';

interface Props {
  cards: KanbanCard[];
  username: string | null;
  anchor?: string;
  period: CalendarPeriod;
  onNavigate: (anchor: string, period: CalendarPeriod) => void;
  onOpen: (card: KanbanCard) => void;
}
const DAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export function CalendarPanel({ cards, anchor, period, timeZone, events, onOpen }: {
  cards: KanbanCard[]; anchor: string; period: CalendarPeriod; timeZone: string;
  events: PersonalCalendarEvent[]; onOpen: (card: KanbanCard) => void;
}) {
  const days = calendarDays(anchor, period);
  const { dated, undated } = calendarTasks(cards, timeZone);
  const today = calendarDay(new Date(), timeZone);
  return <>
    <p className="text-xs text-muted-foreground">План и срок задачи показаны отдельными отметками. Срок не означает встречу. Личные события отмечены фиолетовым.</p>
    <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border bg-border md:grid-cols-7" aria-label="Даты календаря">
      {DAY_NAMES.map(day => <div key={day} className="hidden bg-muted p-2 text-center text-xs font-medium md:block">{day}</div>)}
      {days.map(day => {
        const tasks = dated.get(day) ?? [];
        const personal = events.filter(event => personalEventOnDay(event, day, timeZone));
        const outside = period === 'month' && day.slice(0, 7) !== anchor.slice(0, 7);
        return <section key={day} aria-label={day} className={`min-w-0 bg-background p-2 md:min-h-32 ${outside ? 'hidden md:block md:bg-muted/50' : ''}`}>
          <h3 className={`mb-2 flex items-center gap-2 text-sm ${day === today ? 'font-bold text-primary' : 'text-muted-foreground'}`}>
            <time dateTime={day}>{new Intl.DateTimeFormat('ru', { timeZone: 'UTC', day: 'numeric', month: 'short', weekday: 'short' }).format(new Date(day))}</time>
            {day === today && <span className="text-[10px]">Сегодня</span>}
          </h3>
          <div className="space-y-1.5">
            {tasks.map(task => <button type="button" key={task.card.id + task.kind} onClick={() => onOpen(task.card)}
              className={`block w-full min-w-0 rounded border-l-2 p-2 text-left text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary ${task.kind === 'due' ? 'border-amber-500 bg-amber-500/10' : 'border-sky-500 bg-sky-500/10'}`}>
              <span className="mb-1 block text-[10px] text-muted-foreground">{task.kind === 'both' ? 'План и срок' : task.kind === 'due' ? 'Срок' : 'План'} · {calendarTime(task.at, timeZone)}</span>
              <span className="break-words font-medium">{task.card.title}</span>
              {task.card.project && <span className="mt-1 block truncate text-[10px] text-muted-foreground">{task.card.project}</span>}
            </button>)}
            {personal.map(event => <div key={event.id + event.startTime} className="rounded border-l-2 border-violet-500 bg-violet-500/10 p-2 text-xs">
              <span className="mb-1 block text-[10px] text-muted-foreground">Личное · {event.isAllDay ? 'Весь день' : `${calendarTime(event.startTime, timeZone)}-${calendarTime(event.endTime, timeZone)}`}</span>
              <span className="break-words font-medium">{event.title || 'Без названия'}</span>
            </div>)}
            {!tasks.length && !personal.length && <p className="text-xs text-muted-foreground/70">Нет задач и событий</p>}
          </div>
        </section>;
      })}
    </div>
    <details className="rounded-lg border p-3" open={undated.length > 0 && undated.length <= 8}>
      <summary className="cursor-pointer text-sm font-medium">Без даты ({undated.length})</summary>
      <p className="my-2 text-xs text-muted-foreground">Откройте карточку, чтобы указать план или срок. Даты не назначаются автоматически.</p>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{undated.map(card => <button type="button" key={card.id} onClick={() => onOpen(card)} className="rounded-md border p-2 text-left text-sm hover:bg-accent">{card.title}</button>)}</div>
    </details>
  </>;
}

export function BoardCalendarView({ cards, username, anchor, period, onNavigate, onOpen }: Props) {
  const [timeZone, setTimeZone] = useState('UTC');
  const [ready, setReady] = useState(false);
  const [retry, setRetry] = useState(0);
  const [response, setResponse] = useState<{ key: string; account: string; feed: Feed } | null>(null);
  useEffect(() => { setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'); setReady(true); }, []);
  const date = anchor || calendarDay(new Date(), timeZone)!;
  const days = useMemo(() => calendarDays(date, period), [date, period]);
  const first = days[0];
  const last = shiftDay(days[days.length - 1], 1);
  const key = JSON.stringify([username, first, last, timeZone, retry]);
  useEffect(() => {
    if (!ready) return;
    return watchPersonalCalendar({ from: first, to: last, timeZone,
      onChange: result => setResponse(result ? { key, ...result } : null),
    });
  }, [first, last, timeZone, key, ready]);
  const feed: Feed = response?.key === key ? response.feed : { state: 'loading', events: [] };
  const zones = [...new Set([Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', 'Europe/Moscow', 'UTC', 'Europe/Berlin', 'America/New_York'])];
  const title = period === 'month'
    ? new Intl.DateTimeFormat('ru', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(date))
    : `${first} - ${days[6]}`;
  return <div className="space-y-3 p-3 sm:p-6" aria-label="Календарь задач">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <CalendarDays aria-hidden className="h-5 w-5" />
        <h2 className="text-lg font-semibold capitalize">{title}</h2>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <Button aria-label="Предыдущий период" variant="outline" size="sm" onClick={() => onNavigate(moveCalendar(date, period, -1), period)}><ChevronLeft aria-hidden className="h-4 w-4" /></Button>
        <Button variant="outline" size="sm" onClick={() => onNavigate(calendarDay(new Date(), timeZone)!, period)}>Сегодня</Button>
        <Button aria-label="Следующий период" variant="outline" size="sm" onClick={() => onNavigate(moveCalendar(date, period, 1), period)}><ChevronRight aria-hidden className="h-4 w-4" /></Button>
        {(['month', 'week'] as const).map(value => <Button key={value} aria-pressed={period === value} variant={period === value ? 'secondary' : 'ghost'} size="sm" onClick={() => onNavigate(date, value)}>{value === 'month' ? 'Месяц' : 'Неделя'}</Button>)}
      </div>
    </div>
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <label>Часовой пояс <select aria-label="Часовой пояс календаря" value={timeZone} onChange={event => setTimeZone(event.target.value)} className="ml-1 rounded border bg-background p-1">{zones.map(zone => <option key={zone} value={zone}>{zone}</option>)}</select></label>
      <span className="text-muted-foreground">Личные события: {response?.key === key && response.account ? response.account : 'текущий аккаунт'}. Фильтр сотрудника их не меняет.</span>
    </div>
    <div role={feed.state === 'error' ? 'alert' : 'status'} className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-2 text-sm">
      <span>{feed.state === 'loading' ? 'Загружаем личный календарь…' : feed.state === 'not_connected' ? 'Личный календарь не подключён. Задачи доски доступны ниже.' : feed.state === 'disabled' ? 'Интеграция личного календаря выключена. Задачи доски доступны ниже.' : feed.state === 'error' ? 'Не удалось загрузить личный календарь. Задачи доски доступны ниже.' : feed.events.length ? 'Показаны события вашего подключённого календаря.' : 'В подключённом календаре нет событий за этот период.'}</span>
      <Button aria-label="Обновить личный календарь" variant="ghost" size="sm" onClick={() => setRetry(value => value + 1)}><RefreshCw aria-hidden className="mr-1 h-3 w-3" />Обновить</Button>
    </div>
    <CalendarPanel cards={cards} anchor={date} period={period} timeZone={timeZone} events={feed.events} onOpen={onOpen} />
  </div>;
}
