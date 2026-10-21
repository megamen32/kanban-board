'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, CircleHelp, Clock3, Play } from 'lucide-react';
import type { KanbanCard } from '@/lib/kanban/types';
import { Button } from '@/components/ui/button';
import { DEFAULT_COLUMNS } from '@/lib/kanban/types';
import {
  canRetrySameOperation,
  canContinueTask,
  confirmedTaskRequests,
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
type Props = { cards: KanbanCard[]; onOpen: (card: KanbanCard) => void; onRefresh: () => Promise<unknown> | void };

function safeSourceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch { return null; }
}

export function IntegratorTaskDashboard({ cards, onOpen, onRefresh }: Props) {
  const [executions, setExecutions] = useState<Record<string, ExecutionSnapshot | null>>({});
  const [storedOperations, setStoredOperations] = useState<Record<string, StoredOperationState>>({});
  const [storageLoadedFor, setStorageLoadedFor] = useState<string | null>(null);
  const [startBusy, setStartBusy] = useState<Record<string, boolean>>({});
  const [syncBusy, setSyncBusy] = useState<Record<string, boolean>>({});
  const [startMessages, setStartMessages] = useState<Record<string, string>>({});
  const [followUpText, setFollowUpText] = useState<Record<string, string>>({});
  const inFlightStarts = useRef(new Set<string>());
  const inFlightSyncs = useRef(new Set<string>());
  const counts = getDashboardCounts(cards);
  const cardIdsKey = cards.map(card => card.id).sort().join('\0');

  function writeOperation(cardId: string, operation: StoredStartOperation): boolean {
    try {
      window.localStorage.setItem(executionOperationStorageKey(cardId), JSON.stringify(operation));
      setStoredOperations(previous => ({ ...previous, [cardId]: operation }));
      return true;
    } catch {
      return false;
    }
  }

  const clearOperation = useCallback((cardId: string) => {
    try {
      window.localStorage.removeItem(executionOperationStorageKey(cardId));
      setStoredOperations(previous => ({ ...previous, [cardId]: null }));
      setStartMessages(previous => {
        if (!Object.hasOwn(previous, cardId)) return previous;
        const next = { ...previous };
        delete next[cardId];
        return next;
      });
    } catch {
      // Keep the existing record and fail closed if browser storage is unavailable.
    }
  }, []);

  async function startTask(card: KanbanCard, retryOperation?: StoredStartOperation) {
    if (inFlightStarts.current.has(card.id)) return;
    const prior = storedOperations[card.id];
    if (retryOperation && (!canRetrySameOperation(prior, executions[card.id])
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

      if (response.status === 201 || response.status === 200) {
        writeOperation(card.id, { operationId, status: 'admitted' });
        setStartMessages(previous => ({ ...previous, [card.id]: 'Запуск принят. Повторная отправка отключена; результат появится после сохранения сервером.' }));
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

  return (
    <section aria-labelledby="integrator-dashboard-title" className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="space-y-1">
          <h2 id="integrator-dashboard-title" className="text-xl font-semibold">Обзор задач</h2>
          <p className="text-sm text-muted-foreground">Задачи, исполнители и следующий шаг.</p>
        </header>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Summary label="Активные задачи" value={counts.active} />
          <Summary label="Ждут проверки" value={counts.review} />
          <Summary label="Заблокированы" value={counts.blocked} />
          <Summary label="С сохранённым результатом" value={counts.withResults} />
        </div>

        {cards.length === 0 ? <p className="rounded-lg border p-6 text-sm text-muted-foreground">В текущем фильтре нет активных задач.</p> : (
          <div className="space-y-3">
            {cards.map(card => {
              const result = getLatestResult(card);
              const execution = executions[card.id];
              const storedOperation = storedOperations[card.id];
              const storageReady = storageLoadedFor === cardIdsKey && Object.hasOwn(storedOperations, card.id);
              const canStart = storageReady && storedOperation === null && execution?.startAvailable === true && !startBusy[card.id];
              const retryOperation = storageReady && canRetrySameOperation(storedOperation, execution) ? storedOperation : null;
              const canRetry = retryOperation !== null && !startBusy[card.id] && !syncBusy[card.id];
              const executionReceipt = card.taskExecutionHistory?.at(-1);
              const taskFollowUp = executionReceipt?.continuations?.[0];
              const confirmedRequests = confirmedTaskRequests(card);
              const canContinue = canContinueTask(card) && !startBusy[card.id] && !syncBusy[card.id];
              const column = DEFAULT_COLUMNS.find(item => item.id === card.column)?.title ?? card.column;
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

                  <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-xs text-muted-foreground">Ответственный за задачу</dt>
                      <dd>{card.accountable || card.owner || 'Не указан'}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Исполнитель</dt>
                      <dd>{card.assignees.length ? card.assignees.join(', ') : card.assignee || 'Не указан'}</dd>
                    </div>
                  </dl>

                    {card.description.trim() && <div className="mt-3 rounded-md bg-muted/40 p-3">
                    <p className="text-xs font-medium text-muted-foreground">Описание и ожидаемый результат</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{card.description}</p>
                  </div>}

                  <div className="mt-3 rounded-md border p-3">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {execution ? <Clock3 aria-hidden className="h-4 w-4" /> : <CircleHelp aria-hidden className="h-4 w-4" />}
                      <span>Сигнал исполнения по сохранённым данным: {execution ? executionSignalLabel(execution.state) : 'Нет доступного подтверждённого статуса'}</span>
                    </div>
                    {execution?.lastProgress && <p className="mt-2 text-sm"><span className="text-muted-foreground">Последняя сохранённая сводка:</span> {execution.lastProgress.summary}</p>}
                    {execution?.waitReason && <p className="mt-2 text-sm"><span className="text-muted-foreground">Причина ожидания:</span> {execution.waitReason}</p>}
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
                      <Button size="sm" disabled={!canStart} onClick={() => void startTask(card)}>
                        <Play aria-hidden className="mr-1 h-3.5 w-3.5" />
                        {startBusy[card.id] ? 'Запуск…' : 'Запустить задачу'}
                      </Button>
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
                      {canRetry && retryOperation && <Button size="sm" variant="outline" disabled={startBusy[card.id] || syncBusy[card.id]} onClick={() => void startTask(card, retryOperation)}>
                        Повторить с тем же ключом
                      </Button>}
                      {!storedOperation && execution?.startAvailable === false && execution.unavailableReason && <p className="text-sm text-muted-foreground">{execution.unavailableReason}</p>}
                      {!storedOperation && execution && execution.startAvailable === undefined && <p className="text-sm text-muted-foreground">Готовность к запуску пока не подтверждена.</p>}
                      {!storedOperation && !execution && <p className="text-sm text-muted-foreground">Проверяем доступность запуска…</p>}
                      {!storedOperation && startMessages[card.id] && <p role="status" className="text-sm text-muted-foreground">{startMessages[card.id]}</p>}
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
                        {taskFollowUp.phase === 'running' && taskFollowUp.nativeTurnId && <Button size="sm" variant="outline" className="mt-2" disabled={syncBusy[card.id] || startBusy[card.id]} onClick={() => void syncTaskFollowUp(card, taskFollowUp.id)}>
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
                    <p><span className="text-muted-foreground">Следующий шаг по карточке:</span> {card.nextAction || card.waitingFor?.join(', ') || (card.column === 'review' && card.needsReview ? 'Нужно решение проверяющего' : 'Не указан')}</p>
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
  return <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold">{value}</p></div>;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ru-RU');
}
