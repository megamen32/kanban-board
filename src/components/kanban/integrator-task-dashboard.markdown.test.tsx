import React from 'react';
import { createHash } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { KanbanCard, TaskExecutionReceipt } from '@/lib/kanban/types';

vi.stubGlobal('React', React);
// @ts-expect-error Vitest's runtime accepts virtual mocks; the installed type omits this option.
vi.mock('@/components/ui/button', () => ({ Button: ({ children, disabled, title }: { children: React.ReactNode; disabled?: boolean; title?: string }) => React.createElement('button', { disabled, title }, children) }), { virtual: true });
// @ts-expect-error Vitest's runtime accepts virtual mocks; the installed type omits this option.
vi.mock('@/components/ui/input', () => ({ Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => React.createElement('input', props) }), { virtual: true });
vi.mock('@/lib/kanban/types', () => ({
  DEFAULT_COLUMNS: [{ id: 'todo', title: 'К выполнению' }],
// @ts-expect-error Vitest's runtime accepts virtual mocks; the installed type omits this option.
}), { virtual: true });
import {
  canOfferTaskStartRetry,
  classifyTaskStartFailure,
  IntegratorTaskDashboard,
  recoverableNoTurnOperationId,
} from './integrator-task-dashboard';

const card: KanbanCard = {
  id: 'markdown-qa', title: 'Markdown QA', description: '## Blocker\n\n- First item\n- Second item',
  column: 'todo', priority: 'medium', tags: [], order: 0,
  created: '2026-10-26T00:00:00.000Z', updated: '2026-10-26T00:00:00.000Z',
  fileName: 'markdown-qa.md', version: 1, project: 'UX QA', assignees: [], owner: 'qa', shared: false,
};

