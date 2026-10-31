import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { KanbanCard, TaskExecutionReceipt } from '../../lib/kanban/types';
import { BoardQuestionPanel } from './board-question-panel';
import { shouldRefreshExecutionCard, usesLegacyNoticeQuestion } from './card-question-visibility';

vi.mock('../ui/button', () => ({
  Button: ({ children, ...props }: React.PropsWithChildren<React.ButtonHTMLAttributes<HTMLButtonElement>>) =>
    React.createElement('button', props, children),
}));

const card = (): KanbanCard => ({
  id: 'synthetic-question-card', title: 'QA task', project: 'QA',
  owner: 'testlogin', description: '', column: 'in-progress', priority: 'medium',
  tags: [], order: 0, fileName: 'qa.md', version: 1, assignees: [],
  created: '2026-10-31T00:00:00Z', updated: '2026-10-31T00:00:00Z',
});
const attempt = (fields: Partial<TaskExecutionReceipt> = {}): TaskExecutionReceipt => ({
  operationId: 'op-qa', requestHash: 'hash', lastBoardVersion: 1,
  createInputId: 'create', messageInputId: 'msg', phase: 'running',
  hostId: 'qa', harness: 'opencode', nativeSessionId: 'ses-qa',
  startedBy: 'testlogin', createdAt: '2026-10-31T00:00:00Z',
  updatedAt: '2026-10-31T00:00:00Z', ...fields,
});

describe('questions in an ordinary Todo card', () => {
  it('shows a direct question and its choices without legacy Notice controls', () => {
    const input: KanbanCard = {
      ...card(), taskExecutionHistory: [attempt({ executorKeyHash: 'hash-of-executor-key' })],
      pendingQuestion: {
        id: 'question-qa', text: 'Сколько деталей добавить?',
        choices: [{ value: 'a', label: 'Коротко' }, { value: 'b', label: 'Подробно' }],
        attemptOperationId: 'op-qa', askedAt: '2026-10-31T00:00:00Z',
      },
    };
    expect(usesLegacyNoticeQuestion(input)).toBe(false);
    expect(shouldRefreshExecutionCard(input)).toBe(true);
    const html = renderToStaticMarkup(<BoardQuestionPanel card={input} onAnswered={() => {}} />);
    expect(html).toContain('Вопрос исполнителя');
    expect(html).toContain('Сколько деталей добавить?');
    expect(html).toContain('Коротко');
    expect(html).toContain('Подробно');
    const answered: KanbanCard = {
      ...input, pendingQuestion: {
        ...input.pendingQuestion!, answer: { value: 'b', label: 'Подробно', answeredAt: '2026-10-31T00:01:00Z', by: 'testlogin' },
        deliveredAt: '2026-10-31T00:02:00Z',
      },
    };
    expect(renderToStaticMarkup(<BoardQuestionPanel card={answered} onAnswered={() => {}} />))
      .toContain('доставлен исполнителю');
    expect(usesLegacyNoticeQuestion(answered)).toBe(false);
  });

  it('leaves Notice available for old sessions and never shows it for new sessions without questions', () => {
    const old = { ...card(), taskExecutionHistory: [attempt()] };
    const newer = { ...card(), taskExecutionHistory: [attempt({ executorKeyHash: 'sha' })] };
    expect(usesLegacyNoticeQuestion(old)).toBe(true);
    expect(usesLegacyNoticeQuestion(newer)).toBe(false);
    expect(shouldRefreshExecutionCard(old)).toBe(true);
    expect(shouldRefreshExecutionCard(newer)).toBe(true);
    expect(shouldRefreshExecutionCard({ ...newer, taskExecutionHistory: [attempt({ executorKeyHash: 'sha', phase: 'result' })] }))
      .toBe(false);
    expect(shouldRefreshExecutionCard(card())).toBe(false);
  });
});
