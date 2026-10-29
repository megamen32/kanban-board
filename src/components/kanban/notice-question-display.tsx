import type { TaskQuestionView } from './notice-question-model';
import { taskQuestionStateLabel, taskQuestionTimestamp } from './notice-question-model';

export type ExecutorQuestionChoice = { value: string; label: string };
export type ExecutorQuestionFeedback = 'accepted' | 'unknown' | 'declined' | 'pending' | 'timeout' | null;

export function answerQuestionRequest(input: {
  expectedVersion: number;
  operationId: string;
  value: string;
}) {
  if (!Number.isSafeInteger(input.expectedVersion) || !/^[a-f0-9]{64}$/.test(input.operationId)
      || !input.value.trim() || input.value.length > 128) return null;
  return {
    action: 'answer-question' as const,
    expectedVersion: input.expectedVersion,
    operationId: input.operationId,
    value: input.value,
  };
}

export function executorQuestionFeedback(view: TaskQuestionView | null, fallback?: string): ExecutorQuestionFeedback {
  const status = view?.answerStatus ?? fallback;
  if (status === 'accepted' || status === 'duplicate') return 'accepted';
  if (status === 'unknown') return 'unknown';
  if (status === 'conflict' || status === 'control_requested' || status === 'no_accept') return 'declined';
  if (status === 'pending') return 'pending';
  if (status === 'timeout' || view?.decision?.source === 'timeout') return 'timeout';
  if (view?.decision?.source === 'human') return 'accepted';
  return null;
}

const answerFeedbackText: Record<Exclude<ExecutorQuestionFeedback, null>, string> = {
  accepted: 'Ответ принят Notice. Продолжение задачи и его результат подтверждаются отдельно.',
  unknown: 'Исход ответа неизвестен. Повторно не отправляйте его; можно только перечитать состояние.',
  declined: 'Ответ не принят или действие отклонено. Повторная отправка отключена.',
  pending: 'Ответ пока не подтверждён. Можно только перечитать состояние.',
  timeout: 'Срок вопроса истёк. Показан итог таймаута; ответ повторно отправить нельзя.',
};

function executionPhaseLabel(phase: string): string {
  return ({
    intent: 'запуск подготавливается',
    'create-unknown': 'исход запуска неизвестен',
    created: 'сессия создана',
    'dispatch-unknown': 'исход передачи задачи неизвестен',
    running: 'задача выполняется',
    waiting: 'ожидается ответ',
    stopped: 'задача остановлена',
    result: 'получен результат',
    unknown: 'исход продолжения неизвестен',
  } as Record<string, string>)[phase] ?? 'состояние задачи обновляется';
}

function continuationState(continuation: Record<string, unknown>): string | null {
  const status = continuation.status ?? continuation.state ?? continuation.phase;
  return typeof status === 'string' && status.length <= 80 ? status : null;
}

function continuationSummary(continuation: Record<string, unknown>): string | null {
  const result = continuation.result;
  if (typeof result === 'string' && result.trim()) return result;
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const row = result as Record<string, unknown>;
    for (const key of ['summary', 'text', 'message']) {
      if (typeof row[key] === 'string' && row[key].trim()) return row[key] as string;
    }
  }
  return null;
}

function continuationReceipt(continuation: Record<string, unknown>): string | null {
  const receipt = continuation.receipt;
  if (typeof receipt === 'string' && receipt.trim()) return 'Квитанция продолжения сохранена.';
  if (receipt && typeof receipt === 'object' && !Array.isArray(receipt)) {
    const row = receipt as Record<string, unknown>;
    const status = row.status ?? row.phase;
    if (typeof status === 'string') return `Квитанция продолжения: ${status}.`;
    return 'Квитанция продолжения сохранена.';
  }
  return null;
}

