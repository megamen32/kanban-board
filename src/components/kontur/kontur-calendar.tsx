'use client';

import { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, List, ArrowUpRight } from 'lucide-react';
import type { KanbanCard } from '@/lib/kanban/types';

const MOSCOW = 'Europe/Moscow';

export function moscowDay(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en', { timeZone: MOSCOW, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function formatStamp(value: string | null | undefined, dateOnly = false): string {
  if (!value) return 'неизвестно';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'неизвестно';
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: MOSCOW, day: 'numeric', month: 'short', year: 'numeric',
    ...(!dateOnly ? { hour: '2-digit' as const, minute: '2-digit' as const } : {}),
  }).format(date);
}

function monthOf(day: string) { return `${day.slice(0, 7)}-01`; }
function asDate(day: string) { return new Date(`${day}T12:00:00Z`); }
function utcKey(date: Date) { return date.toISOString().slice(0, 10); }
function shiftedMonth(month: string, delta: number) {
  const date = asDate(month);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return utcKey(date);
}
function monthLabel(month: string) {
  return new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(asDate(month));
}
function dayLabel(day: string) {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', weekday: 'long', timeZone: 'UTC' }).format(asDate(day));
}
function timeLabel(card: KanbanCard) {
  if (!card.dueAt || !Number.isFinite(Date.parse(card.dueAt))) return 'время неизвестно';
  if (/^\d{4}-\d{2}-\d{2}$/.test(card.dueAt)) return 'без времени';
  return new Intl.DateTimeFormat('ru-RU', { timeZone: MOSCOW, hour: '2-digit', minute: '2-digit' }).format(new Date(card.dueAt));
}
function closed(card: KanbanCard) { return card.column === 'done' || card.column === 'archived'; }

