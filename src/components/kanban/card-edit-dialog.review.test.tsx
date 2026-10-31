import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { canCompleteDirectly, canTakeOwnReview } from './card-completion';
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

describe('owner-scoped manual completion', () => {
  const own = { owner: 'nikita', assignee: 'Никита Розанов', assignees: ['Никита Розанов'] };
  const other = { owner: 'Дмитрий', assignee: 'Дмитрий', assignees: ['Дмитрий'] };
  it('shows completion to the verified owner or assigned performer of ordinary tasks', () => {
    expect(canCompleteDirectly({ ...own, column: 'inbox', needsReview: false }, 'nikita')).toBe(true);
    expect(canCompleteDirectly({ ...own, column: 'todo', needsReview: false }, 'nikita')).toBe(true);
    expect(canCompleteDirectly({ ...own, column: 'in-progress', needsReview: false }, 'roomhacker')).toBe(true);
    expect(canCompleteDirectly({ ...other, column: 'todo', needsReview: false }, 'Дмитрий')).toBe(true);
  });
  it('does not offer completion of someone else’s tasks or to unverified accounts', () => {
    expect(canCompleteDirectly({ ...other, column: 'todo', needsReview: false }, 'nikita')).toBe(false);
    expect(canCompleteDirectly({ ...other, column: 'in-progress', needsReview: false }, null)).toBe(false);
    expect(canCompleteDirectly({ ...own, column: 'todo', needsReview: false }, 'dmitry')).toBe(false);
  });
  it('keeps review and completed tasks in their dedicated workflows', () => {
    expect(canCompleteDirectly({ ...own, column: 'review', needsReview: true }, 'nikita')).toBe(false);
    expect(canCompleteDirectly({ ...own, column: 'in-progress', needsReview: true }, 'nikita')).toBe(false);
    expect(canCompleteDirectly({ ...own, column: 'done', needsReview: false }, 'nikita')).toBe(false);
    expect(canCompleteDirectly({ ...own, column: 'archived', needsReview: false }, 'nikita')).toBe(false);
  });
  it('offers to take review only to its actual owner and never to the supervisor of other tasks', () => {
    const pending = { column: 'review' as const, needsReview: true, owner: 'nikita', requiresApprovalFrom: ['oleg'] };
    expect(canTakeOwnReview(pending, 'nikita')).toBe(true);
    expect(canTakeOwnReview(pending, 'oleg')).toBe(false);
    expect(canTakeOwnReview({ ...pending, owner: 'Дмитрий' }, 'nikita')).toBe(false);
    expect(canTakeOwnReview({ ...pending, requiresApprovalFrom: ['nikita'] }, 'nikita')).toBe(false);
  });
});
