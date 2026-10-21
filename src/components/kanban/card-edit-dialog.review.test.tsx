import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReviewActionGate, type ReviewActionCard } from './review-action-gate';

const reviewCard: ReviewActionCard = {
  column: 'review', needsReview: true, requiresApprovalFrom: ['nikita'],
};
const actionButtons = React.createElement(React.Fragment, null,
  React.createElement('button', null, 'Принять результат'),
  React.createElement('button', null, 'Вернуть на доработку'),
);

function gateMarkup(verifiedUsername: string | null, card = reviewCard) {
  return renderToStaticMarkup(React.createElement(ReviewActionGate, { card, verifiedUsername }, actionButtons));
}

describe('CardEditDialog review-action gate', () => {
  it('hides both actions and gives a login hint when only the selected persona is known', () => {
    const html = gateMarkup(null);
    expect(html).not.toContain('Принять результат');
    expect(html).not.toContain('Вернуть на доработку');
    expect(html).toContain('Войдите под учёткой владельца задачи');
  });

  it('keeps both actions for the verified assigned reviewer and hides them for another user', () => {
    const assignedReviewer = gateMarkup('nikita');
    expect(assignedReviewer).toContain('Принять результат');
    expect(assignedReviewer).toContain('Вернуть на доработку');

    const otherVerifiedUser = gateMarkup('oleg');
    expect(otherVerifiedUser).not.toContain('Принять результат');
    expect(otherVerifiedUser).not.toContain('Вернуть на доработку');
    expect(otherVerifiedUser).toContain('назначенному проверяющему');
  });

  it('hides review actions after the card leaves review', () => {
    expect(gateMarkup('nikita', { ...reviewCard, column: 'done' })).toBe('');
    expect(gateMarkup('nikita', { ...reviewCard, needsReview: false })).toBe('');
  });
});
