import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
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
