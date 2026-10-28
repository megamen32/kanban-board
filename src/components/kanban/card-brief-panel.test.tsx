import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { CardBriefPanel } from './card-brief-panel';

describe('CardBriefPanel', () => {
  test('renders current action fields and does not invent a deadline or missing next step', () => {
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
    expect(html).not.toContain('Следующий шаг:');
  });

  test('renders a next step only when it exists as a structured card field', () => {
    const html = renderToStaticMarkup(<CardBriefPanel card={{
      id: 'synthetic-card', title: 'Сверить тестовый расчёт', description: 'В тексте есть пожелание продолжить проверку.',
      assignees: [], assignee: undefined, dueAt: undefined, nextAction: 'Проверить файл', column: 'todo',
    }} />);
    expect(html).toContain('Следующий шаг:');
    expect(html).toContain('Проверить файл');
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
