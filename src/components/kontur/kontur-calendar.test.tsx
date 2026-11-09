import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KanbanCard } from '@/lib/kanban/types';
import { KonturCalendar } from './kontur-calendar';

const NOW = new Date('2026-11-07T12:00:00Z');
function card(id: string, values: Partial<KanbanCard> = {}): KanbanCard {
  return {
    id, title: `Синтетическая задача ${id}`, description: '', column: 'todo', priority: 'medium',
    tags: [], order: 0, created: '2026-11-07T10:00:00Z', updated: '2026-11-07T11:00:00Z',
    fileName: `${id}.md`, version: 1, project: 'Тестовый проект', assignees: [], ...values,
  };
}
const render = (cards: KanbanCard[]) => renderToStaticMarkup(React.createElement(KonturCalendar, { cards, onOpen: () => undefined }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubGlobal('React', React);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('calendar actionable empty states', () => {
  it('renders an open undated queue before the empty grid and preserves pagination', () => {
    const html = render(Array.from({ length: 70 }, (_, index) => card(String(index), { week: '2026-W45' })));
    expect(html).toContain('Точные даты пока неизвестны');
    expect(html).toContain('Неделя 2026-W45 · день неизвестен');
    expect(html).toContain('aria-label="Задать дату: Синтетическая задача 0"');
    expect(html).toContain('Показать ещё без даты · осталось 58');
    expect(html.match(/class="k-undated-row"/g)).toHaveLength(12);
    expect(html.indexOf('id="calendar-undated"')).toBeLessThan(html.indexOf('class="k-calendar-grid"'));
    expect(html).not.toContain('<details');
    expect(html).not.toContain('class="k-cell-count"');
  });

  it('labels a real plan and deadline separately while counting the task only once', () => {
    const html = render([card('both', { scheduledAt: '2026-11-07T13:00:00Z', dueAt: '2026-11-07T15:00:00Z' })]);
    expect(html).toContain('data-kind="plan">Когда заняться');
    expect(html).toContain('data-kind="deadline">Готово до');
    expect(html).toContain('С датами: <strong>1</strong> · всего задач: 1');
    expect(html).toContain('Задач: 1. Дат: 2');
    expect(html).toContain('Задач: 1 · дат: 2');
    expect(html).toContain('16:00');
    expect(html).toContain('18:00');
  });

  it('initially shows a future plan in the current month when today has no dates', () => {
    const html = render([card('future-plan', { scheduledAt: '2026-11-12T09:00:00+03:00' })]);
    expect(html).toContain('class="k-calendar-event"');
    expect(html).toContain('aria-label="Открыть задачу: Синтетическая задача future-plan. Когда заняться:');
    expect(html).toContain('aria-label="Задачи на четверг, 12 ноября"');
    expect(html).not.toContain('На этот день дат нет');
  });

  it('keeps overdue tasks from another year visible above an empty current month', () => {
    const html = render([card('past', { dueAt: '2025-01-01' }), card('done', { column: 'done', dueAt: '2025-01-01' })]);
    expect(html).toContain('Незавершённые задачи с прошедшей датой готовности');
    expect(html).toContain('Открыть задачу: Синтетическая задача past');
    expect(html).toContain('Просрочено · 1');
    expect(html).toContain('К последней дате');
    expect(html.indexOf('id="calendar-overdue"')).toBeLessThan(html.indexOf('class="k-calendar-grid"'));
    expect(html).not.toContain('2025 г., 03:00');
  });

  it('exposes invalid date warnings without dropping the task or moving it to a fabricated day', () => {
    const html = render([card('invalid', { dueAt: '2026-02-30' }), card('mixed', { dueAt: 'not-a-date', scheduledAt: '2026-11-07T16:00:00Z' })]);
    expect(html).toContain('Задач с нераспознанной датой: 2');
    expect(html).toContain('Задать дату: Синтетическая задача invalid');
    expect(html).toContain('Готово до: неизвестно');
    expect(html).toContain('Открыть задачу: Синтетическая задача mixed. Когда заняться:');
    expect(html).not.toContain('not-a-date');
    expect(html).toContain('С датами: <strong>1</strong> · всего задач: 2');
  });

  it('keeps Keeper scope explicit and does not invent an external calendar connection', () => {
    const html = render([card('no-date')]);
    expect(html).toContain('события из Keeper сюда автоматически не загружаются');
    expect(html).toContain('Москва, UTC+3');
    expect(html).not.toContain('href=');
    expect(html).not.toContain('Синхронизировано');
  });

  it('represents an empty filtered board without synthetic task entries', () => {
    const html = render([]);
    expect(html).toContain('По текущим фильтрам задач нет');
    expect(html).toContain('С датами: <strong>0</strong> · всего задач: 0');
    expect(html).not.toContain('class="k-undated-row"');
    expect(html).not.toContain('class="k-calendar-event');
  });
});
