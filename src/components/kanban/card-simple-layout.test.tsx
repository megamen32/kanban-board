import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';
import { CardBriefPanel } from './card-brief-panel';

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children, className }: { children: React.ReactNode; className: string }) => <main className={className}>{children}</main>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h1>{children}</h1>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <footer>{children}</footer>,
}));
import { CardEditDialog } from './card-edit-dialog';
import type { KanbanCard } from '@/lib/kanban/types';

const source = readFileSync(new URL('./card-edit-dialog.tsx', import.meta.url), 'utf8');
const addSource = readFileSync(new URL('./add-card-dialog.tsx', import.meta.url), 'utf8');
const empty = { id: 'synthetic-empty', title: 'Проверить расчёт', description: '', assignees: [], dueAt: undefined, nextAction: null, column: 'todo' as const };

describe('simple card reading layout', () => {
  test('starts with the actual task title, not an edit-form label', () => {
    expect(source).toContain('<DialogTitle className="break-words text-lg leading-snug [overflow-wrap:anywhere] sm:text-xl">{title || card.title}</DialogTitle>');
    expect(source).not.toContain('<DialogTitle>Редактировать задачу</DialogTitle>');
  });
  test('shows the description without requiring an extra click', () => {
    expect(source).toContain('<details open className="min-w-0 rounded-xl border p-4">');
    expect(source.indexOf('Описание и ожидаемый результат')).toBeLessThan(source.indexOf('Изменить параметры'));
  });
  test('puts editable optional fields in a closed, scrollable disclosure', () => {
    expect(source.indexOf('min-h-0 min-w-0 flex-1 overflow-y-auto')).toBeLessThan(source.indexOf('Быстрые настройки задачи'));
    expect(source).toContain('Изменить параметры');
    expect(source.indexOf('Описание и ожидаемый результат')).toBeLessThan(source.indexOf('Жизненный цикл и результат'));
    expect(source).not.toContain('lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.45fr)]');
  });
  test('keeps technical links and the agent dashboard out of the initial reading path', () => {
    expect(source).toContain('Источники и технические данные');
    expect(source).not.toContain('className="rounded-md border p-3" open');
    expect(source).toContain('{showSummary && <CardBriefPanel summaryOnly autoSummarize');
  });
  test('does not advertise absent assignees or deadlines as repeated warnings', () => {
    const html = renderToStaticMarkup(<CardBriefPanel card={empty} />);
    expect(html).not.toContain('Исполнитель:');
    expect(html).not.toContain('Дедлайн:');
    expect(html).not.toContain('Не назначен');
    expect(html).not.toContain('Не указан');
  });
  test('still displays confirmed assignments, deadlines and next actions', () => {
    const html = renderToStaticMarkup(<CardBriefPanel card={{...empty, assignees:['test-person'], dueAt:'2026-12-01T12:00:00Z',nextAction:'Сверить итог'}} />);
    expect(html).toContain('test-person');
    expect(html).toContain('Дедлайн:');
    expect(html).toContain('Сверить итог');
  });
});

describe('rendered card contents', () => {
  const card = {...empty, description: 'Нужно сверить тестовый расчёт и сохранить итог.', project: 'Тестовый проект', priority:'medium', tags: [], version:1, owner:'test-owner', created:'2026-11-01T00:00:00Z', updated:'2026-11-01T00:00:00Z', fileName:'synthetic.md', order:0} as KanbanCard;
  test('renders the real description before the editable form without a summary service', () => {
    const html = renderToStaticMarkup(<CardEditDialog card={card} open onOpenChange={() => undefined} />);
    expect(html).toContain('<h1>Проверить расчёт</h1>');
    expect(html).toContain('Нужно сверить тестовый расчёт и сохранить итог.');
    expect(html.indexOf('Нужно сверить')).toBeLessThan(html.indexOf('Изменить параметры'));
    expect(html).toContain('<details open=""');
    expect(html).not.toContain('ИИ-сводка');
    expect(html).not.toContain('Жизненный цикл и результат');
    expect(html).not.toContain('Не назначен');
  });
  test('shows real people and deadlines in the header without opening settings', () => {
    const html = renderToStaticMarkup(<CardEditDialog card={{...card, assignees:['test-person'], dueAt:'2026-12-01T12:00:00Z'}} open onOpenChange={() => undefined} />);
    const header = html.slice(0, html.indexOf('</header>'));
    expect(header).toContain('Исполнитель: test-person');
    expect(header).toContain('Дедлайн:');
  });
  test('uses one clear language for deadline and planned start', () => {
    const html = renderToStaticMarkup(<CardEditDialog card={{...card,
      dueAt:'2026-12-01T12:00:00Z', scheduledAt:'2026-11-30T09:00:00Z'}} open onOpenChange={() => undefined} />);
    const header = html.slice(0, html.indexOf('</header>'));
    expect(header).toContain('Дедлайн:');
    expect(header).toContain('Когда начать:');
    expect(html).toContain('Когда начать (необязательно)');
    expect(html).toContain('План начала работы, не дедлайн.');
    expect(source).toContain('>Дополнительно</summary>');
    expect(source).not.toContain('Планировать на дату');
    expect(source).not.toContain('Планирование и дополнительные настройки');
    expect(addSource).toContain('>Дедлайн</label>');
    expect(addSource).toContain('Когда начать (необязательно)');
    expect(addSource).not.toContain('Планировать на дату');
  });

  test('preserves legacy single-assignee display without rewriting assignments', () => {
    const html = renderToStaticMarkup(<CardEditDialog card={{...card, assignees:[], assignee:'legacy-person'}} open onOpenChange={() => undefined} />);
    expect(html.slice(0, html.indexOf('</header>'))).toContain('Исполнитель: legacy-person');
  });
  test('preserves recorded blockers and the original description', () => {
    const html = renderToStaticMarkup(<CardEditDialog card={{...card, column:'blocked', blockerReason:'Ждём тестовый файл', nextAction:'Сверить итог'}} open onOpenChange={() => undefined} />);
    expect(html).toContain('Что мешает:');
    expect(html).toContain('Ждём тестовый файл');
    expect(html).toContain('Следующий шаг:');
    expect(html).toContain('Сверить итог');
    expect(html).toContain(card.description);
  });
});
