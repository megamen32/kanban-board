'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, CircleHelp, Clock3, Pencil, Play, UserRoundCheck } from 'lucide-react';
import type { KanbanCard, TaskExecutionReceipt, TaskExecutionSessionControlPhase } from '@/lib/kanban/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DEFAULT_COLUMNS } from '@/lib/kanban/types';
import { MarkdownText } from './markdown-text';
import { CardBriefPanel } from './card-brief-panel';
import { mutationErrorMessage } from '../../lib/kanban/mutation-response';
import { matchesTaskExecutionOperation } from './notice-question-model';
import {
  canRetrySameOperation,
  canContinueTask,
  confirmedTaskRequests,
  durableExecutionReceiptId,
  hasUnresolvedDurableExecution,
  hasStopReceiptForCurrentEpoch,
  latestSessionStopControl,
  openCodeControlReceipt,
  sessionControlStopEpoch,
  executionOperationStorageKey,
  executionSignalLabel,
  executionStartRequest,
  getDashboardCounts,
  getLatestResult,
  isVerifiedSessionUrl,
  parseExecutionSnapshot,
  parseStoredStartOperation,
  taskFollowUpRequest,
  taskFollowUpSyncRequest,
  type ExecutionSnapshot,
  type StoredStartOperation,
} from './integrator-dashboard-model';

type StoredOperationState = StoredStartOperation | null | 'invalid';
type Props = {
  cards: KanbanCard[];
  onOpen: (card: KanbanCard) => void;
  onRefresh: () => Promise<unknown> | void;
  canAssignReviewer: boolean;
  onAssignReviewer: (cardId: string, reviewer: string, version: number) => Promise<KanbanCard | null>;
};

function safeSourceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch { return null; }
}

function sessionRecoveryAttemptStorageKey(cardId: string): string {
  return `kanban:task-execution-session-recovery:${encodeURIComponent(cardId)}`;
}

type TaskStartFailure = {
  kind: 'not_attempted' | 'unknown';
  operation: StoredStartOperation;
  retryable: boolean;
  message: string;
};

export function isRecoverableNotAttemptedDispatch(receipt: TaskExecutionReceipt | undefined, cardVersion: number): receipt is TaskExecutionReceipt {
  if (!receipt || receipt.phase !== 'dispatch-unknown' || receipt.harness !== 'opencode'
      || !receipt.hostId || !receipt.nativeSessionId || receipt.nativeTurnId
      || receipt.continuations?.length || receipt.lastBoardVersion !== cardVersion
      || !receipt.messageInputId) return false;

  let dispatchReceipt: unknown;
  try {
    dispatchReceipt = JSON.parse(receipt.dispatchReceiptText ?? 'null');
  } catch {
    return false;
  }
  return Boolean(dispatchReceipt && typeof dispatchReceipt === 'object' && !Array.isArray(dispatchReceipt)
    && 'delivery' in dispatchReceipt && dispatchReceipt.delivery === 'not_attempted'
    && 'nonRetryable' in dispatchReceipt && dispatchReceipt.nonRetryable === true
    && 'inputId' in dispatchReceipt && dispatchReceipt.inputId === receipt.messageInputId);
}

export async function recoverableNoTurnOperationId(
  cardId: string,
  cardVersion: number,
  receipt: TaskExecutionReceipt | undefined,
  rawStoredOperation: string | null,
  recoveryAttemptedOperationId?: string | null,
): Promise<string | null> {
  const stored = parseStoredStartOperation(rawStoredOperation);
  if (!stored || stored === 'invalid' || stored.status === 'admitted'
      || recoveryAttemptedOperationId === stored.operationId
      || !isRecoverableNotAttemptedDispatch(receipt, cardVersion)) return null;
  return await matchesTaskExecutionOperation(cardId, receipt.operationId, stored.operationId)
    ? stored.operationId : null;
}

export function classifyTaskStartFailure(status: number, body: unknown, operationId: string): TaskStartFailure | null {
  if (status !== 400 || !body || typeof body !== 'object' || Array.isArray(body)) return null;
  if ('state' in body && body.state === 'not_attempted' && 'retryable' in body && body.retryable === true) {
    return {
      kind: 'not_attempted',
      operation: { operationId, status: 'unknown' },
      retryable: true,
      message: 'Запуск не отправлен. Ключ сохранён; повторить тем же ключом можно после подтверждения готовности сервера.',
    };
  }
  if ('error' in body && body.error === 'task execution request could not be processed safely') {
    return {
      kind: 'unknown',
      operation: { operationId, status: 'unknown' },
      retryable: false,
      message: 'Исход запуска не подтверждён. Ключ сохранён; безопасный повтор не разрешён.',
    };
  }
  return null;
}

export function canOfferTaskStartRetry(
  operation: StoredOperationState | undefined,
  execution: ExecutionSnapshot | null | undefined,
  authorizedOperationId: string | undefined,
): operation is StoredStartOperation {
  if (!authorizedOperationId || !operation || operation === 'invalid') return false;
  return operation.operationId === authorizedOperationId && canRetrySameOperation(operation, execution);
}