describe('integrator task dashboard card brief', () => {
  it('keeps generic failures unknown and only authorizes retry for a typed not-attempted response', () => {
    const operationId = '3a22d578-7b78-4834-b718-097685c5f0ae';
    const generic = classifyTaskStartFailure(400, {
      error: 'task execution request could not be processed safely',
    }, operationId);
    expect(generic).toEqual({
      kind: 'unknown',
      operation: { operationId, status: 'unknown' },
      retryable: false,
      message: 'Исход запуска не подтверждён. Ключ сохранён; безопасный повтор не разрешён.',
    });
    const ready = { cardId: 'task-1', state: 'not-started' as const, startAvailable: true };
    expect(canOfferTaskStartRetry(generic?.operation, ready, undefined)).toBe(false);

    const notAttempted = classifyTaskStartFailure(400, { state: 'not_attempted', retryable: true }, operationId);
    expect(notAttempted).toEqual({
      kind: 'not_attempted',
      operation: { operationId, status: 'unknown' },
      retryable: true,
      message: 'Запуск не отправлен. Ключ сохранён; повторить тем же ключом можно после подтверждения готовности сервера.',
    });
    expect(canOfferTaskStartRetry(notAttempted?.operation, ready, operationId)).toBe(true);
    expect(canOfferTaskStartRetry(notAttempted?.operation, ready, 'another-operation-id')).toBe(false);
    expect(classifyTaskStartFailure(500, { state: 'not_attempted', retryable: true }, operationId)).toBeNull();
    expect(classifyTaskStartFailure(400, { state: 'not_attempted', retryable: false }, operationId)).toBeNull();
  });

  it('offers no-turn recovery only for the exact non-retryable not-attempted dispatch receipt', async () => {
    const cardId = 'recoverable-qa';
    const operationId = '3a22d578-7b78-4834-b718-097685c5f0ae';
    const receipt: TaskExecutionReceipt = {
      operationId: createHash('sha256').update(`${cardId}\0${operationId}`).digest('hex'),
      requestHash: 'a'.repeat(64), lastBoardVersion: 7,
      createInputId: 'b'.repeat(64), messageInputId: 'c'.repeat(64),
      phase: 'dispatch-unknown', hostId: 'roomhacker-server-100', harness: 'opencode', nativeSessionId: 'qa-session',
      dispatchReceiptText: JSON.stringify({ delivery: 'not_attempted', nonRetryable: true, inputId: 'c'.repeat(64) }),
      startedBy: 'testlogin', createdAt: '2026-10-27T00:00:00.000Z', updatedAt: '2026-10-27T00:00:00.000Z',
    };
    const stored = JSON.stringify({ operationId, status: 'unknown' });

    await expect(recoverableNoTurnOperationId(cardId, 7, receipt, stored)).resolves.toBe(operationId);
    await expect(recoverableNoTurnOperationId(cardId, 7, receipt, stored, operationId)).resolves.toBeNull();
    await expect(recoverableNoTurnOperationId(cardId, 8, receipt, stored)).resolves.toBeNull();
    await expect(recoverableNoTurnOperationId(cardId, 7, { ...receipt, nativeTurnId: 'turn-1' }, stored)).resolves.toBeNull();
    await expect(recoverableNoTurnOperationId(cardId, 7, { ...receipt, phase: 'stopped' }, stored)).resolves.toBeNull();
    await expect(recoverableNoTurnOperationId(cardId, 7, { ...receipt,
      dispatchReceiptText: JSON.stringify({ delivery: 'accepted', nonRetryable: true, inputId: receipt.messageInputId }),
    }, stored)).resolves.toBeNull();
    await expect(recoverableNoTurnOperationId(cardId, 7, { ...receipt,
      dispatchReceiptText: JSON.stringify({ delivery: 'unknown', nonRetryable: true, inputId: receipt.messageInputId }),
    }, stored)).resolves.toBeNull();
    await expect(recoverableNoTurnOperationId(cardId, 7, { ...receipt,
      dispatchReceiptText: JSON.stringify({ delivery: 'not_attempted', nonRetryable: true, inputId: 'd'.repeat(64) }),
    }, stored)).resolves.toBeNull();
    await expect(recoverableNoTurnOperationId(cardId, 7, { ...receipt,
      dispatchReceiptText: 'owner MCP dispatch outcome unknown; never replay this operation',
    }, stored)).resolves.toBeNull();
    await expect(recoverableNoTurnOperationId(cardId, 7, receipt, JSON.stringify({ operationId: 'another-operation-id', status: 'unknown' }))).resolves.toBeNull();
  });

  it('keeps the full description out of the dashboard summary and shows the compact brief', () => {
    const html = renderToStaticMarkup(React.createElement(IntegratorTaskDashboard, {
      cards: [card], onOpen: () => undefined, onRefresh: () => undefined,
      canAssignReviewer: false, onAssignReviewer: async () => null,
    }));

    expect(html).toContain('Действие:');
    expect(html).toContain('Markdown QA');
    expect(html).not.toContain('Blocker');
    expect(html).not.toContain('First item');
    expect(html).not.toContain('## Blocker');
  });

  it('shows explicit edit and reviewer actions when a card is waiting for review without a reviewer', () => {
    const waiting: KanbanCard = { ...card, column: 'review', needsReview: true, requiresApprovalFrom: [] };
    const html = renderToStaticMarkup(React.createElement(IntegratorTaskDashboard, {
      cards: [waiting], onOpen: () => undefined, onRefresh: () => undefined,
      canAssignReviewer: true, onAssignReviewer: async () => waiting,
    }));

    expect(html).toContain('Изменить');
    expect(html).toContain('Назначить проверяющего');
  });

  it('explains that only the board owner can assign a reviewer', () => {
    const waiting: KanbanCard = { ...card, column: 'review', needsReview: true, requiresApprovalFrom: [] };
    const html = renderToStaticMarkup(React.createElement(IntegratorTaskDashboard, {
      cards: [waiting], onOpen: () => undefined, onRefresh: () => undefined,
      canAssignReviewer: false, onAssignReviewer: async () => null,
    }));

    expect(html).toContain('Назначить проверяющего');
    expect(html).toContain('Назначить проверяющего может только владелец доски');
    expect(html).toContain('Доступно владельцу доски.');
    expect(html).toContain('disabled="" title="Назначить проверяющего может только владелец доски"');
  });
});
