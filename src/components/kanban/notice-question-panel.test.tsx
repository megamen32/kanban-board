import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { answerQuestionRequest, executorQuestionFeedback, ExecutorQuestionDetails, QuestionDetails } from './notice-question-display';
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

  it('renders the saved executor question with working choice controls and a read-only refresh', () => {
    const html = renderToStaticMarkup(React.createElement(ExecutorQuestionDetails, {
      text: 'Should I keep the existing page layout?',
      choices: [{ value: 'keep', label: 'Keep it' }, { value: 'change', label: 'Change it' }],
      waitingReason: 'Исполнитель ждёт ответа.',
      feedback: null,
      busy: false,
      canAnswer: true,
      readBusy: false,
      executionPhase: 'waiting',
      executionReceiptPresent: true,
      continuations: [],
      onAnswer: () => undefined,
      onRefreshRead: () => undefined,
    }));
    for (const expected of ['Should I keep the existing page layout?', 'Исполнитель ждёт ответа.', 'Keep it', 'Change it', 'Проверить состояние (только чтение)']) {
      expect(html).toContain(expected);
    }
    expect(html).not.toContain('disabled=""');
    expect(html).toContain('Состояние: ожидается ответ');
    expect(html).toContain('Квитанция запуска сохранена.');
  });

  it('keeps choices disabled after an unknown answer and shows continuation receipt separately', () => {
    const html = renderToStaticMarkup(React.createElement(ExecutorQuestionDetails, {
      text: 'Choose one',
      choices: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }],
      feedback: 'unknown',
      busy: false,
      canAnswer: false,
      readBusy: false,
      executionPhase: 'waiting',
      executionReceiptPresent: false,
      continuations: [{ phase: 'result', summary: 'A verified child turn result.', evidenceRefs: ['https://example.test/evidence'] }],
      continuation: { status: 'running', receipt: { phase: 'accepted' }, result: { summary: 'The executor resumed the task.' } },
      onAnswer: () => undefined,
      onRefreshRead: () => undefined,
    }));
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html).toContain('Исход ответа неизвестен. Повторно не отправляйте его');
    expect(html).toContain('Продолжение задачи: running');
    expect(html).toContain('Квитанция продолжения: accepted.');
    expect(html).toContain('Результат: The executor resumed the task.');
    expect(html).toContain('Результат: A verified child turn result.');
    expect(html).toContain('href="https://example.test/evidence"');
  });

  it('builds only the exact server-bound answer wire and classifies Notice receipts', () => {
    const request = answerQuestionRequest({ expectedVersion: 42, operationId: 'a'.repeat(64), value: 'option-b' });
    expect(request).toEqual({ action: 'answer-question', expectedVersion: 42, operationId: 'a'.repeat(64), value: 'option-b' });
    expect(Object.keys(request ?? {}).sort()).toEqual(['action', 'expectedVersion', 'operationId', 'value']);
    expect(answerQuestionRequest({ expectedVersion: 42.5, operationId: 'bad', value: 'option-b' })).toBeNull();
    expect(executorQuestionFeedback({ ...view, answerStatus: 'duplicate' })).toBe('accepted');
    expect(executorQuestionFeedback({ ...view, answerStatus: 'unknown', decision: null })).toBe('unknown');
    expect(executorQuestionFeedback({ ...view, answerStatus: 'control_requested', decision: null })).toBe('declined');
  });

});
