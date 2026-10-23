import type { KanbanCard } from '@/lib/kanban/types';
import { SESSION_UI_BY_HOST, taskSessionUrl } from '../../lib/kanban/task-execution';

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

export type CatalogLinkDisplay = {
  projectId: string;
  planIds: string[];
  gateIds: string[];
  contactIds: string[];
  sourceRef: string;
  sourceRevision: string;
  catalogRevision: string;
  boardVersion: number;
};

export type ConfirmedTaskRequest = { actor: string; inputId: string; turnId: string; instruction: string; sessionUrl: string };

/** Project only durable signed requester + exact admitted input/turn correlations. */
export function confirmedTaskRequests(card: Pick<KanbanCard, 'title' | 'taskExecutionHistory'>): ConfirmedTaskRequest[] {
  const candidates: ConfirmedTaskRequest[] = [];
  for (const receipt of card.taskExecutionHistory ?? []) {
    if (receipt.requestedBy && receipt.nativeSessionId && receipt.nativeTurnId
      && /^[a-f0-9]{64}$/.test(receipt.messageInputId)
      && ['running', 'waiting', 'stopped', 'result'].includes(receipt.phase)) {
      const sessionUrl = taskSessionUrl(receipt.hostId, receipt.harness, receipt.nativeSessionId, receipt.nativeTurnId);
      if (sessionUrl) candidates.push({ actor: receipt.requestedBy, inputId: receipt.messageInputId, turnId: receipt.nativeTurnId, instruction: `Запуск задачи «${card.title}»`, sessionUrl });
    }
    for (const child of receipt.continuations ?? []) {
      if (child.requestedBy && receipt.nativeSessionId && child.nativeTurnId && /^[a-f0-9]{64}$/.test(child.inputId)
        && ['running', 'result'].includes(child.phase)) {
        const sessionUrl = taskSessionUrl(receipt.hostId, receipt.harness, receipt.nativeSessionId, child.nativeTurnId);
        if (sessionUrl) candidates.push({ actor: child.requestedBy, inputId: child.inputId, turnId: child.nativeTurnId, instruction: child.instruction, sessionUrl });
      }
    }
  }
  const inputCounts = new Map<string, number>();
  const turnCounts = new Map<string, number>();
  for (const item of candidates) {
    inputCounts.set(item.inputId, (inputCounts.get(item.inputId) ?? 0) + 1);
    turnCounts.set(item.turnId, (turnCounts.get(item.turnId) ?? 0) + 1);
  }
  return candidates.filter(item => inputCounts.get(item.inputId) === 1 && turnCounts.get(item.turnId) === 1);
}

/** Expose only the immutable catalog link persisted on the card, not live catalog state. */
export function getCatalogLinkDisplay(card: Pick<KanbanCard, 'catalogLink'>): CatalogLinkDisplay | null {
  const link = card.catalogLink;
  if (!link) return null;
  return {
    projectId: link.projectId,
    planIds: [...link.planIds],
    gateIds: [...link.gateIds],
    contactIds: [...link.contactIds],
    sourceRef: link.sourceRef,
    sourceRevision: link.sourceRevision,
    catalogRevision: link.catalogRevision,
    boardVersion: link.boardVersion,
  };
}

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

/** Retry an uncertain saved key only when the current Board read shows no attempt is recorded. */
export function canRetrySameOperation(
  operation: StoredStartOperation | null | 'invalid' | undefined,
  execution: ExecutionSnapshot | null | undefined,
): operation is StoredStartOperation {
  return operation !== null && operation !== undefined && operation !== 'invalid'
    && operation.status !== 'admitted'
    && execution?.state === 'not-started' && execution.startAvailable === true;
}

/** Read back only the operation already admitted by the board. */
export function executionSyncRequest(operationId: string, expectedVersion: number) {
  return { action: 'sync-result' as const, operationId, expectedVersion };
}

export function taskFollowUpRequest(operationId: string, expectedVersion: number, continuationText: string) {
  return { action: 'continue-task' as const, operationId, expectedVersion, continuationText };
}

export function taskFollowUpSyncRequest(operationId: string, continuationId: string, expectedVersion: number) {
  return { action: 'sync-task-continuation' as const, operationId, continuationId, expectedVersion };
}

export function canContinueTask(card: KanbanCard): boolean {
  const parent = card.taskExecutionHistory?.at(-1);
  return card.column === 'review' && card.needsReview === true
    && parent?.phase === 'result' && !!parent.nativeSessionId && !!parent.nativeTurnId
    && parent.lastBoardVersion === card.version
    && !parent.continuations?.length;
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

/** Session link origins are exactly the ones the session URL generator uses. */
const VERIFIED_SESSION_ORIGINS: ReadonlySet<string> = new Set(
  Object.values(SESSION_UI_BY_HOST).flatMap(base => {
    try {
      return [new URL(base).origin];
    } catch {
      return [];
    }
  }),
);

/** Only links to a verified native session host may be shown as session links. */
export function isVerifiedSessionUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && VERIFIED_SESSION_ORIGINS.has(url.origin);
  } catch {
    return false;
  }
}
