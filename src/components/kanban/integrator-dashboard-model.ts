import type { KanbanCard } from '@/lib/kanban/types';

export type ExecutionSnapshot = {
  cardId: string;
  state: 'not-started' | 'running' | 'waiting' | 'stopped' | 'unknown';
  startAvailable?: boolean;
  unavailableReason?: string;
  lastProgress?: { summary: string; at: string };
  nextAction?: string;
  waitReason?: string;
  sessionUrl?: string;
};

export type StoredStartOperation = {
  operationId: string;
  status: 'pending' | 'admitted' | 'unknown';
};

export const EXECUTION_OPERATION_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export function executionOperationStorageKey(cardId: string): string {
  return `kanban:task-execution:${encodeURIComponent(cardId)}`;
}

/** A present but malformed record fails closed so a lost start is never replaced with a new ID. */
export function parseStoredStartOperation(value: string | null): StoredStartOperation | null | 'invalid' {
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'invalid';
    const record = parsed as Record<string, unknown>;
    if (typeof record.operationId !== 'string' || !EXECUTION_OPERATION_ID_PATTERN.test(record.operationId)
      || !['pending', 'admitted', 'unknown'].includes(String(record.status))) return 'invalid';
    return { operationId: record.operationId, status: record.status as StoredStartOperation['status'] };
  } catch {
    return 'invalid';
  }
}

/** Keep the browser request limited to the server-owned task/version join and its idempotency key. */
export function executionStartRequest(expectedVersion: number, operationId: string) {
  return { expectedVersion, operationId };
}

/** Read back only the operation already admitted by the board. */
export function executionSyncRequest(operationId: string, expectedVersion: number) {
  return { action: 'sync-result' as const, operationId, expectedVersion };
}

export function executionSignalLabel(state: ExecutionSnapshot['state']): string {
  return {
    'not-started': 'В карточке нет сохранённого запуска',
    running: 'В карточке указан статус «В работе»; активная сессия не подтверждена',
    waiting: 'По карточке ожидается действие',
    stopped: 'Карточка закрыта или архивирована',
    unknown: 'Состояние запуска неизвестно',
  }[state];
}

export function parseExecutionSnapshot(value: unknown, expectedCardId: string): ExecutionSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const states = new Set(['not-started', 'running', 'waiting', 'stopped', 'unknown']);
  if (candidate.cardId !== expectedCardId || typeof candidate.state !== 'string' || !states.has(candidate.state)) return null;
  const last = candidate.lastProgress;
  const lastProgress = last && typeof last === 'object' && !Array.isArray(last)
    && typeof (last as Record<string, unknown>).summary === 'string'
    && typeof (last as Record<string, unknown>).at === 'string'
    ? { summary: (last as Record<string, string>).summary, at: (last as Record<string, string>).at }
    : undefined;
  return {
    cardId: expectedCardId,
    state: candidate.state as ExecutionSnapshot['state'],
    ...(typeof candidate.startAvailable === 'boolean' ? { startAvailable: candidate.startAvailable } : {}),
    ...(typeof candidate.unavailableReason === 'string' ? { unavailableReason: candidate.unavailableReason } : {}),
    ...(lastProgress ? { lastProgress } : {}),
    ...(typeof candidate.nextAction === 'string' ? { nextAction: candidate.nextAction } : {}),
    ...(typeof candidate.waitReason === 'string' ? { waitReason: candidate.waitReason } : {}),
    ...(typeof candidate.sessionUrl === 'string' ? { sessionUrl: candidate.sessionUrl } : {}),
  };
}

export function getDashboardCounts(cards: KanbanCard[]) {
  return {
    active: cards.filter(card => !['done', 'archived'].includes(card.column)).length,
    review: cards.filter(card => card.column === 'review' && card.needsReview).length,
    blocked: cards.filter(card => card.column === 'blocked').length,
    withResults: cards.filter(card => (card.resultHistory?.length ?? 0) > 0).length,
  };
}

export function getLatestResult(card: KanbanCard) {
  return card.resultHistory?.at(-1);
}

/** Only links to the verified native session host may be shown as session links. */
export function isVerifiedSessionUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'agent.bezrabotnyi.com';
  } catch {
    return false;
  }
}
