import type { KanbanCard, TaskExecutionReceipt } from '@/lib/kanban/types';
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

/** Recover a read-only status check from the durable Board receipt after browser storage is lost. */
export function durableExecutionReceiptId(receipt: TaskExecutionReceipt | undefined): string | null {
  if (!receipt || !/^[a-f0-9]{64}$/.test(receipt.operationId)
      || !['dispatch-unknown', 'running', 'waiting'].includes(receipt.phase)
      || !receipt.nativeSessionId || !receipt.hostId || !receipt.requestHash) return null;
  return receipt.operationId;
}

export function latestSessionStopControl(receipt: TaskExecutionReceipt | undefined) {
  return receipt?.sessionControls?.stops?.at(-1) ?? receipt?.sessionControls?.stop;
}

/** A distinct accepted direct input opens exactly one new stop epoch. */
export function sessionControlStopEpoch(receipt: TaskExecutionReceipt | undefined): string | null {
  if (!receipt || !/^[a-f0-9]{64}$/.test(receipt.messageInputId)) return null;
  const latestDirect = receipt.sessionControls?.direct?.at(-1);
  return latestDirect?.requestHash ?? receipt.messageInputId;
}

export function hasStopReceiptForCurrentEpoch(receipt: TaskExecutionReceipt | undefined): boolean {
  const epoch = sessionControlStopEpoch(receipt);
  const latestStop = latestSessionStopControl(receipt);
  if (!epoch || !latestStop) return false;
  // Legacy stop receipts always belong to the initial input epoch.
  return (latestStop.controlEpoch ?? receipt?.messageInputId) === epoch;
}

/** Existing unresolved native work must never be exposed as a fresh start. */
export function hasUnresolvedDurableExecution(receipt: TaskExecutionReceipt | undefined): boolean {
  return Boolean(receipt && /^[a-f0-9]{64}$/.test(receipt.operationId)
    && ['created', 'dispatch-unknown', 'running', 'waiting', 'stopped'].includes(receipt.phase)
    && receipt.nativeSessionId && receipt.hostId && receipt.requestHash);
}

export function openCodeControlReceipt(
  receipts: TaskExecutionReceipt[], action: 'direct' | 'stop',
): TaskExecutionReceipt | undefined {
  const candidates = receipts.filter(receipt => {
    const active = ['running', 'waiting'].includes(receipt.phase);
    const stoppedForResume = action === 'direct' && receipt.phase === 'stopped'
      && latestSessionStopControl(receipt)?.phase === 'accepted';
    if ((!active && !stoppedForResume) || receipt.harness !== 'opencode'
        || !receipt.hostId || !receipt.nativeSessionId) return false;
    const typedInput = !!receipt.nativeInputMessageId && /^msg_[A-Za-z0-9_-]{8,256}$/.test(receipt.nativeInputMessageId)
      && !!receipt.nativeDispatchJobId && /^job_[a-f0-9]{64}$/.test(receipt.nativeDispatchJobId)
      && !!receipt.projectBinding && receipt.projectBinding.harness === 'opencode'
      && receipt.projectBinding.hostId === receipt.hostId;
    return !!receipt.nativeTurnId || typedInput;
  });
  return candidates.length === 1 ? candidates[0] : undefined;
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
  if (!parent || parent.phase !== 'result' || !parent.nativeSessionId || parent.continuations?.length) return false;
  const openCodeReceipt = parent.harness === 'opencode' && !!parent.projectBinding
    && parent.projectBinding.harness === 'opencode' && parent.projectBinding.hostId === parent.hostId
    && !!parent.nativeDispatchJobId && /^job_[a-f0-9]{64}$/.test(parent.nativeDispatchJobId)
    && !!parent.nativeInputMessageId && /^msg_[A-Za-z0-9_-]{8,256}$/.test(parent.nativeInputMessageId);
  if (!parent.nativeTurnId && !openCodeReceipt) return false;
  const review = card.reviewHistory?.at(-1);
  const assignedRework = card.column === 'in-progress' && card.needsReview !== true
    && review?.decision === 'rework' && !!review.actor && (card.requiresApprovalFrom ?? []).includes(review.actor);
  const waitingForReview = card.column === 'review' && card.needsReview === true && parent.lastBoardVersion === card.version;
  return (waitingForReview || assignedRework)
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
