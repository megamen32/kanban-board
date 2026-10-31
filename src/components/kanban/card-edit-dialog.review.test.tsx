import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { canCompleteDirectly } from './card-completion';
import { CardResultPreview } from './card-result-preview';
import { ReviewActionGate, type ReviewActionCard } from './review-action-gate';

const malformed: ReviewActionCard = { column: 'in-progress', needsReview: true, requiresApprovalFrom: [], resultHistory: [] };
const actions = React.createElement(React.Fragment, null,
  React.createElement('button', null, 'Принять результат'),
  React.createElement('button', null, 'Вернуть на доработку'),
);

describe('malformed review gate recovery affordance', () => {
  it('shows an owner-only recovery action for the malformed empty-reviewer gate', () => {
    expect(renderToStaticMarkup(React.createElement(ReviewActionGate, { card: malformed, verifiedUsername: 'nikita' }, actions))).toContain('Вернуть на доработку');
  });

  it('does not show recovery to Oleg, anonymous users, normal review cards, or cards with results', () => {
    expect(renderToStaticMarkup(React.createElement(ReviewActionGate, { card: malformed, verifiedUsername: 'oleg' }, actions))).toContain('Решение доступно только назначенному');
    expect(renderToStaticMarkup(React.createElement(ReviewActionGate, { card: malformed, verifiedUsername: null }, actions))).toContain('Войдите');
    expect(renderToStaticMarkup(React.createElement(ReviewActionGate, { card: { ...malformed, resultHistory: [{ summary: 'result' }] }, verifiedUsername: 'nikita' }, actions))).toBe('');
    expect(renderToStaticMarkup(React.createElement(ReviewActionGate, { card: { column: 'review', needsReview: true, requiresApprovalFrom: ['nikita'] }, verifiedUsername: 'nikita' }, actions))).toContain('Принять результат');
  });
});

describe('card result review preview', () => {
  it('renders the latest executor result where the reviewer can read it before deciding', () => {
    const html = renderToStaticMarkup(React.createElement(CardResultPreview, {
      result: {
        summary: '## Итого: 2500\n\nНужен **тестовый файл** и проверка тестовым участником.',
        submittedBy: 'testlogin', submittedAt: '2026-10-28T00:00:00.000Z',
      },
    }));

    expect(html).toContain('Результат для проверки');
    expect(html).toContain('<h2');
    expect(html).toContain('<strong');
    expect(html).toContain('тестовый файл');
    expect(html).toContain('testlogin');
  });
});

describe('direct completion of ordinary tasks', () => {
  it('allows a regular inbox or personal task to be completed', () => {
    expect(canCompleteDirectly({ column: 'inbox', needsReview: false })).toBe(true);
    expect(canCompleteDirectly({ column: 'todo', needsReview: false })).toBe(true);
    expect(canCompleteDirectly({ column: 'blocked', needsReview: false })).toBe(true);
  });
  it('keeps existing review and completed tasks in their dedicated workflows', () => {
    expect(canCompleteDirectly({ column: 'review', needsReview: true })).toBe(false);
    expect(canCompleteDirectly({ column: 'in-progress', needsReview: true })).toBe(false);
    expect(canCompleteDirectly({ column: 'done', needsReview: false })).toBe(false);
    expect(canCompleteDirectly({ column: 'archived', needsReview: false })).toBe(false);
  });
});
