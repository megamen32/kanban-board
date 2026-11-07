'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, Clock3, List } from 'lucide-react';
import type { KanbanCard } from '@/lib/kanban/types';
import {
  buildCalendarModel, calendarDayLabel, calendarEntryIsPast, calendarMonth,
  calendarMonthCells, calendarMonthLabel, calendarTime, calendarWeekLabel,
  formatStamp, isCalendarCardClosed, moscowDay, shiftCalendarMonth,
  type CalendarEntry, type CalendarKind,
} from './kontur-calendar-model';

export { formatStamp, moscowDay } from './kontur-calendar-model';

const kindLabel = (kind: CalendarKind) => kind === 'deadline' ? 'Срок' : 'План';

function DateIssue({ fields }: { fields: CalendarKind[] | undefined }) {
  return fields?.length ? <small className="k-calendar-invalid">
    {fields.map(field => `${kindLabel(field)}: неизвестно`).join(' · ')}. Проверь дату в карточке.
  </small> : null;
}

export function KonturCalendar({ cards, onOpen }: { cards: KanbanCard[]; onOpen: (card: KanbanCard) => void }) {
  const [clock, setClock] = useState(() => new Date());
  const today = moscowDay(clock)!;
  const [month, setMonth] = useState(() => calendarMonth(today));
  const [selectedDay, setSelectedDay] = useState(() => {
    const initial = buildCalendarModel(cards, clock);
    const inMonth = (entry: CalendarEntry) => calendarMonth(entry.day) === calendarMonth(today);
    const open = [...initial.upcoming, ...initial.past].find(entry => inMonth(entry) && !isCalendarCardClosed(entry.card));
    return initial.byDay.has(today) ? today : open?.day ?? initial.entries.find(inMonth)?.day ?? today;
  });
  const [mode, setMode] = useState<'month' | 'agenda'>('month');
  const [upcomingLimit, setUpcomingLimit] = useState(40);
  const [pastLimit, setPastLimit] = useState(40);
  const [undatedLimit, setUndatedLimit] = useState(12);
  const [overdueLimit, setOverdueLimit] = useState(12);

  useEffect(() => {
    const interval = window.setInterval(() => setClock(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const model = useMemo(() => buildCalendarModel(cards, clock), [cards, clock]);
  const cells = useMemo(() => calendarMonthCells(month), [month]);
  const selectedEntries = model.byDay.get(selectedDay) ?? [];
  const selectedTaskCount = new Set(selectedEntries.map(entry => entry.card.id)).size;
  const monthEntryCount = model.entries.filter(entry => entry.day.slice(0, 7) === month.slice(0, 7)).length;
  const nearest = model.nearest;
  const attentionFirst = mode === 'month' ? monthEntryCount === 0 : model.entries.length === 0;

  const selectDay = (day: string) => { setMonth(calendarMonth(day)); setSelectedDay(day); };
  const changeMonth = (delta: number) => {
    const nextMonth = shiftCalendarMonth(month, delta);
    const firstEntry = model.entries.find(entry => entry.day.slice(0, 7) === nextMonth.slice(0, 7));
    setMonth(nextMonth);
    setSelectedDay(firstEntry?.day ?? nextMonth);
  };
  const focusQueue = (id: string) => {
    const section = document.getElementById(id);
    section?.scrollIntoView({ block: 'start' });
    section?.focus({ preventScroll: true });
  };

  const eventRow = (entry: CalendarEntry, includeDate = false) => {
    const card = entry.card;
    const closed = isCalendarCardClosed(card);
    const overdue = entry.kind === 'deadline' && !closed && calendarEntryIsPast(entry, clock);
    return <button type="button" className={`k-calendar-event${closed ? ' is-closed' : ''}`} key={entry.id}
      onClick={() => onOpen(card)} aria-label={`Открыть задачу: ${card.title}. ${kindLabel(entry.kind)}: ${formatStamp(entry.value)}`}>
      <span className={`k-event-line k-priority-line-${card.priority}`} aria-hidden="true" />
      <span className="k-event-copy">
        <small>{card.project?.trim() || 'неизвестно'}</small><strong>{card.title}</strong>
        <span><span className="k-calendar-kind" data-kind={entry.kind}>{kindLabel(entry.kind)}</span><Clock3 size={12} aria-hidden="true" />
          {includeDate ? formatStamp(entry.value) : calendarTime(entry)}
          {closed ? ' · закрыто' : overdue ? ' · просрочено' : entry.kind === 'plan' && calendarEntryIsPast(entry, clock) ? ' · прошедший план' : ''}
        </span>
        <DateIssue fields={model.issueByCard.get(card.id)} />
      </span>
      <ArrowUpRight size={15} aria-hidden="true" />
    </button>;
  };

  const attention = <div className="k-calendar-attention">
    {model.overdue.length > 0 && <section id="calendar-overdue" className="k-panel" tabIndex={-1} aria-labelledby="calendar-overdue-title">
      <div className="k-panel-head"><div><h2 id="calendar-overdue-title">Просрочено</h2><p>Незавершённые задачи с истёкшим сроком</p></div><span className="k-count">{model.overdue.length}</span></div>
      {model.overdue.slice(0, overdueLimit).map(entry => eventRow(entry, true))}
      {model.overdue.length > overdueLimit && <button type="button" className="k-load-more" onClick={() => setOverdueLimit(value => value + 24)}>Показать ещё просроченные · осталось {model.overdue.length - overdueLimit}</button>}
    </section>}
    <section id="calendar-undated" className="k-panel k-undated" tabIndex={-1} aria-labelledby="calendar-undated-title">
      <div className="k-panel-head"><div><h2 id="calendar-undated-title">Без даты</h2><p>Срок и время выполнения неизвестны</p></div><span className="k-count">{model.undated.length}</span></div>
      <p className="k-section-note">Открой задачу, чтобы задать срок или план выполнения. Дата создания и номер недели не заменяют выбранный день.</p>
      {model.undated.slice(0, undatedLimit).map(card => {
        const week = calendarWeekLabel(card.week);
        return <button type="button" key={card.id} className="k-undated-row" onClick={() => onOpen(card)} aria-label={`Задать дату: ${card.title}`}>
          <span><small>{card.project?.trim() || 'неизвестно'}</small><strong>{card.title}</strong>
            {week && <small>{week}</small>}
            <small>{isCalendarCardClosed(card) ? 'Закрыто · открыть карточку' : 'Задать дату в карточке'}</small>
            <DateIssue fields={model.issueByCard.get(card.id)} />
          </span><ArrowUpRight size={15} aria-hidden="true" />
        </button>;
      })}
      {!model.undated.length && <p className="k-section-note">{cards.length ? 'У всех задач по этим фильтрам есть срок или план выполнения.' : 'По текущим фильтрам задач нет.'}</p>}
      {model.undated.length > undatedLimit && <button type="button" className="k-load-more" onClick={() => setUndatedLimit(value => value + 24)}>Показать ещё без даты · осталось {model.undated.length - undatedLimit}</button>}
    </section>
  </div>;

  return <section className="k-calendar" aria-label="Календарь задач">
    <div className="k-section-toolbar">
      <div className="k-calendar-navigation">
        <button type="button" className="k-icon-button" onClick={() => changeMonth(-1)} aria-label="Предыдущий месяц"><ChevronLeft size={18} /></button>
        <h2 aria-live="polite">{calendarMonthLabel(month)}</h2>
        <button type="button" className="k-icon-button" onClick={() => changeMonth(1)} aria-label="Следующий месяц"><ChevronRight size={18} /></button>
        <button type="button" className="k-button k-button-small" onClick={() => selectDay(today)}>Сегодня</button>
      </div>
      <div className="k-segmented" aria-label="Вид календаря">
        <button type="button" aria-pressed={mode === 'month'} onClick={() => setMode('month')}><CalendarDays size={15} />Месяц</button>
        <button type="button" aria-pressed={mode === 'agenda'} onClick={() => setMode('agenda')}><List size={15} />Расписание</button>
      </div>
    </div>
    <div className="k-notice"><Clock3 size={16} /><p>Сроки и планы из карточек · Москва, UTC+3. Связь с Keeper настраивается в карточке; события из Keeper сюда автоматически не загружаются.</p></div>
    <div className="k-calendar-context" aria-label="Состояние календаря">
      <span>С датами: <strong>{model.datedCardCount}</strong> · всего задач: {cards.length}</span>
      <button type="button" className="k-button k-button-small" disabled={!model.undated.length} onClick={() => focusQueue('calendar-undated')}>Без даты · {model.undated.length}</button>
      <button type="button" className="k-button k-button-small" disabled={!model.overdue.length} onClick={() => focusQueue('calendar-overdue')}>Просрочено · {model.overdue.length}</button>
      {nearest && <button type="button" className="k-button k-button-small" onClick={() => { selectDay(nearest.day); setMode('month'); }}>
        {calendarEntryIsPast(nearest, clock) ? 'К последней дате' : 'К ближайшей дате'} · {formatStamp(nearest.value, true)}<ArrowUpRight size={14} aria-hidden="true" />
      </button>}
    </div>
    {model.invalidDates.length > 0 && <div className="k-notice k-calendar-invalid" role="status"><AlertTriangle size={16} /><p>Задач с нераспознанной датой: {model.invalidDates.length}. Такие даты отмечены как «неизвестно». Задачи сохранены; открой карточку, чтобы проверить дату.</p></div>}
    {mode === 'month' && monthEntryCount === 0 && <p className="k-section-note" role="status">
      {model.entries.length ? 'В выбранном месяце дат нет. Просроченные задачи и очередь без даты остаются доступны ниже.' : cards.length ? 'Точные даты пока неизвестны. Задачи доступны в открытой очереди «Без даты».' : 'По текущим фильтрам задач нет.'}
    </p>}
    {attentionFirst && attention}
    {mode === 'month' ? <div className="k-calendar-layout">
      <div className="k-panel k-calendar-month">
        <div className="k-weekdays" aria-hidden="true">{['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'].map(day => <span key={day}>{day}</span>)}</div>
        <div className="k-calendar-grid">
          {cells.map(day => {
            const entries = model.byDay.get(day) ?? [];
            const taskCount = new Set(entries.map(entry => entry.card.id)).size;
            const outside = day.slice(0, 7) !== month.slice(0, 7);
            return <button type="button" key={day} className={`k-calendar-cell${outside ? ' is-outside' : ''}${day === today ? ' is-today' : ''}${day === selectedDay ? ' is-selected' : ''}`}
              onClick={() => selectDay(day)} aria-pressed={day === selectedDay} aria-current={day === today ? 'date' : undefined}
              aria-label={`${calendarDayLabel(day)}. Задач: ${taskCount}. Дат: ${entries.length}`}>
              <span className="k-cell-day">{Number(day.slice(8))}</span>
              <span className="k-cell-events" aria-hidden="true">{entries.slice(0, 2).map(entry => <span key={entry.id} className={isCalendarCardClosed(entry.card) ? 'is-closed' : ''}>
                <span className="k-calendar-kind" data-kind={entry.kind}>{kindLabel(entry.kind)}</span> {entry.card.title}
              </span>)}{entries.length > 2 && <small>ещё: {entries.length - 2}</small>}</span>
              {taskCount > 0 && <span className="k-cell-count" aria-hidden="true">{taskCount}</span>}
            </button>;
          })}
        </div>
      </div>
      <aside className="k-panel k-day-agenda" aria-label={`Задачи на ${calendarDayLabel(selectedDay)}`}>
        <div className="k-panel-head"><div><span className="k-eyebrow">ВЫБРАННЫЙ ДЕНЬ</span><h2>{calendarDayLabel(selectedDay)}</h2><p>Задач: {selectedTaskCount} · дат: {selectedEntries.length}</p></div></div>
        {selectedEntries.length ? selectedEntries.map(entry => eventRow(entry)) : <div className="k-empty k-empty-small"><CalendarDays size={28} /><h3>На этот день дат нет</h3><p>Срок и план выполнения можно задать в карточке. Недатированные задачи остаются в открытой очереди.</p></div>}
      </aside>
    </div> : <div className="k-panel k-agenda-list">
      <div className="k-panel-head"><div><h2>Предстоящие даты</h2><p>Сроки и планы по текущим фильтрам, по Москве</p></div><span className="k-count">{model.upcoming.length}</span></div>
      {model.upcoming.length ? model.upcoming.slice(0, upcomingLimit).map(entry => eventRow(entry, true)) : <p className="k-section-note">Предстоящие даты неизвестны. Прошедшие даты и задачи без даты сохранены ниже.</p>}
      {model.upcoming.length > upcomingLimit && <button type="button" className="k-load-more" onClick={() => setUpcomingLimit(value => value + 40)}>Показать ещё предстоящие · осталось {model.upcoming.length - upcomingLimit}</button>}
      <div className="k-panel-head"><div><h2>Прошедшие даты</h2><p>От недавних к ранним. Прошедший план не означает завершение задачи.</p></div><span className="k-count">{model.past.length}</span></div>
      {model.past.length ? model.past.slice(0, pastLimit).map(entry => eventRow(entry, true)) : <p className="k-section-note">Прошедших дат по этим фильтрам нет.</p>}
      {model.past.length > pastLimit && <button type="button" className="k-load-more" onClick={() => setPastLimit(value => value + 40)}>Показать ещё прошедшие · осталось {model.past.length - pastLimit}</button>}
    </div>}
    {!attentionFirst && attention}
  </section>;
}
