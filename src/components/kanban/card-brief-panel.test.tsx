import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { CardBriefPanel } from './card-brief-panel';

describe('CardBriefPanel', () => {
  test('renders current action fields and does not invent a deadline or next step', () => {
    const html = renderToStaticMarkup(<CardBriefPanel card={{
      id: 'synthetic-card', title: 'Сверить тестовый расчёт', description: '', assignees: ['Тестовый исполнитель'],
      assignee: undefined, dueAt: undefined, nextAction: null, column: 'todo',
    }} />);
    expect(html).toContain('Действие:');
    expect(html).toContain('Сверить тестовый расчёт');
    expect(html).toContain('Исполнитель:');
    expect(html).toContain('Тестовый исполнитель');
    expect(html).toContain('Срок:');
    expect(html).toContain('Не указан');
    expect(html).toContain('Следующий шаг:');
  });

  test('keeps the full long description out of the compact brief panel', () => {
    const html = renderToStaticMarkup(<CardBriefPanel compact card={{
      id: 'synthetic-card', title: 'Сверить тестовый расчёт', description: 'synthetic full description '.repeat(30),
      assignees: [], assignee: undefined, dueAt: undefined, nextAction: null, column: 'todo',
    }} />);
    expect(html).not.toContain('synthetic full description');
    expect(html).toContain('Действие:');
  });
});
