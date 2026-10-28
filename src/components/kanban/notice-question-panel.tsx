'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { KanbanCard } from '@/lib/kanban/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { executionOperationStorageKey, parseStoredStartOperation, type StoredStartOperation } from './integrator-dashboard-model';
import { ExecutorQuestionDetails, answerQuestionRequest, executorQuestionFeedback, QuestionDetails } from './notice-question-display';
import {
  isTaskQuestionOwner,
  canCreateTaskQuestion,
  canAnswerTaskQuestion,
  matchesTaskExecutionOperation,
  parseTaskQuestion,
  taskQuestionCreateRequest,
  taskQuestionStateLabel,
  taskQuestionTimestamp,
  type TaskQuestionRead,
  type TaskQuestionView,
} from './notice-question-model';

type Props = { card: KanbanCard; open: boolean; username: string | null; onRefresh?: () => Promise<unknown> | void };
type PanelState = 'loading' | 'none' | 'unknown' | 'not-found' | 'ready' | 'unavailable' | 'stale' | 'denied' | 'error';

function questionReadState(value: unknown): TaskQuestionRead {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('taskQuestion' in value)) return { kind: 'invalid' };
  return parseTaskQuestion((value as { taskQuestion: unknown }).taskQuestion);
}

function statusForRead(value: TaskQuestionRead): PanelState {
  return value.kind === 'none' ? 'none'
    : value.kind === 'unknown' ? 'unknown'
      : value.kind === 'not-found' ? 'not-found'
        : value.kind === 'ready' ? 'ready' : 'error';
}

function safeErrorState(status: number): PanelState {
  if (status === 401) return 'denied';
  if (status === 403) return 'denied';
  if (status === 409) return 'stale';
  if (status === 503) return 'unavailable';
  return 'error';
}

function safeErrorText(state: PanelState): string {
  return ({
    denied: 'Сервер отказал в доступе к вопросу. Проверьте текущую авторизацию и назначение задачи.',
    stale: 'Карточка или запуск изменились. Обновите список и откройте карточку заново; вопрос повторно не отправлялся.',
    unavailable: 'Канал вопросов сейчас не настроен или недоступен. Отправка не подтверждена.',
    error: 'Не удалось безопасно подтвердить состояние вопроса. Новый вопрос не отправлялся.',
  } as Record<string, string>)[state] ?? '';
}

