import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { QuestionDetails } from './notice-question-display';
import type { TaskQuestionView } from './notice-question-model';

const view: TaskQuestionView = {
  requestId: 'opaque-private-request-id',
  purpose: 'clarification',
  version: 9,
  state: 'pending',
  question: { text: 'Which option should I use?', choices: [{ value: 'a', label: 'Option A' }, { value: 'b', label: 'Option B' }], expiresAt: null },
  notification: { attemptState: 'sent', delivered: true, deadlineAt: 1_900_000_000 },
  decision: { source: 'human', value: 'b', decidedAt: 1_899_999_000 },
};

describe('Notice question panel', () => {
  it('renders only the verified question, delivery, deadline and human decision projection', () => {
    const html = renderToStaticMarkup(React.createElement(QuestionDetails, { view }));
    for (const expected of ['Связанный вопрос', 'Which option should I use?', 'Option A', 'отправка подтверждена', 'Срок ответа после подтверждённой отправки', 'Ответ человека', 'Option B']) {
      expect(html).toContain(expected);
    }
    expect(html).not.toContain(view.requestId);
    expect(html).toContain('Команды паузы/остановки и подтверждение управления здесь недоступны.');
  });

  it('labels timeout as a Notice result without claiming it stopped or resumed the task', () => {
    const timeoutView = { ...view, decision: { source: 'timeout' as const, value: 'a', decidedAt: null } };
    const html = renderToStaticMarkup(React.createElement(QuestionDetails, { view: timeoutView }));
    expect(html).toContain('Итог по таймауту');
    expect(html).toContain('Option A');
    expect(html).toContain('не останавливает и не возобновляет задачу');
  });

});