async function sessionControlRequestHash(cardId: string, operationId: string, action: 'direct' | 'stop', message: string, controlEpoch?: string | null): Promise<string> {
  const payload = JSON.stringify({ cardId, operationId, action, message,
    ...(action === 'stop' && controlEpoch ? { controlEpoch } : {}) });
  const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function IntegratorTaskDashboard({ cards, onOpen, onRefresh, canAssignReviewer, onAssignReviewer }: Props) {
  const [executions, setExecutions] = useState<Record<string, ExecutionSnapshot | null>>({});
  const [storedOperations, setStoredOperations] = useState<Record<string, StoredOperationState>>({});
  const [safeRetryOperationIds, setSafeRetryOperationIds] = useState<Record<string, string | undefined>>({});
  const [recoverableSessionOperationIds, setRecoverableSessionOperationIds] = useState<Record<string, string | undefined>>({});
  const [storageLoadedFor, setStorageLoadedFor] = useState<string | null>(null);
  const [startBusy, setStartBusy] = useState<Record<string, boolean>>({});
  const [syncBusy, setSyncBusy] = useState<Record<string, boolean>>({});
  const [startMessages, setStartMessages] = useState<Record<string, string>>({});
  const [followUpText, setFollowUpText] = useState<Record<string, string>>({});
  const [sessionControlText, setSessionControlText] = useState<Record<string, string>>({});
  const [sessionControlHashes, setSessionControlHashes] = useState<Record<string, string | undefined>>({});
  const [sessionControlBusy, setSessionControlBusy] = useState<Record<string, boolean>>({});
  const [sessionControlPhase, setSessionControlPhase] = useState<Record<string, TaskExecutionSessionControlPhase | undefined>>({});
  const [reviewerAssignmentCardId, setReviewerAssignmentCardId] = useState<string | null>(null);
  const [reviewerDraft, setReviewerDraft] = useState('');
  const [reviewerBusy, setReviewerBusy] = useState(false);
  const [reviewerError, setReviewerError] = useState<string | null>(null);
  const inFlightStarts = useRef(new Set<string>());
  const inFlightSyncs = useRef(new Set<string>());
  const inFlightSessionControls = useRef(new Set<string>());
  const sessionControlDraftSequence = useRef<Record<string, number>>({});
  const counts = getDashboardCounts(cards);
  const cardIdsKey = cards.map(card => card.id).sort().join('\0');
  const reviewerOptions = useMemo(() => [...new Set(cards.flatMap(card => [
    card.owner ?? '', card.assignee ?? '', ...card.assignees, ...(card.requiresApprovalFrom ?? []),
  ]).map(person => person.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru')), [cards]);

  async function assignReviewer(card: KanbanCard) {
    const reviewer = reviewerDraft.trim();
    if (!reviewer || reviewerBusy) return;
    setReviewerBusy(true);
    setReviewerError(null);
    try {
      const saved = await onAssignReviewer(card.id, reviewer, card.version);
      if (!saved) {
        setReviewerError('Карточка изменилась. Обнови её и попробуй назначить проверяющего ещё раз.');
        return;
      }
      setReviewerAssignmentCardId(null);
      setReviewerDraft('');
      await onRefresh();
    } catch (error) {
      setReviewerError(mutationErrorMessage(error));
    } finally {
      setReviewerBusy(false);
    }
  }

  function reviewerAssignmentButton(card: KanbanCard) {
    return <>
      <Button size="sm" variant="outline" disabled={!canAssignReviewer}
        title={canAssignReviewer ? 'Назначить человека, который примет результат' : 'Назначить проверяющего может только владелец доски'}
        onClick={() => { if (!canAssignReviewer) return; setReviewerAssignmentCardId(card.id); setReviewerDraft(''); setReviewerError(null); }}>
        <UserRoundCheck aria-hidden className="mr-1 h-3.5 w-3.5" />Назначить проверяющего
      </Button>
      {!canAssignReviewer && <span className="text-xs text-muted-foreground">Доступно владельцу доски.</span>}
    </>;
  }

  function writeOperation(cardId: string, operation: StoredStartOperation): boolean {
    try {
      window.localStorage.setItem(executionOperationStorageKey(cardId), JSON.stringify(operation));
      setStoredOperations(previous => ({ ...previous, [cardId]: operation }));
      return true;
    } catch {
      return false;
    }
  }

  const revokeSafeRetry = useCallback((cardId: string, operationId?: string) => {
    setSafeRetryOperationIds(previous => {
      if (operationId && previous[cardId] !== operationId) return previous;
      if (!Object.hasOwn(previous, cardId)) return previous;
      const next = { ...previous };
      delete next[cardId];
      return next;
    });
  }, []);

  const revokeRecoverableSession = useCallback((cardId: string, operationId?: string) => {
    setRecoverableSessionOperationIds(previous => {
      if (operationId && previous[cardId] !== operationId) return previous;
      if (!Object.hasOwn(previous, cardId)) return previous;
      const next = { ...previous };
      delete next[cardId];
      return next;
    });
  }, []);

  const clearOperation = useCallback((cardId: string) => {
    try {
      window.localStorage.removeItem(executionOperationStorageKey(cardId));
      window.localStorage.removeItem(sessionRecoveryAttemptStorageKey(cardId));
      setStoredOperations(previous => ({ ...previous, [cardId]: null }));
      revokeSafeRetry(cardId);
      revokeRecoverableSession(cardId);
      setStartMessages(previous => {
        if (!Object.hasOwn(previous, cardId)) return previous;
        const next = { ...previous };
        delete next[cardId];
        return next;
      });
    } catch {
      // Keep the existing record and fail closed if browser storage is unavailable.
    }
  }, [revokeRecoverableSession, revokeSafeRetry]);

  async function startTask(card: KanbanCard, retryOperation?: StoredStartOperation) {
    if (inFlightStarts.current.has(card.id)) return;
    const prior = storedOperations[card.id];
    if (retryOperation && (!canOfferTaskStartRetry(prior, executions[card.id], safeRetryOperationIds[card.id])
        || prior.operationId !== retryOperation.operationId)) return;
    if (prior === 'invalid') {
      setStartMessages(previous => ({ ...previous, [card.id]: 'Сохранённая запись запуска повреждена; повторная отправка отключена.' }));
      return;
    }
    if (prior && !retryOperation) {
      setStartMessages(previous => ({ ...previous, [card.id]: 'Для этой карточки уже есть незавершённая запись запуска. Повторная отправка отключена.' }));
      return;
    }
    if (!retryOperation && (!executions[card.id] || executions[card.id]?.startAvailable !== true)) return;

    const operationId = retryOperation?.operationId ?? window.crypto?.randomUUID?.();
    if (!operationId) {
      setStartMessages(previous => ({ ...previous, [card.id]: 'Браузер не смог создать ключ операции; запуск не отправлен.' }));
      return;
    }
    const operation: StoredStartOperation = retryOperation ?? { operationId, status: 'pending' };
    if (!retryOperation && !writeOperation(card.id, operation)) {
      setStartMessages(previous => ({ ...previous, [card.id]: 'Не удалось сохранить ключ операции; запуск не отправлен.' }));
      return;
    }
    if (retryOperation) revokeSafeRetry(card.id, retryOperation.operationId);

    inFlightStarts.current.add(card.id);
    setStartBusy(previous => ({ ...previous, [card.id]: true }));
    setStartMessages(previous => ({ ...previous, [card.id]: retryOperation
      ? 'Сверяю сохранённый запуск тем же ключом…'
      : 'Отправляю один запрос запуска…' }));
    try {
      const response = await fetch(`/api/kanban/cards/${encodeURIComponent(card.id)}/execution`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(executionStartRequest(card.version, operationId)),
      });
      const body: unknown = await response.json().catch(() => null);
      const snapshot = parseExecutionSnapshot(body, card.id);
      if (snapshot) setExecutions(previous => ({ ...previous, [card.id]: snapshot }));
      const failure = classifyTaskStartFailure(response.status, body, operationId);

      if (response.status === 201 || response.status === 200) {
        writeOperation(card.id, { operationId, status: 'admitted' });
        setStartMessages(previous => ({ ...previous, [card.id]: 'Запуск принят. Повторная отправка отключена; результат появится после сохранения сервером.' }));
      } else if (failure) {
        writeOperation(card.id, failure.operation);
        if (failure.kind === 'not_attempted' && failure.retryable) {
          setSafeRetryOperationIds(previous => ({ ...previous, [card.id]: operationId }));
        }
        setStartMessages(previous => ({ ...previous, [card.id]: failure.message }));
      } else if (response.status === 409 && body && typeof body === 'object' && 'conflict' in body && body.conflict === true) {
        writeOperation(card.id, { operationId, status: 'unknown' });
        setStartMessages(previous => ({ ...previous, [card.id]: 'Запуск не подтверждён: версия карточки изменилась. Тот же ключ сохранён; новый запуск не создан.' }));
      } else {
        writeOperation(card.id, { operationId, status: 'unknown' });
        setStartMessages(previous => ({ ...previous, [card.id]: 'Исход запроса не подтверждён. Повторный запуск не отправлен.' }));
      }
    } catch {
      writeOperation(card.id, { operationId, status: 'unknown' });
      setStartMessages(previous => ({ ...previous, [card.id]: 'Не удалось подтвердить ответ сервера. Повторный запуск не отправлен.' }));
    } finally {
      inFlightStarts.current.delete(card.id);
      await Promise.resolve(onRefresh()).catch(() => undefined);
      setStartBusy(previous => ({ ...previous, [card.id]: false }));
    }
  }

  async function continueStoppedSession(card: KanbanCard, receipt: TaskExecutionReceipt) {
    if (inFlightStarts.current.has(card.id)) return;
    let rawOperation: string | null;
    let recoveryAttemptedOperationId: string | null;
    try {
      rawOperation = window.localStorage.getItem(executionOperationStorageKey(card.id));
      recoveryAttemptedOperationId = window.localStorage.getItem(sessionRecoveryAttemptStorageKey(card.id));
    } catch {
      return;
    }
    const operationId = await recoverableNoTurnOperationId(card.id, card.version, receipt, rawOperation, recoveryAttemptedOperationId)
      .catch(() => null);
    const stored = parseStoredStartOperation(rawOperation);
    const storedOperation = storedOperations[card.id];
    if (!operationId || operationId !== recoverableSessionOperationIds[card.id]
        || !stored || stored === 'invalid' || stored.operationId !== operationId
        || !storedOperation || storedOperation === 'invalid' || storedOperation.operationId !== operationId) return;
    if (inFlightStarts.current.has(card.id)) return;
    try {
      window.localStorage.setItem(sessionRecoveryAttemptStorageKey(card.id), operationId);
    } catch {
      setStartMessages(previous => ({ ...previous, [card.id]: 'Не удалось сохранить отметку продолжения; запрос не отправлен.' }));
      return;
    }
    revokeRecoverableSession(card.id, operationId);
    inFlightStarts.current.add(card.id);
    setStartBusy(previous => ({ ...previous, [card.id]: true }));
    setStartMessages(previous => ({ ...previous, [card.id]: 'Продолжаю созданную сессию с тем же ключом…' }));
    try {
      const response = await fetch(`/api/kanban/cards/${encodeURIComponent(card.id)}/execution`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(executionStartRequest(card.version, operationId)),
      });
      const body: unknown = await response.json().catch(() => null);
      const snapshot = parseExecutionSnapshot(body, card.id);
      if (snapshot) setExecutions(previous => ({ ...previous, [card.id]: snapshot }));
      const failure = classifyTaskStartFailure(response.status, body, operationId);

      if (response.status === 200 || response.status === 201) {
        writeOperation(card.id, { operationId, status: 'admitted' });
        setStartMessages(previous => ({ ...previous, [card.id]: 'Существующую сессию продолжили. Новый запуск не создавался.' }));
      } else if (failure) {
        writeOperation(card.id, failure.operation);
        if (failure.kind === 'not_attempted' && failure.retryable) {
          setSafeRetryOperationIds(previous => ({ ...previous, [card.id]: operationId }));
        }
        setStartMessages(previous => ({ ...previous, [card.id]: failure.message }));
      } else {
        writeOperation(card.id, { operationId, status: 'unknown' });
        setStartMessages(previous => ({ ...previous, [card.id]: 'Продолжение не подтверждено. Тот же ключ сохранён; повтор не разрешён.' }));
      }
    } catch {
      writeOperation(card.id, { operationId, status: 'unknown' });
      setStartMessages(previous => ({ ...previous, [card.id]: 'Ответ продолжения не подтверждён. Тот же ключ сохранён; повтор не разрешён.' }));
    } finally {
      await Promise.resolve(onRefresh()).catch(() => undefined);
      inFlightStarts.current.delete(card.id);
      setStartBusy(previous => ({ ...previous, [card.id]: false }));
    }
  }

  async function syncResult(card: KanbanCard, operation: StoredStartOperation) {
    if (inFlightSyncs.current.has(card.id) || startBusy[card.id]) return;
    inFlightSyncs.current.add(card.id);
    setSyncBusy(previous => ({ ...previous, [card.id]: true }));
    setStartMessages(previous => ({ ...previous, [card.id]: 'Проверяю результат этого запуска…' }));
    try {
      const response = await fetch(`/api/kanban/cards/${encodeURIComponent(card.id)}/execution`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'sync-result', operationId: operation.operationId, expectedVersion: card.version }),
      });
      const body: unknown = await response.json().catch(() => null);
      const snapshot = parseExecutionSnapshot(body, card.id);
      if (snapshot) setExecutions(previous => ({ ...previous, [card.id]: snapshot }));

      if (response.status === 200) {
        clearOperation(card.id);
        const resultCard = body && typeof body === 'object' && 'card' in body
          ? (body as { card?: { id?: unknown; column?: unknown; needsReview?: unknown } }).card : undefined;
        const reviewReady = resultCard?.id === card.id && resultCard.column === 'review' && resultCard.needsReview === true;
        setStartMessages(previous => ({
          ...previous,
          [card.id]: reviewReady
            ? 'Результат сохранён и ждёт проверки человека.'
            : snapshot?.state === 'stopped'
              ? 'Этот запуск завершён без результата для проверки.'
              : 'Результат этого запуска уже сохранён.',
        }));
      } else if (response.status === 202) {
        setStartMessages(previous => ({ ...previous, [card.id]: 'Результат ещё не подтверждён; запуск остаётся ожидающим. Можно проверить его позже.' }));
      } else if (response.status === 409) {
        setStartMessages(previous => ({ ...previous, [card.id]: 'Версия карточки изменилась. Данные обновлены; автоматического повтора нет.' }));
      } else {
        setStartMessages(previous => ({ ...previous, [card.id]: 'Сверка результата не подтверждена. Ключ запуска сохранён; новый запуск отключён.' }));
      }
    } catch {
      setStartMessages(previous => ({ ...previous, [card.id]: 'Ответ сверки не подтверждён. Ключ запуска сохранён; новый запуск отключён.' }));
    } finally {
      await Promise.resolve(onRefresh()).catch(() => undefined);
      inFlightSyncs.current.delete(card.id);
      setSyncBusy(previous => ({ ...previous, [card.id]: false }));
    }
  }

  async function continueTask(card: KanbanCard) {
    const instruction = followUpText[card.id]?.trim();
    if (startBusy[card.id] || syncBusy[card.id] || !canContinueTask(card) || !instruction) return;
    const parent = card.taskExecutionHistory?.at(-1);
    if (!parent) return;
    setStartBusy(previous => ({ ...previous, [card.id]: true }));
    setStartMessages(previous => ({ ...previous, [card.id]: 'Передаю дополнительное задание тому же исполнителю…' }));
    try {
      const response = await fetch(`/api/kanban/cards/${encodeURIComponent(card.id)}/execution`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(taskFollowUpRequest(parent.operationId, card.version, instruction)),
      });
      setStartMessages(previous => ({ ...previous, [card.id]: response.status === 202
        ? 'Запрос принят. Проверяю результат; повторно отправлять его не нужно.'
        : response.status === 409
          ? 'Карточка изменилась или предыдущий запуск больше не подходит для продолжения. Обновите данные перед следующим действием.'
          : response.ok ? 'Продолжение связано с исходной задачей; ожидается результат.'
            : 'Не удалось подтвердить запрос. Новая сессия не создавалась.' }));
    } catch {
      setStartMessages(previous => ({ ...previous, [card.id]: 'Не удалось подтвердить отправку. Обновите карточку и проверьте статус; автоматического повтора не будет.' }));
    } finally {
      await Promise.resolve(onRefresh()).catch(() => undefined);
      setStartBusy(previous => ({ ...previous, [card.id]: false }));
    }
  }

  async function syncTaskFollowUp(card: KanbanCard, continuationId: string) {
    if (syncBusy[card.id] || startBusy[card.id]) return;
    const parent = card.taskExecutionHistory?.at(-1);
    if (!parent) return;
    setSyncBusy(previous => ({ ...previous, [card.id]: true }));
    setStartMessages(previous => ({ ...previous, [card.id]: 'Проверяю завершение именно этого продолжения…' }));
    try {
      const response = await fetch(`/api/kanban/cards/${encodeURIComponent(card.id)}/execution`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(taskFollowUpSyncRequest(parent.operationId, continuationId, card.version)),
      });
      setStartMessages(previous => ({ ...previous, [card.id]: response.status === 200
        ? 'Результат продолжения сохранён. Решение человека не менялось.'
        : response.status === 202 ? 'Результат ещё не получен. Сохранённое продолжение не отправлялось повторно.'
          : response.status === 409 ? 'Карточка изменилась во время проверки. Повторного запроса не будет.'
            : 'Не удалось подтвердить результат. Обновите карточку и проверьте статус.' }));
    } catch {
      setStartMessages(previous => ({ ...previous, [card.id]: 'Подтверждение не получено. Обновите карточку и проверьте статус; запрос автоматически не повторяется.' }));
    } finally {
      await Promise.resolve(onRefresh()).catch(() => undefined);
      setSyncBusy(previous => ({ ...previous, [card.id]: false }));
    }
  }

  async function controlSession(card: KanbanCard, action: 'direct' | 'stop') {
    const receipt = openCodeControlReceipt(card.taskExecutionHistory ?? [], action);
    if (!receipt) return;
    const message = action === 'direct' ? sessionControlText[card.id]?.trim() ?? '' : '';
    if (action === 'direct' && !message) return;
    if (action === 'stop' && !window.confirm('Остановить активную сессию исполнителя для этой карточки?')) return;
    let requestHash: string;
    const stopEpoch = action === 'stop' ? sessionControlStopEpoch(receipt) : null;
    if (action === 'stop' && !stopEpoch) return;
    try { requestHash = await sessionControlRequestHash(card.id, receipt.operationId, action, message, stopEpoch); }
    catch { return; }
    const controlKey = action === 'direct'
      ? `${card.id}:${receipt.operationId}:direct:${requestHash}` : `${card.id}:${receipt.operationId}:stop:${stopEpoch}`;
    if (inFlightSessionControls.current.has(controlKey)) return;
    const existing = action === 'direct'
      ? receipt.sessionControls?.direct?.find(item => item.requestHash === requestHash)
      : receipt.sessionControls?.stops?.find(item => item.requestHash === requestHash)
        ?? (receipt.sessionControls?.stop?.requestHash === requestHash ? receipt.sessionControls.stop : undefined);
    if (existing) {
      setSessionControlPhase(previous => ({ ...previous, [controlKey]: existing.phase }));
      return;
    }
    if (sessionControlPhase[controlKey]) return;

    inFlightSessionControls.current.add(controlKey);
    setSessionControlBusy(previous => ({ ...previous, [controlKey]: true }));
    setSessionControlPhase(previous => ({ ...previous, [controlKey]: 'intent' }));
    try {
      const response = await fetch(`/api/kanban/cards/${encodeURIComponent(card.id)}/execution`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: action === 'direct' ? 'session-direct' : 'session-stop', expectedVersion: card.version,
          ...(action === 'direct' ? { message } : {}) }),
      });
      const body: unknown = await response.json().catch(() => null);
      const state = body && typeof body === 'object' && 'state' in body
        ? (body as { state?: unknown }).state : undefined;
      const responseHash = body && typeof body === 'object' && 'requestHash' in body
        ? (body as { requestHash?: unknown }).requestHash : undefined;
      setSessionControlPhase(previous => ({ ...previous, [controlKey]: response.status === 200 && state === 'accepted' && responseHash === requestHash ? 'accepted' : 'unknown' }));
    } catch {
      setSessionControlPhase(previous => ({ ...previous, [controlKey]: 'unknown' }));
    } finally {
      await Promise.resolve(onRefresh()).catch(() => undefined);
      inFlightSessionControls.current.delete(controlKey);
      setSessionControlBusy(previous => ({ ...previous, [controlKey]: false }));
    }
  }

  useEffect(() => {
    let cancelled = false;
    const candidates = cards.filter(card => !['done', 'archived'].includes(card.column));
    const loaded: Record<string, StoredOperationState> = {};
    for (const card of cards) {
      try {
        loaded[card.id] = parseStoredStartOperation(window.localStorage.getItem(executionOperationStorageKey(card.id)));
      } catch {
        loaded[card.id] = 'invalid';
      }
    }
    setStoredOperations(loaded);
    setStorageLoadedFor(cardIdsKey);
    setExecutions({});
    const load = async () => {
      for (let offset = 0; offset < candidates.length; offset += 4) {
        const batch = candidates.slice(offset, offset + 4);
        const results = await Promise.all(batch.map(async card => {
          try {
            const response = await fetch(`/api/kanban/cards/${encodeURIComponent(card.id)}/execution`, { cache: 'no-store' });
            if (!response.ok) return [card.id, null] as const;
            const body: unknown = await response.json();
            const data = body && typeof body === 'object' && 'execution' in body
              ? (body as { execution: unknown }).execution : body;
            const snapshot = parseExecutionSnapshot(data, card.id);
            return [card.id, snapshot] as const;
          } catch { return [card.id, null] as const; }
        }));
        if (!cancelled) setExecutions(previous => ({ ...previous, ...Object.fromEntries(results) }));
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [cards, cardIdsKey, clearOperation]);

  useEffect(() => {
    let cancelled = false;
    if (storageLoadedFor !== cardIdsKey) {
      setRecoverableSessionOperationIds({});
      return () => { cancelled = true; };
    }
    const verifyReceipts = async () => {
      const matches = await Promise.all(cards.map(async card => {
        const stored = storedOperations[card.id];
        const receipt = card.taskExecutionHistory?.at(-1);
        if (!stored || stored === 'invalid') return [card.id, undefined] as const;
        try {
          const raw = window.localStorage.getItem(executionOperationStorageKey(card.id));
          const attempted = window.localStorage.getItem(sessionRecoveryAttemptStorageKey(card.id));
          const operationId = await recoverableNoTurnOperationId(card.id, card.version, receipt, raw, attempted);
          return [card.id, operationId === stored.operationId ? operationId : undefined] as const;
        } catch {
          return [card.id, undefined] as const;
        }
      }));
      if (!cancelled) setRecoverableSessionOperationIds(Object.fromEntries(matches));
    };
    void verifyReceipts();
    return () => { cancelled = true; };
  }, [cards, cardIdsKey, storageLoadedFor, storedOperations]);

  return (
    <section aria-labelledby="integrator-dashboard-title" className="min-h-0 flex-1 overflow-y-auto p-2 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-3 sm:space-y-5">
        <header className="space-y-1">
          <h2 id="integrator-dashboard-title" className="text-base font-semibold sm:text-xl">Коротко по задачам</h2>
          <p className="text-xs text-muted-foreground sm:text-sm">Блокер — работу нельзя продолжить; на проверке — результат готов и ждёт приёмки.</p>
        </header>

        <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
          <Summary label="Открытые" value={counts.active} />
          <Summary label="На проверке" value={counts.review} />
          <Summary label="Блокеры" value={counts.blocked} />
        </div>

        {cards.length === 0 ? <p className="rounded-lg border p-6 text-sm text-muted-foreground">Нет задач с такими условиями. Проверь поиск и фильтры.</p> : (
          <div className="space-y-3">
            {cards.map(card => {
              const result = getLatestResult(card);
              const execution = executions[card.id];
              const storedOperation = storedOperations[card.id];
              const storageReady = storageLoadedFor === cardIdsKey && Object.hasOwn(storedOperations, card.id);
              const executionReceipt = card.taskExecutionHistory?.at(-1);
              const hasDurableExecution = hasUnresolvedDurableExecution(executionReceipt);
              const canStart = storageReady && storedOperation === null && !hasDurableExecution
                && execution?.startAvailable === true && !startBusy[card.id];
              const retryOperation = storageReady && canOfferTaskStartRetry(storedOperation, execution, safeRetryOperationIds[card.id])
                ? storedOperation : null;
              const canRetry = retryOperation !== null && !startBusy[card.id] && !syncBusy[card.id];
              const durableReceiptId = durableExecutionReceiptId(executionReceipt);
              const canSyncDurableReceipt = storageReady && storedOperation === null && durableReceiptId !== null;
              const canContinueCreatedSession = storageReady
                && storedOperation !== null && storedOperation !== 'invalid'
                && storedOperation.status !== 'admitted'
                && storedOperation.operationId === recoverableSessionOperationIds[card.id]
                && isRecoverableNotAttemptedDispatch(executionReceipt, card.version)
                && !startBusy[card.id] && !syncBusy[card.id];
              const activeControlReceipts = (card.taskExecutionHistory ?? []).filter(receipt => {
                const active = ['running', 'waiting'].includes(receipt.phase);
                const stopped = receipt.phase === 'stopped' && latestSessionStopControl(receipt)?.phase === 'accepted';
                const exactTurn = !!receipt.nativeTurnId;
                const exactInput = !!receipt.nativeInputMessageId && /^msg_[A-Za-z0-9_-]{8,256}$/.test(receipt.nativeInputMessageId)
                  && !!receipt.nativeDispatchJobId && /^job_[a-f0-9]{64}$/.test(receipt.nativeDispatchJobId)
                  && !!receipt.projectBinding && receipt.projectBinding.harness === 'opencode'
                  && receipt.projectBinding.hostId === receipt.hostId;
                return (active || stopped) && (exactTurn || exactInput);
              });
              const controlReceipt = activeControlReceipts.length === 1 && activeControlReceipts[0]?.harness === 'opencode'
                && activeControlReceipts[0].nativeSessionId && activeControlReceipts[0].hostId ? activeControlReceipts[0] : undefined;
              const currentStop = latestSessionStopControl(controlReceipt);
              const explicitResume = controlReceipt?.phase === 'stopped' && currentStop?.phase === 'accepted';
              const controlHashKey = controlReceipt ? `${card.id}:${controlReceipt.operationId}` : card.id;
              const directDraftHash = sessionControlHashes[controlHashKey];
              const directControlKey = controlReceipt && directDraftHash
                ? `${card.id}:${controlReceipt.operationId}:direct:${directDraftHash}` : '';
              const stopEpoch = sessionControlStopEpoch(controlReceipt);
              const stopControlKey = controlReceipt && stopEpoch ? `${card.id}:${controlReceipt.operationId}:stop:${stopEpoch}` : '';
              const existingDirect = controlReceipt && directDraftHash
                ? controlReceipt.sessionControls?.direct?.find(item => item.requestHash === directDraftHash) : undefined;
              const directPhase = existingDirect?.phase ?? (directControlKey ? sessionControlPhase[directControlKey] : undefined);
              const stopPhase = hasStopReceiptForCurrentEpoch(controlReceipt)
                ? currentStop?.phase : (stopControlKey ? sessionControlPhase[stopControlKey] : undefined);
              const taskFollowUp = executionReceipt?.continuations?.[0];
              const canSyncTaskFollowUp = taskFollowUp?.phase === 'running'
                && (!!taskFollowUp.nativeTurnId || executionReceipt?.harness === 'opencode'
                  && !!taskFollowUp.nativeDispatchJobId && /^job_[a-f0-9]{64}$/.test(taskFollowUp.nativeDispatchJobId)
                  && !!taskFollowUp.nativeInputMessageId && /^msg_[A-Za-z0-9_-]{8,256}$/.test(taskFollowUp.nativeInputMessageId));
              const confirmedRequests = confirmedTaskRequests(card);
              const canContinue = canContinueTask(card) && !startBusy[card.id] && !syncBusy[card.id];
              const column = ['inbox', 'todo', 'someday'].includes(card.column) ? 'Входящие'
                : card.column === 'blocked' ? 'В работе · блокер'
                  : DEFAULT_COLUMNS.find(item => item.id === card.column)?.title ?? card.column;
              const waitingFor = [...new Set((card.waitingFor ?? []).map(person => person.trim()).filter(Boolean))];
              const approvers = [...new Set((card.requiresApprovalFrom ?? []).map(person => person.trim()).filter(Boolean))];
              const humanWait = /человека|human decision/i.test(execution?.waitReason ?? '')
                || waitingFor.some(person => /человека|human decision/i.test(person));
              const namedWaiters = waitingFor.filter(person => !/человека|human decision/i.test(person));
              const waitLabel = card.column === 'review' && card.needsReview ? '' : humanWait
                ? approvers.join(', ') || 'проверяющий не назначен'
                : namedWaiters.join(', ');
              const nextStep = card.nextAction?.trim()
                || (card.column === 'review' && card.needsReview
                  ? approvers.length ? `Проверить результат: ${approvers.join(', ')}` : 'Проверить результат'
                  : undefined);
              const sourceUrl = card.source ? safeSourceUrl(card.source) : null;
              return (
                <article key={card.id} className="rounded-lg border bg-card p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <button type="button" onClick={() => onOpen(card)} className="min-w-0 flex-1 text-left">
                      <h3 className="font-semibold leading-snug hover:underline">{card.title}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">{card.project || 'Без проекта'} · {column}</p>
                    </button>
                    {card.column === 'review' && card.needsReview && <Button size="sm" onClick={() => onOpen(card)}>Открыть проверку</Button>}
                  </div>

                  <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-xs text-muted-foreground">Владелец карточки</dt>
                      <dd>{card.owner || 'Не назначен'}</dd>
                    </div>
                    {card.accountable && <div>
                      <dt className="text-xs text-muted-foreground">Ответственный за результат</dt>
                      <dd>{card.accountable}</dd>
                    </div>}
                    <div>
                      <dt className="text-xs text-muted-foreground">Исполнитель</dt>
                      <dd>{card.assignees.length ? card.assignees.join(', ') : card.assignee || 'Не назначен'}</dd>
                    </div>
                  </dl>

                  {(card.description.trim() || card.nextAction?.trim()) && <div className="mt-3 rounded-md bg-muted/40 p-3">
                    <CardBriefPanel card={card} compact />
                  </div>}
                  {card.column === 'blocked' && card.blockerReason && <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm"><span className="font-medium">Что мешает продолжить:</span> {card.blockerReason}</div>}

                  <div className="mt-3 rounded-md border p-3">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {execution ? <Clock3 aria-hidden className="h-4 w-4" /> : <CircleHelp aria-hidden className="h-4 w-4" />}
                      <span>Выполнение: {execution ? executionSignalLabel(execution.state) : 'статус пока не подтверждён'}</span>
                    </div>
                    {execution?.lastProgress && <p className="mt-2 text-sm"><span className="text-muted-foreground">Последняя сохранённая сводка:</span> {execution.lastProgress.summary}</p>}
                    {waitLabel && <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                      <p><span className="text-muted-foreground">Ждём:</span> {waitLabel}</p>
                      {humanWait && approvers.length === 0 && reviewerAssignmentButton(card)}
                    </div>}
                    {card.column === 'review' && card.needsReview && <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                      <p><span className="text-muted-foreground">Проверяет:</span> {approvers.join(', ') || 'проверяющий не назначен'}</p>
                      {approvers.length === 0 && reviewerAssignmentButton(card)}
                    </div>}
                    {reviewerAssignmentCardId === card.id && <form className="mt-2 max-w-lg rounded-md border bg-background p-3" onSubmit={event => { event.preventDefault(); void assignReviewer(card); }}>
                      <label htmlFor={`reviewer-${card.id}`} className="text-sm font-medium">Кто проверит?</label>
                      <Input id={`reviewer-${card.id}`} className="mt-2" aria-label="Проверяющий" list={`reviewer-options-${card.id}`} value={reviewerDraft} onChange={event => setReviewerDraft(event.target.value)} placeholder="Выбери имя или введи логин" autoComplete="off" />
                      <datalist id={`reviewer-options-${card.id}`}>{reviewerOptions.map(person => <option key={person} value={person} />)}</datalist>
                      <p className="mt-1 text-xs text-muted-foreground">Список предложен по людям, которые уже встречаются в карточках.</p>
                      {reviewerError && <p role="alert" className="mt-2 text-sm text-destructive">{reviewerError}</p>}
                      <div className="mt-3 flex gap-2">
                        <Button type="submit" size="sm" disabled={!reviewerDraft.trim() || reviewerBusy}>{reviewerBusy ? 'Назначаю…' : 'Назначить'}</Button>
                        <Button type="button" size="sm" variant="ghost" disabled={reviewerBusy} onClick={() => { setReviewerAssignmentCardId(null); setReviewerDraft(''); setReviewerError(null); }}>Отмена</Button>
                      </div>
                    </form>}
                    {execution?.waitReason && !humanWait && <p className="mt-2 text-sm"><span className="text-muted-foreground">Что мешает продолжить:</span> {execution.waitReason}</p>}
                    {execution?.nextAction && <p className="mt-2 text-sm"><span className="text-muted-foreground">Следующий шаг исполнителя:</span> {execution.nextAction}</p>}
                    {execution?.sessionUrl && isVerifiedSessionUrl(execution.sessionUrl) && <a className="mt-2 inline-flex items-center gap-1 text-sm underline" href={execution.sessionUrl} target="_blank" rel="noreferrer">Открыть сессию исполнителя <ArrowUpRight aria-hidden className="h-3.5 w-3.5" /></a>}
                    {confirmedRequests.length > 0 && <div className="mt-3 space-y-2" aria-label="Подтверждённые запросы участников">
                      {confirmedRequests.map(request => <div key={`${request.inputId}:${request.turnId}`} className="rounded-md bg-muted/40 p-3">
                        <p className="text-xs text-muted-foreground">Подтверждённый автор: {request.actor}</p>
                        <p className="mt-1 text-sm">{request.instruction}</p>
                        <a className="mt-1 inline-flex items-center gap-1 text-sm underline" href={request.sessionUrl} target="_blank" rel="noreferrer">Открыть точный ход в истории <ArrowUpRight aria-hidden className="h-3.5 w-3.5" /></a>
                      </div>)}
                    </div>}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => onOpen(card)}>
                        <Pencil aria-hidden className="mr-1 h-3.5 w-3.5" />Изменить
                      </Button>
                      <Button size="sm" disabled={!canStart} onClick={() => void startTask(card)}>
                        <Play aria-hidden className="mr-1 h-3.5 w-3.5" />
                        {startBusy[card.id] ? 'Запуск…' : 'Запустить задачу'}
                      </Button>
                      {canContinueCreatedSession && executionReceipt && <Button size="sm" variant="outline"
                        disabled={startBusy[card.id] || syncBusy[card.id]}
                        onClick={() => void continueStoppedSession(card, executionReceipt)}>
                        Продолжить эту сессию
                      </Button>}
                      {storedOperation === 'invalid' && <p role="status" className="text-sm text-destructive">Сохранённая запись запуска повреждена; повторная отправка отключена.</p>}
                      {storedOperation && storedOperation !== 'invalid' && <p role="status" className="text-sm text-muted-foreground">
                        {syncBusy[card.id]
                          ? 'Проверяю результат этого запуска…'
                          : startBusy[card.id]
                          ? 'Отправляю один запрос запуска…'
                          : startMessages[card.id] ?? (storedOperation.status === 'admitted'
                          ? 'Запуск принят. Повторная отправка отключена; ждём сохранённый результат.'
                          : 'Исход запуска не подтверждён. Повторная отправка отключена.')}
                      </p>}
                      {storedOperation && storedOperation !== 'invalid' && <Button size="sm" variant="outline" disabled={startBusy[card.id] || syncBusy[card.id]} onClick={() => void syncResult(card, storedOperation)}>
                        {syncBusy[card.id] ? 'Проверяю…' : 'Проверить результат'}
                      </Button>}
                      {canSyncDurableReceipt && durableReceiptId && <>
                        <p role="status" className="text-sm text-muted-foreground">Найдена сохранённая квитанция запуска. Проверка не создаёт новый запуск.</p>
                        <Button size="sm" variant="outline" disabled={startBusy[card.id] || syncBusy[card.id]}
                          onClick={() => void syncResult(card, { operationId: durableReceiptId, status: 'unknown' })}>
                          {syncBusy[card.id] ? 'Проверяю…' : 'Проверить результат'}
                        </Button>
                      </>}
                      {canRetry && retryOperation && <Button size="sm" variant="outline" disabled={startBusy[card.id] || syncBusy[card.id]} onClick={() => void startTask(card, retryOperation)}>
                        Повторить с тем же ключом
                      </Button>}
                      {!storedOperation && execution?.startAvailable === false && execution.unavailableReason && <p className="text-sm text-muted-foreground">{execution.unavailableReason}</p>}
                      {!storedOperation && hasDurableExecution && <p role="status" className="text-sm text-muted-foreground">Для карточки уже сохранена квитанция сессии. Новый запуск отключён; продолжайте эту сессию ниже.</p>}
                      {!storedOperation && execution && execution.startAvailable === undefined && <p className="text-sm text-muted-foreground">Готовность к запуску пока не подтверждена.</p>}
                      {!storedOperation && !execution && <p className="text-sm text-muted-foreground">Проверяем доступность запуска…</p>}
                      {!storedOperation && startMessages[card.id] && <p role="status" className="text-sm text-muted-foreground">{startMessages[card.id]}</p>}
                      {controlReceipt && <div className="w-full rounded-md border p-3">
                        <p className="text-sm font-medium">{explicitResume ? 'Продолжение остановленной OpenCode-сессии' : 'Управление активной OpenCode-сессией'}</p>
                        <label htmlFor={`session-direct-${card.id}`} className="mt-2 block text-xs text-muted-foreground">{explicitResume ? 'Явное задание на продолжение' : 'Сообщение после текущего ответа'}</label>
                        <textarea id={`session-direct-${card.id}`} className="mt-1 min-h-20 w-full rounded-md border bg-background p-2 text-sm"
                          maxLength={4000} value={sessionControlText[card.id] ?? ''}
                          disabled={sessionControlBusy[directControlKey]}
                          onChange={event => {
                            const value = event.target.value;
                            setSessionControlText(previous => ({ ...previous, [card.id]: value }));
                            setSessionControlHashes(previous => ({ ...previous, [controlHashKey]: undefined }));
                            const sequence = (sessionControlDraftSequence.current[controlHashKey] ?? 0) + 1;
                            sessionControlDraftSequence.current[controlHashKey] = sequence;
                            if (!controlReceipt || !value.trim()) {
                              return;
                            }
                            void sessionControlRequestHash(card.id, controlReceipt.operationId, 'direct', value.trim()).then(hash => {
                              if (sessionControlDraftSequence.current[controlHashKey] === sequence) {
                                setSessionControlHashes(previous => ({ ...previous, [controlHashKey]: hash }));
                              }
                            }).catch(() => {
                              if (sessionControlDraftSequence.current[controlHashKey] === sequence) {
                                setSessionControlHashes(previous => ({ ...previous, [controlHashKey]: undefined }));
                              }
                            });
                          }}
                          placeholder={explicitResume ? 'Продолжить эту задачу и подготовить ответ для проверки' : 'Коротко укажите следующий шаг после ответа'} />
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" disabled={!sessionControlText[card.id]?.trim() || !directDraftHash
                            || sessionControlBusy[directControlKey] || !!existingDirect || !!directPhase}
                            onClick={() => void controlSession(card, 'direct')}>
                            {sessionControlBusy[directControlKey] ? 'Передаю…' : explicitResume ? 'Продолжить в той же сессии' : 'Поставить после ответа'}
                          </Button>
                          <Button size="sm" variant="outline" disabled={explicitResume || sessionControlBusy[stopControlKey]
                            || !!stopPhase}
                            onClick={() => void controlSession(card, 'stop')}>
                            {sessionControlBusy[stopControlKey] ? 'Останавливаю…' : 'Остановить исполнителя'}
                          </Button>
                        </div>
                        {directPhase && <p role="status" className="mt-2 text-xs text-muted-foreground">Передача: {directPhase === 'accepted'
                          ? 'задание принято в очередь той же сессии.' : directPhase === 'intent'
                            ? 'запрос записан; не отправляйте это сообщение повторно.' : 'исход неизвестен; это сообщение нельзя повторять.'}</p>}
                        {stopPhase && <p role="status" className="mt-2 text-xs text-muted-foreground">Остановка: {stopPhase === 'accepted'
                          ? 'команда принята; сверьте состояние карточки.' : stopPhase === 'intent'
                            ? 'действие уже записано; не отправляйте его повторно.' : 'исход неизвестен; команду повторять нельзя.'}</p>}
                        {(controlReceipt.sessionControls?.direct?.length ?? 0) > 0 && !directPhase
                          && <p className="mt-2 text-xs text-muted-foreground">Ранее передано отдельных сообщений: {controlReceipt.sessionControls?.direct?.length}.</p>}
                      </div>}
                      {canContinue && <div className="w-full rounded-md border p-3">
                        <label htmlFor={`task-follow-up-${card.id}`} className="text-sm font-medium">Уточнение исполнителю</label>
                        <textarea id={`task-follow-up-${card.id}`} className="mt-2 min-h-24 w-full rounded-md border bg-background p-2 text-sm"
                          maxLength={4000} value={followUpText[card.id] ?? ''} disabled={startBusy[card.id] || syncBusy[card.id]}
                          onChange={event => setFollowUpText(previous => ({ ...previous, [card.id]: event.target.value }))}
                          placeholder="Добавьте конкретное продолжение этой задачи" />
                        <Button size="sm" variant="outline" className="mt-2" disabled={!canContinue || !followUpText[card.id]?.trim()} onClick={() => void continueTask(card)}>
                          {startBusy[card.id] ? 'Передаю…' : 'Продолжить'}
                        </Button>
                      </div>}
                      {taskFollowUp && <div className="w-full rounded-md bg-muted/40 p-3" data-continuation-id={taskFollowUp.id}>
                        <p className="text-xs font-medium text-muted-foreground">Уточнение: {taskFollowUp.instruction} · {taskFollowUp.phase === 'result' ? 'результат сохранён' : taskFollowUp.phase === 'running' ? 'выполняется' : taskFollowUp.phase === 'intent' ? 'запрос отправляется; повторная отправка отключена' : 'не удалось подтвердить, принят ли запрос; повторять его нельзя'}</p>
                        {taskFollowUp.summary && <p className="mt-2 whitespace-pre-wrap text-sm">{taskFollowUp.summary}</p>}
                        {taskFollowUp.evidenceRefs?.map(url => <a key={url} href={safeSourceUrl(url) ?? undefined} className="mt-1 block break-all text-xs underline" target="_blank" rel="noreferrer">{url}</a>)}
                        {canSyncTaskFollowUp && <Button size="sm" variant="outline" className="mt-2" disabled={syncBusy[card.id] || startBusy[card.id]} onClick={() => void syncTaskFollowUp(card, taskFollowUp.id)}>
                          {syncBusy[card.id] ? 'Проверяю…' : 'Проверить продолжение'}
                        </Button>}
                      </div>}
                    </div>
                  </div>

                  {result && <div className="mt-3 border-l-2 pl-3">
                    <p className="text-xs font-medium text-muted-foreground">Последний сохранённый результат</p>
                    <p className="mt-1 text-sm">{result.summary}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Сохранён {formatDate(result.submittedAt)}{result.evidenceRefs.length ? ` · подтверждений: ${result.evidenceRefs.length}` : ''}</p>
                  </div>}

                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                    {nextStep && <p><span className="text-muted-foreground">Следующий шаг:</span> {nextStep}</p>}
                    {card.dueAt && <p><span className="text-muted-foreground">Срок задачи:</span> {formatDate(card.dueAt)}</p>}
                    {sourceUrl && <a className="inline-flex items-center gap-1 underline" href={sourceUrl} target="_blank" rel="noreferrer">Источник <ArrowUpRight aria-hidden className="h-3.5 w-3.5" /></a>}
                    {(card.resultHistory?.length ?? 0) > 0 && <button type="button" className="underline" onClick={() => onOpen(card)}>Результат и история проверки</button>}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return <div className="min-w-0 rounded-lg border p-1.5 sm:p-3"><p className="text-[10px] leading-tight text-muted-foreground sm:text-xs">{label}</p><p className="mt-0.5 text-base font-semibold sm:mt-1 sm:text-xl">{value}</p></div>;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ru-RU');
}