function safeEvidenceHref(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function ExecutorQuestionDetails({
  text,
  choices,
  waitingReason,
  feedback,
  busy,
  canAnswer,
  readBusy,
  executionPhase,
  executionReceiptPresent,
  continuations,
  continuation,
  onAnswer,
  onRefreshRead,
}: {
  text: string;
  choices: readonly ExecutorQuestionChoice[];
  waitingReason?: string | null;
  feedback: ExecutorQuestionFeedback;
  busy: boolean;
  canAnswer: boolean;
  readBusy: boolean;
  executionPhase: string;
  executionReceiptPresent: boolean;
  continuations: readonly { phase: string; summary?: string; evidenceRefs?: readonly string[] }[];
  continuation?: Record<string, unknown>;
  onAnswer: (value: string) => void;
  onRefreshRead: () => void;
}) {
  const status = continuation ? continuationState(continuation) : null;
  const summary = continuation ? continuationSummary(continuation) : null;
  const receipt = continuation ? continuationReceipt(continuation) : null;
  return (
    <div className="space-y-3 rounded-md border p-3" aria-label="Вопрос исполнителя">
      <div>
        <h4 className="text-sm font-medium">Вопрос исполнителя</h4>
        <p className="mt-1 whitespace-pre-wrap text-sm">{text}</p>
      </div>
      {waitingReason && <p className="text-xs text-muted-foreground">Ожидание: {waitingReason}</p>}
      <div className="space-y-1 text-xs text-muted-foreground" aria-label="Состояние выполнения">
        <p>Состояние: {executionPhaseLabel(executionPhase)}</p>
        {executionReceiptPresent && <p>Квитанция запуска сохранена.</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {choices.map(choice => <button key={choice.value} type="button"
          className="inline-flex h-9 items-center justify-center rounded-md border px-3 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50"
          disabled={!canAnswer || busy} onClick={() => onAnswer(choice.value)}>
          {choice.label}
        </button>)}
      </div>
      <button type="button" className="inline-flex h-9 items-center justify-center rounded-md border px-3 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50" disabled={readBusy} onClick={onRefreshRead}>
        {readBusy ? 'Проверяю…' : 'Проверить состояние (только чтение)'}
      </button>
      {busy && <p role="status" className="text-sm text-muted-foreground">Отправляю один ответ…</p>}
      {feedback && <p role={feedback === 'declined' ? 'alert' : 'status'} className="text-sm text-muted-foreground">{answerFeedbackText[feedback]}</p>}
      {continuation && <div className="space-y-1 rounded-md bg-muted/40 p-2 text-sm" aria-label="Результат продолжения">
        <p className="font-medium">Продолжение задачи{status ? `: ${status}` : ' ещё не подтверждено'}</p>
        {receipt && <p>{receipt}</p>}
        {summary && <p className="whitespace-pre-wrap">Результат: {summary}</p>}
        {!receipt && !summary && <p className="text-xs text-muted-foreground">Квитанция или результат ещё не получены.</p>}
      </div>}
      {continuations.map((item, index) => <div key={`${item.phase}-${index}`} className="space-y-1 rounded-md bg-muted/40 p-2 text-sm" aria-label="Квитанция продолжения задачи">
        <p className="font-medium">Продолжение: {executionPhaseLabel(item.phase)}</p>
        {item.summary && <p className="whitespace-pre-wrap">Результат: {item.summary}</p>}
        {!!item.evidenceRefs?.length && <ul className="list-disc space-y-1 pl-5 text-xs">
          {item.evidenceRefs.map(reference => <li key={reference}>
            {safeEvidenceHref(reference)
              ? <a className="underline" href={safeEvidenceHref(reference)!} target="_blank" rel="noreferrer">Подтверждение результата</a>
              : 'Подтверждение результата сохранено.'}
          </li>)}
        </ul>}
        {!item.summary && !item.evidenceRefs?.length && <p className="text-xs text-muted-foreground">Квитанция есть; итог продолжения ещё не записан.</p>}
      </div>)}
    </div>
  );
}

function deliveryLabel(state: string): string {
  return ({
    sent: 'отправка подтверждена',
    sending: 'отправка ещё выполняется',
    unknown: 'результат отправки неизвестен',
    failed: 'отправка не подтверждена',
  } as Record<string, string>)[state] ?? 'нет подтверждения доставки';
}

export function QuestionDetails({ view }: { view: TaskQuestionView }) {
  const answerLabel = view.decision
    ? view.question.choices.find(choice => choice.value === view.decision?.value)?.label ?? view.decision.value
    : null;
  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-medium">Связанный вопрос</h4>
        <span className="text-xs text-muted-foreground">{taskQuestionStateLabel(view.state)}</span>
      </div>
      <p className="whitespace-pre-wrap text-sm">{view.question.text}</p>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {view.question.choices.map(choice => <li key={choice.value}>{choice.label}</li>)}
      </ul>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div><dt className="text-xs text-muted-foreground">Назначение</dt><dd>{view.purpose}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Уведомление</dt><dd>{deliveryLabel(view.notification.attemptState)}</dd></div>
        {view.notification.delivered && view.notification.deadlineAt !== null && (
          <div><dt className="text-xs text-muted-foreground">Срок ответа после подтверждённой отправки</dt><dd>{taskQuestionTimestamp(view.notification.deadlineAt)}</dd></div>
        )}
        {!view.notification.delivered && view.question.expiresAt !== null && (
          <div><dt className="text-xs text-muted-foreground">Срок вопроса</dt><dd>{taskQuestionTimestamp(view.question.expiresAt)}</dd></div>
        )}
        {view.decision && <div>
          <dt className="text-xs text-muted-foreground">{view.decision.source === 'human' ? 'Ответ человека' : 'Итог по таймауту'}</dt>
          <dd>{answerLabel}{view.decision.decidedAt !== null ? ` · ${taskQuestionTimestamp(view.decision.decidedAt)}` : ''}</dd>
        </div>}
      </dl>
      <p className="text-xs text-muted-foreground">Ответ или таймаут не останавливает и не возобновляет задачу. Команды паузы/остановки и подтверждение управления здесь недоступны.</p>
    </div>
  );
}