export function NoticeQuestionPanel({ card, open, username, onRefresh }: Props) {
  const owner = isTaskQuestionOwner(card, username);
  const latest = card.taskExecutionHistory?.at(-1);
  const executorQuestion = latest?.executorQuestion;
  const [panelState, setPanelState] = useState<PanelState>('loading');
  const [view, setView] = useState<TaskQuestionView | null>(null);
  const [storedOperation, setStoredOperation] = useState<StoredStartOperation | null | 'invalid'>(null);
  const [operationMatchesReceipt, setOperationMatchesReceipt] = useState(false);
  const [purpose, setPurpose] = useState('clarification');
  const [message, setMessage] = useState('');
  const [firstChoice, setFirstChoice] = useState('Вариант 1');
  const [secondChoice, setSecondChoice] = useState('Вариант 2');
  const [timeoutValue, setTimeoutValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [answerBusy, setAnswerBusy] = useState(false);
  const [answerAttemptedOperationId, setAnswerAttemptedOperationId] = useState<string | null>(null);
  const [answerFeedbackFallback, setAnswerFeedbackFallback] = useState<'accepted' | 'unknown' | 'declined' | 'pending' | 'timeout' | null>(null);
  const [readBusy, setReadBusy] = useState(false);
  const [creationHeld, setCreationHeld] = useState(false);
  const creationHeldRef = useRef(false);

  const readLatest = useCallback(async (cancelled?: () => boolean) => {
    setReadBusy(true);
    try {
      const response = await fetch(`/api/kanban/cards/${encodeURIComponent(card.id)}/execution?question=latest`, { cache: 'no-store' });
      const body: unknown = await response.json().catch(() => null);
      if (cancelled?.()) return;
      if (!response.ok && response.status !== 202) {
        setView(null);
        setPanelState(safeErrorState(response.status));
        return;
      }
      const parsed = questionReadState(body);
      setView(parsed.kind === 'ready' ? parsed.view : null);
      setPanelState(parsed.kind === 'none' && creationHeldRef.current ? 'stale' : statusForRead(parsed));
    } catch {
      if (!cancelled?.()) {
        setView(null);
        setPanelState('unknown');
      }
    } finally {
      if (!cancelled?.()) setReadBusy(false);
    }
  }, [card.id]);

  useEffect(() => {
    let cancelled = false;
    setView(null);
    setStoredOperation(null);
    setOperationMatchesReceipt(false);
    setPurpose('clarification');
    setMessage('');
    setFirstChoice('Вариант 1');
    setSecondChoice('Вариант 2');
    setTimeoutValue('');
    setBusy(false);
    setReadBusy(false);
    creationHeldRef.current = false;
    setCreationHeld(false);
    if (!open) return () => { cancelled = true; };
    if (!username) {
      setPanelState('denied');
      return () => { cancelled = true; };
    }
    if (!owner) {
      setPanelState('denied');
      return () => { cancelled = true; };
    }
    try {
      const stored = parseStoredStartOperation(window.localStorage.getItem(executionOperationStorageKey(card.id)));
      setStoredOperation(stored);
      if (stored && stored !== 'invalid' && latest) {
        void matchesTaskExecutionOperation(card.id, latest.operationId, stored.operationId)
          .then(matches => { if (!cancelled) setOperationMatchesReceipt(matches); })
          .catch(() => { if (!cancelled) setOperationMatchesReceipt(false); });
      }
    } catch {
      setStoredOperation('invalid');
    }
    setPanelState('loading');
    void readLatest(() => cancelled);
    return () => { cancelled = true; };
  }, [card.id, card.version, open, owner, readLatest, username]);

  const operation = storedOperation && storedOperation !== 'invalid' ? storedOperation : null;
  const eligible = !creationHeld && canCreateTaskQuestion(card, username, operation, operationMatchesReceipt);
  const choices = useMemo(() => [
    { value: 'choice-1', label: firstChoice.trim() },
    { value: 'choice-2', label: secondChoice.trim() },
  ], [firstChoice, secondChoice]);
  const canSubmit = eligible && panelState === 'none' && Boolean(purpose.trim()) && Boolean(message.trim())
    && choices.every(choice => Boolean(choice.label)) && Boolean(timeoutValue) && !busy;
  const readbackMatchesExecutorQuestion = Boolean(view && executorQuestion && latest?.taskDecisionRequest
    && view.requestId === latest.taskDecisionRequest.requestId
    && view.question.text === executorQuestion.text
    && view.question.choices.length === executorQuestion.choices.length
    && view.question.choices.every((choice, index) => choice.value === executorQuestion.choices[index]?.value
      && choice.label === executorQuestion.choices[index]?.label));
  const answerFeedback = executorQuestionFeedback(view, answerFeedbackFallback ?? undefined);
  const canAnswer = panelState === 'ready' && readbackMatchesExecutorQuestion
    && canAnswerTaskQuestion(card, username, view) && latest !== undefined
    && answerAttemptedOperationId !== latest.operationId && !answerBusy;

  async function readCurrentQuestion() {
    await readLatest();
    await Promise.resolve(onRefresh?.()).catch(() => undefined);
  }

  async function answerExecutorQuestion(value: string) {
    if (!canAnswer || !latest) return;
    const body = answerQuestionRequest({ expectedVersion: card.version, operationId: latest.operationId, value });
    if (!body) return;
    setAnswerAttemptedOperationId(latest.operationId);
    setAnswerFeedbackFallback(null);
    setAnswerBusy(true);
    try {
      const response = await fetch(`/api/kanban/cards/${encodeURIComponent(card.id)}/execution`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result: unknown = await response.json().catch(() => null);
      const record = result && typeof result === 'object' && !Array.isArray(result)
        ? result as Record<string, unknown> : undefined;
      const parsed = record ? questionReadState({ taskQuestion: record.taskQuestion }) : { kind: 'invalid' as const };
      const nextView = parsed.kind === 'ready' ? parsed.view : null;
      if (nextView && nextView.requestId === latest.taskDecisionRequest?.requestId) setView(nextView);
      const wireStatus = typeof record?.answerStatus === 'string' ? record.answerStatus : undefined;
      const feedback = executorQuestionFeedback(nextView, wireStatus);
      if (response.status === 200 || response.status === 202) {
        setAnswerFeedbackFallback(feedback ?? (response.status === 202 ? 'unknown' : 'pending'));
        setPanelState(nextView ? 'ready' : 'unknown');
      } else {
        setAnswerFeedbackFallback('declined');
        setPanelState(response.status === 409 ? 'stale' : safeErrorState(response.status));
      }
      await Promise.resolve(onRefresh?.()).catch(() => undefined);
      // Any ambiguous or declined response is followed only by a read. This path never retries the answer.
      if (response.status !== 200 || feedback !== 'accepted') await readLatest();
    } catch {
      setAnswerFeedbackFallback('unknown');
      setPanelState('unknown');
      await readLatest();
    } finally {
      setAnswerBusy(false);
    }
  }

  async function createQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || !operation) return;
    setBusy(true);
    setPanelState('loading');
    try {
      const response = await fetch(`/api/kanban/cards/${encodeURIComponent(card.id)}/execution`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(taskQuestionCreateRequest({
          expectedVersion: card.version,
          operationId: operation.operationId,
          purpose,
          message,
          choices,
          timeoutValue,
        })),
      });
      const body: unknown = await response.json().catch(() => null);
      if (response.status === 200 || response.status === 201) {
        const parsed = questionReadState(body);
        setView(parsed.kind === 'ready' ? parsed.view : null);
        setPanelState(parsed.kind === 'ready' ? 'ready' : 'unknown');
        if (parsed.kind !== 'ready') setPanelState('unknown');
        await Promise.resolve(onRefresh?.()).catch(() => undefined);
      } else if (response.status === 202) {
        setView(null);
        setPanelState('unknown');
      } else {
        setView(null);
        setPanelState(safeErrorState(response.status));
        if (response.status === 409) {
          creationHeldRef.current = true;
          setCreationHeld(true);
          await Promise.resolve(onRefresh?.()).catch(() => undefined);
        }
      }
    } catch {
      setView(null);
      setPanelState('unknown');
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;
  if (!owner) return (
    <section className="space-y-2 rounded-md border p-3" aria-label="Вопрос по задаче">
      <h3 className="text-sm font-medium">Вопрос исполнителю</h3>
      <p className="text-sm text-muted-foreground">Вопрос доступен только текущему владельцу или исполнителю задачи.</p>
    </section>
  );

  return (
    <section className="space-y-3 rounded-md border p-3" aria-label="Вопрос по задаче">
      <div>
        <h3 className="text-sm font-medium">Вопрос исполнителю</h3>
        <p className="text-xs text-muted-foreground">{executorQuestion
          ? 'Показывается сохранённый вопрос текущего запуска. Открытие и обновление карточки ничего не отправляют.'
          : 'Вопрос создаётся только после явного подтверждения. Открытие и обновление карточки ничего не отправляют.'}</p>
      </div>

      {panelState === 'loading' && <p role="status" className="text-sm text-muted-foreground">Читаю сохранённый статус вопроса…</p>}
      {executorQuestion && <ExecutorQuestionDetails
        text={executorQuestion.text}
        choices={executorQuestion.choices}
        waitingReason={latest?.phase === 'waiting' ? latest.lastProgress || 'Исполнитель ожидает выбранный вариант ответа.' : null}
        feedback={answerFeedback}
        busy={answerBusy}
        canAnswer={canAnswer}
        readBusy={readBusy}
        executionPhase={latest?.phase ?? 'unknown'}
        executionReceiptPresent={Boolean(latest?.createReceiptText || latest?.dispatchReceiptText)}
        continuations={latest?.continuations ?? []}
        continuation={view?.continuation}
        onAnswer={value => void answerExecutorQuestion(value)}
        onRefreshRead={() => void readCurrentQuestion()}
      />}
      {panelState === 'ready' && view && !executorQuestion && <>
        <QuestionDetails view={view} />
        <Button type="button" size="sm" variant="outline" disabled={readBusy} onClick={() => void readCurrentQuestion()}>{readBusy ? 'Проверяю…' : 'Обновить статус вопроса (только чтение)'}</Button>
      </>}
      {panelState === 'none' && !eligible && <p className="text-sm text-muted-foreground">{card.column === 'blocked'
        ? 'Сначала укажи, что блокирует задачу, и верни её в работу. Сейчас активной сессии нет.'
        : card.needsReview || card.column === 'review'
          ? 'Задача ждёт приёмки. Вопрос можно задать после следующего запуска; сейчас активной сессии нет.'
          : 'Сначала запусти задачу. Сейчас нет подтверждённой активной сессии, куда можно отправить вопрос.'}</p>}
      {panelState === 'none' && eligible && !executorQuestion && <form className="space-y-3" onSubmit={event => void createQuestion(event)}>
        <Input aria-label="Назначение вопроса" value={purpose} onChange={event => setPurpose(event.target.value)} maxLength={128} required />
        <Textarea aria-label="Текст вопроса" value={message} onChange={event => setMessage(event.target.value)} maxLength={4000} rows={3} required placeholder="Что нужно уточнить у исполнителя?" />
        <div className="grid gap-2 sm:grid-cols-2">
          <Input aria-label="Первый вариант ответа" value={firstChoice} onChange={event => setFirstChoice(event.target.value)} maxLength={256} required />
          <Input aria-label="Второй вариант ответа" value={secondChoice} onChange={event => setSecondChoice(event.target.value)} maxLength={256} required />
        </div>
        <label className="block space-y-1 text-xs text-muted-foreground">
          <span>Вариант при истечении срока</span>
          <select aria-label="Вариант при истечении срока" className="h-9 w-full rounded-md border bg-background px-2 text-sm text-foreground" value={timeoutValue} onChange={event => setTimeoutValue(event.target.value)} required>
            <option value="">Выберите вариант</option>
            {choices.filter(choice => choice.label).map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
          </select>
        </label>
        <p className="text-xs text-muted-foreground">Таймаут фиксирует выбранный вариант ответа; он сам по себе не останавливает и не возобновляет задачу.</p>
        <Button type="submit" disabled={!canSubmit}>{busy ? 'Отправляю один запрос…' : 'Задать вопрос'}</Button>
      </form>}
      {(panelState === 'unknown' || panelState === 'not-found') && <div className="space-y-2" role="status">
        <p className="text-sm text-muted-foreground">{panelState === 'not-found'
          ? 'Сохранённая ссылка на вопрос есть, но Notice сейчас его не находит. Повторное создание отключено.'
          : 'Результат вопроса не подтверждён. Повторная отправка отключена; можно выполнить только чтение статуса.'}</p>
        <Button type="button" size="sm" variant="outline" disabled={readBusy} onClick={() => void readCurrentQuestion()}>{readBusy ? 'Проверяю…' : 'Проверить статус (только чтение)'}</Button>
      </div>}
      {['unavailable', 'stale', 'denied', 'error'].includes(panelState) && <div className="space-y-2">
        <p role="alert" className="text-sm text-destructive">{safeErrorText(panelState)}</p>
        <Button type="button" size="sm" variant="outline" disabled={readBusy} onClick={() => void readCurrentQuestion()}>{readBusy ? 'Проверяю…' : 'Повторить только чтение'}</Button>
      </div>}
      <p className="text-xs text-muted-foreground">Подтверждение ответа, таймаут и отправка уведомления показываются отдельно. Команды остановки/паузы и их подтверждения через эту панель недоступны.</p>
    </section>
  );
}