export function KonturCalendar({ cards, onOpen }: { cards: KanbanCard[]; onOpen: (card: KanbanCard) => void }) {
  const today = moscowDay(new Date())!;
  const [month, setMonth] = useState(() => monthOf(today));
  const [selectedDay, setSelectedDay] = useState(today);
  const [mode, setMode] = useState<'month' | 'agenda'>('month');
  const [agendaLimit, setAgendaLimit] = useState(40);
  const [undatedLimit, setUndatedLimit] = useState(12);

  const dated = useMemo(() => cards.filter(card => moscowDay(card.dueAt)).sort((a, b) => Date.parse(a.dueAt!) - Date.parse(b.dueAt!) || a.title.localeCompare(b.title, 'ru')), [cards]);
  const undated = useMemo(() => cards.filter(card => !moscowDay(card.dueAt)), [cards]);
  const byDay = useMemo(() => {
    const result = new Map<string, KanbanCard[]>();
    for (const card of dated) {
      const day = moscowDay(card.dueAt)!;
      result.set(day, [...(result.get(day) ?? []), card]);
    }
    return result;
  }, [dated]);
  const cells = useMemo(() => {
    const start = asDate(month);
    start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start); date.setUTCDate(date.getUTCDate() + index);
      return utcKey(date);
    });
  }, [month]);
  const selectedCards = byDay.get(selectedDay) ?? [];
  const showToday = () => { setMonth(monthOf(today)); setSelectedDay(today); };
  const changeMonth = (delta: number) => { const next = shiftedMonth(month, delta); setMonth(next); setSelectedDay(next); };

  const eventRow = (card: KanbanCard, includeDate = false) => (
    <button type="button" className={`k-calendar-event${closed(card) ? ' is-closed' : ''}`} key={card.id} onClick={() => onOpen(card)}>
      <span className={`k-event-line k-priority-line-${card.priority}`} />
      <span className="k-event-copy"><small>{card.project?.trim() || 'неизвестно'}</small><strong>{card.title}</strong><span><Clock3 size={12} />{includeDate ? formatStamp(card.dueAt) : timeLabel(card)}{closed(card) && ' · закрыто'}</span></span>
      <ArrowUpRight size={15} aria-hidden="true" />
    </button>
  );

  return <section className="k-calendar" aria-label="Календарь задач">
    <div className="k-section-toolbar">
      <div className="k-calendar-navigation">
        <button type="button" className="k-icon-button" onClick={() => changeMonth(-1)} aria-label="Предыдущий месяц"><ChevronLeft size={18} /></button>
        <h2>{monthLabel(month)}</h2>
        <button type="button" className="k-icon-button" onClick={() => changeMonth(1)} aria-label="Следующий месяц"><ChevronRight size={18} /></button>
        <button type="button" className="k-button k-button-small" onClick={showToday}>Сегодня</button>
      </div>
      <div className="k-segmented" aria-label="Вид календаря">
        <button type="button" aria-pressed={mode === 'month'} onClick={() => setMode('month')}><CalendarDays size={15} />Месяц</button>
        <button type="button" aria-pressed={mode === 'agenda'} onClick={() => setMode('agenda')}><List size={15} />Расписание</button>
      </div>
    </div>
    <div className="k-notice"><Clock3 size={16} /><p>Сроки из карточек · Москва, UTC+3. Открой задачу, чтобы изменить срок или связать её с календарём Keeper.</p></div>
    {mode === 'month' ? <div className="k-calendar-layout">
      <div className="k-panel k-calendar-month">
        <div className="k-weekdays" aria-hidden="true">{['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'].map(day => <span key={day}>{day}</span>)}</div>
        <div className="k-calendar-grid">
          {cells.map(day => {
            const events = byDay.get(day) ?? [];
            const outside = day.slice(0, 7) !== month.slice(0, 7);
            return <button type="button" key={day} className={`k-calendar-cell${outside ? ' is-outside' : ''}${day === today ? ' is-today' : ''}${day === selectedDay ? ' is-selected' : ''}`} onClick={() => setSelectedDay(day)} aria-pressed={day === selectedDay} aria-current={day === today ? 'date' : undefined} aria-label={`${dayLabel(day)}. Задач: ${events.length}`}>
              <span className="k-cell-day">{Number(day.slice(8))}</span>
              <span className="k-cell-events" aria-hidden="true">{events.slice(0, 2).map(card => <span key={card.id} className={closed(card) ? 'is-closed' : ''}>{card.title}</span>)}{events.length > 2 && <small>ещё {events.length - 2}</small>}</span>
              {events.length > 0 && <span className="k-cell-count" aria-hidden="true">{events.length}</span>}
            </button>;
          })}
        </div>
      </div>
      <aside className="k-panel k-day-agenda" aria-label={`Задачи на ${dayLabel(selectedDay)}`}>
        <div className="k-panel-head"><div><span className="k-eyebrow">ВЫБРАННЫЙ ДЕНЬ</span><h2>{dayLabel(selectedDay)}</h2></div><span className="k-count">{selectedCards.length}</span></div>
        {selectedCards.length ? selectedCards.map(card => eventRow(card)) : <div className="k-empty k-empty-small"><CalendarDays size={28} /><h3>На этот день сроков нет</h3><p>Укажи срок в карточке задачи, и она появится здесь.</p></div>}
      </aside>
    </div> : <div className="k-panel k-agenda-list">
      <div className="k-panel-head"><div><h2>Все назначенные сроки</h2><p>По текущим фильтрам, от ранних к поздним</p></div><span className="k-count">{dated.length}</span></div>
      {dated.length ? dated.slice(0, agendaLimit).map(card => eventRow(card, true)) : <div className="k-empty"><CalendarDays size={30} /><h3>Сроки пока неизвестны</h3><p>Задачи без срока сохранены в списке ниже.</p></div>}
      {dated.length > agendaLimit && <button type="button" className="k-load-more" onClick={() => setAgendaLimit(value => value + 40)}>Показать ещё · осталось {dated.length - agendaLimit}</button>}
    </div>}
    <details className="k-panel k-undated">
      <summary><span><CalendarDays size={16} />Без известного срока</span><span className="k-count">{undated.length}</span></summary>
      <p className="k-section-note">Сроки не назначаются автоматически по дате создания или последнего действия.</p>
      {undated.slice(0, undatedLimit).map(card => <button type="button" key={card.id} className="k-undated-row" onClick={() => onOpen(card)}><span><small>{card.project?.trim() || 'неизвестно'}</small><strong>{card.title}</strong></span><ArrowUpRight size={15} /></button>)}
      {!undated.length && <p className="k-section-note">У всех задач по этим фильтрам указан срок.</p>}
      {undated.length > undatedLimit && <button type="button" className="k-load-more" onClick={() => setUndatedLimit(value => value + 24)}>Показать ещё · осталось {undated.length - undatedLimit}</button>}
    </details>
  </section>;
}
