import type { KanbanCard, TaskExecutionReceipt } from './types';

export type TaskExecutionState = 'not-started' | 'running' | 'waiting' | 'stopped' | 'unknown';

export interface TaskExecutionSnapshot {
  cardId: string;
  state: TaskExecutionState;
  lastProgress?: { summary: string; at: string };
  nextAction?: string;
  waitReason?: string;
  sessionUrl?: string;
}

export const QUEUED_OPEN_CODE_ACTIVE_PROGRESS = 'Точное задание видно в связанной активной сессии; ожидаю квитанцию нативного хода. Повтор не выполнялся.';

export function isObservedActiveQueuedSession(receipt: TaskExecutionReceipt | undefined): boolean {
  return receipt?.phase === 'dispatch-unknown' && receipt.harness === 'opencode'
    && /^[a-f0-9]{64}$/.test(receipt.operationId) && /^[a-f0-9]{64}$/.test(receipt.messageInputId ?? '')
    && !receipt.nativeTurnId && !!receipt.nativeSessionId?.trim() && !!receipt.hostId?.trim()
    && !!receipt.projectBinding && !!receipt.nativeDispatchJobId && /^job_[a-f0-9]{64}$/.test(receipt.nativeDispatchJobId)
    && !!receipt.nativeInputMessageId && /^msg_[A-Za-z0-9_-]{8,256}$/.test(receipt.nativeInputMessageId);
}

export const SESSION_UI_BY_HOST: Readonly<Record<string, string>> = {
  'roomhacker-server-100': 'https://agent.bezrabotnyi.com',
  'server-44': 'https://agent44.bezrabotnyi.com',
  'roomhacker-server-88': 'https://agent88.bezrabotnyi.com',
  'mac-mini-2012.lan': 'https://agent-mac-mini.bezrabotnyi.com',
  'MacBook-Pro-User.local': 'https://agent-mac-m1.bezrabotnyi.com',
};

export function taskSessionUrl(hostId: string, harness: string, nativeSessionId: string, turnId?: string): string | undefined {
  const base = SESSION_UI_BY_HOST[hostId];
  if (!base || !['codex', 'zcode', 'opencode'].includes(harness)
    || !nativeSessionId.trim() || nativeSessionId.length > 512 || /[\x00-\x1f\x7f]/.test(nativeSessionId)
    || turnId !== undefined && (!turnId.trim() || turnId.length > 512 || /[\x00-\x1f\x7f]/.test(turnId))) return undefined;
  return `${base}/#/session/${encodeURIComponent(`${harness}:${nativeSessionId}`)}${turnId ? `?turn=${encodeURIComponent(turnId)}` : ''}`;
}

/** Read the execution-facing view from the existing Board card and result history. */
export function taskExecutionSnapshot(card: KanbanCard): TaskExecutionSnapshot {
  const latest = card.resultHistory?.at(-1);
  const attempt = card.taskExecutionHistory?.at(-1);
  const waitingFor = card.waitingFor?.filter(value => value.trim()) ?? [];
  const sessionUrl = attempt?.nativeSessionId
    ? taskSessionUrl(attempt.hostId, attempt.harness, attempt.nativeSessionId) : undefined;
  const progress = attempt?.lastProgress
    ? { summary: attempt.lastProgress, at: attempt.lastProgressAt ?? attempt.updatedAt }
    : latest ? { summary: latest.summary, at: latest.submittedAt } : undefined;
  const state: TaskExecutionState = attempt?.phase === 'running' || isObservedActiveQueuedSession(attempt)
    ? 'running'
    : attempt?.phase === 'waiting' || attempt?.phase === 'created'
      ? 'waiting'
      : attempt?.phase === 'stopped'
        ? 'stopped'
    : attempt?.phase === 'intent' || attempt?.phase === 'create-unknown' || attempt?.phase === 'dispatch-unknown'
      ? 'unknown'
        : card.column === 'archived' || card.column === 'done'
    ? 'stopped'
    : card.column === 'review' || card.needsReview || card.column === 'blocked' || waitingFor.length > 0
      ? 'waiting'
      : card.column === 'in-progress'
        ? 'running'
        : latest
          ? 'unknown'
          : 'not-started';

  return {
    cardId: card.id,
    state,
    ...(progress ? { lastProgress: progress } : {}),
    ...(card.nextAction === null ? {} : card.nextAction?.trim() ? { nextAction: card.nextAction.trim() }
      : latest?.nextAction?.trim() ? { nextAction: latest.nextAction.trim() } : {}),
    ...(sessionUrl ? { sessionUrl } : {}),
    ...(state === 'waiting' ? {
      waitReason: attempt?.phase === 'created'
        ? 'Сессия создана; запуск задания ещё не подтверждён'
        : attempt?.phase === 'waiting'
          ? 'Ожидает продолжения в нативной сессии'
        : card.column === 'review' || card.needsReview
        ? 'Ожидает решения человека'
        : waitingFor.length ? waitingFor.join(', ') : 'Задача заблокирована',
    } : {}),
  };
}
