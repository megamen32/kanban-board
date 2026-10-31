import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { boardHumanIdentityFromRequest } from '../auth/board-human';
import { automationTokenValid, identityFromRequest } from '../auth/request';
import { findCardById, updateCard } from './file-store';
import { callOwnerHerderTool } from '@/lib/kanban/task-execution-client';
import type { KanbanCard, KanbanCardUpdates, PendingQuestion, TaskExecutionReceipt } from './types';

/** Stage 1 board-owned executor questions: no Notice task-decision, no mandate, no Herder human-request. */
export const EXECUTOR_KEY_HEADER = 'x-kanban-executor-key';
export const MAX_QUESTION_TEXT = 500;
export const MAX_CHOICE_LABEL = 100;
export const MAX_RESULT_TEXT = 4000;
const DEFAULT_QUESTION_TIMEOUT_MS = 1_800_000;
const DEFAULT_EXECUTOR_BASE_URL = 'http://127.0.0.1:43327';
const DEFAULT_PUBLIC_BASE_URL = 'https://todo-board.airlock.bezrabotnyi.com';
const DEFAULT_NOTICE_ORIGIN = 'https://notify.bezrabotnyi.com';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();

export function newExecutorKey(): { key: string; hash: string } {
  const key = randomBytes(32).toString('hex');
  return { key, hash: sha256(key) };
}

export function executorBaseUrl(): string {
  return (process.env.KANBAN_EXECUTOR_BASE_URL?.trim() || DEFAULT_EXECUTOR_BASE_URL).replace(/\/+$/, '');
}

/** The short Russian block appended to the task prompt; it carries the plain per-attempt key. */
export function executorProtocolBlock(cardId: string, key: string): string {
  const base = `${executorBaseUrl()}/api/kanban/cards/${encodeURIComponent(cardId)}`;
  const hdr = `-H 'x-kanban-executor-key: ${key}' -H 'Content-Type: application/json'`;
  return [
    'ПРОТОКОЛ ДОСКИ (только эти две команды, больше ничего не нужно):',
    `- Если нужен ответ владельца: выполни ровно одну команду и закончи ход, ответ придёт следующим сообщением в эту же сессию: curl -sS -X POST ${base}/question ${hdr} -d '{"question":"<вопрос до 500 символов>","choices":[{"value":"a","label":"<вариант>"},{"value":"b","label":"<вариант>"}],"timeoutValue":"a"}'`,
    `- Когда задача выполнена: выполни curl и закончи ход: curl -sS -X POST ${base}/result ${hdr} -d '{"text":"<итог одной строкой или коротко>"}'`,
    '- Вариантов ответа от 2 до 4, value уникальны, timeoutValue - один из value (его применят, если владелец не ответит 30 минут).',
    '- Запрещено: искать файлы карточки, читать код доски, использовать sudo. Не выводи ключ в ответах.',
  ].join('\n');
}

export function latestAttempt(card: KanbanCard): TaskExecutionReceipt | undefined {
  return card.taskExecutionHistory?.at(-1);
}

/** Authenticate the latest attempt. Finished attempts are read-only unless a caller explicitly reconciles a result. */
export function executorAttempt(
  request: Request, card: KanbanCard, options: { allowResult?: boolean } = {},
): TaskExecutionReceipt | undefined {
  const provided = request.headers.get(EXECUTOR_KEY_HEADER)?.trim();
  const attempt = latestAttempt(card);
  if (!provided || !attempt?.executorKeyHash || attempt.phase === 'stopped'
      || (attempt.phase === 'result' && !options.allowResult)) return undefined;
  const a = Buffer.from(sha256(provided), 'hex');
  const b = Buffer.from(attempt.executorKeyHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b) ? attempt : undefined;
}

/** Owner session OR automation token; returns the acting identity or undefined. */
export async function ownerActor(request: NextRequest, card: KanbanCard): Promise<string | undefined> {
  if (automationTokenValid(request)) return 'automation';
  const identity = identityFromRequest(request) ?? await boardHumanIdentityFromRequest(request);
  if (!identity || identity.scope !== 'work') return undefined;
  const owns = (card.owner ?? 'nikita') === identity.username || card.assignee === identity.username
    || card.assignees.includes(identity.username);
  return owns ? identity.username : undefined;
}

export type ParsedQuestion = { question: string; choices: Array<{ value: string; label: string }>; timeoutValue?: string };

export function parseQuestionBody(body: unknown): ParsedQuestion | string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'object body required';
  const { question, choices, timeoutValue } = body as Record<string, unknown>;
  if (typeof question !== 'string' || !question.trim() || question.length > MAX_QUESTION_TEXT) return 'question must be 1-500 chars';
  if (!Array.isArray(choices) || choices.length < 2 || choices.length > 4) return 'choices must have 2-4 items';
  const parsed: Array<{ value: string; label: string }> = [];
  for (const choice of choices) {
    if (!choice || typeof choice !== 'object') return 'invalid choice';
    const { value, label } = choice as Record<string, unknown>;
    if (typeof value !== 'string' || !value.trim() || value.length > 100) return 'invalid choice value';
    if (typeof label !== 'string' || !label.trim() || label.length > MAX_CHOICE_LABEL) return 'choice label must be 1-100 chars';
    if (parsed.some(item => item.value === value)) return 'choice values must be unique';
    parsed.push({ value, label });
  }
  if (timeoutValue !== undefined && (typeof timeoutValue !== 'string' || !parsed.some(item => item.value === timeoutValue))) {
    return 'timeoutValue must be one of the choice values';
  }
  return { question: question.trim(), choices: parsed, ...(typeof timeoutValue === 'string' ? { timeoutValue } : {}) };
}

/** Compare-and-swap loop over the card; fn returns undefined to stop without writing. */
export function mutateCard(
  cardId: string, tasksDir: string, fn: (card: KanbanCard) => KanbanCardUpdates | undefined,
): KanbanCard | undefined {
  for (let i = 0; i < 5; i++) {
    const current = findCardById(cardId, tasksDir);
    if (!current) return undefined;
    const updates = fn(current);
    if (!updates) return current;
    const saved = updateCard(cardId, updates, current.version, tasksDir);
    if (!('conflict' in saved)) return saved;
  }
  return undefined;
}

export function withAttemptPhase(card: KanbanCard, operationId: string, patch: Partial<TaskExecutionReceipt>): TaskExecutionReceipt[] {
  return (card.taskExecutionHistory ?? []).map(item => item.operationId === operationId
    ? { ...item, ...patch, lastBoardVersion: card.version + 1, updatedAt: now() } : item);
}

export function questionTimeoutMs(): number {
  const raw = Number(process.env.KANBAN_QUESTION_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_QUESTION_TIMEOUT_MS;
}

export function answerMessage(question: PendingQuestion, label: string, value: string): string {
  if (question.answer?.by === 'timeout') {
    return `Ответ на вопрос «${question.text}» не поступил вовремя. Выбран вариант по умолчанию: «${label}» (value: ${value}). Продолжай задачу с этого места.`;
  }
  return `Ответ владельца на твой вопрос «${question.text}»: «${label}» (value: ${value}). Продолжай задачу с этого места.`;
}

export type AnswerOutcome =
  | { status: 'ok'; card: KanbanCard; question: PendingQuestion; idempotent: boolean }
  | { status: 'no_question' | 'bad_value' | 'unavailable' };

/** Store the answer first (the idempotency anchor), then deliver it once into the same native session. */
export async function applyAnswer(cardId: string, tasksDir: string, value: string, by: string): Promise<AnswerOutcome> {
  let stored: PendingQuestion | undefined;
  let alreadyAnswered = false;
  let failure: 'no_question' | 'bad_value' | undefined;
  const saved = mutateCard(cardId, tasksDir, card => {
    const q = card.pendingQuestion;
    if (!q) { failure = 'no_question'; return undefined; }
    if (q.answer) { alreadyAnswered = true; stored = q; return undefined; }
    const attempt = latestAttempt(card);
    if (by === 'timeout' && (attempt?.operationId !== q.attemptOperationId || attempt.phase !== 'waiting')) {
      failure = 'no_question';
      return undefined;
    }
    const choice = q.choices.find(item => item.value === value);
    if (!choice) { failure = 'bad_value'; return undefined; }
    stored = { ...q, answer: { value: choice.value, label: choice.label, answeredAt: now(), by } };
    const questionAttempt = card.taskExecutionHistory?.find(item => item.operationId === q.attemptOperationId);
    return {
      pendingQuestion: stored,
      ...(questionAttempt?.phase === 'waiting' ? { taskExecutionHistory: withAttemptPhase(card, questionAttempt.operationId, { phase: 'running' }) } : {}),
    };
  });
  if (failure) return { status: failure };
  if (!saved || !stored) return { status: 'unavailable' };
  if (alreadyAnswered) return { status: 'ok', card: saved, question: stored, idempotent: true };

  const question = stored as PendingQuestion;
  const attempt = saved.taskExecutionHistory?.find(item => item.operationId === question.attemptOperationId);
  let deliveryAcceptedAt: string | undefined;
  let deliveryError: string | undefined;
  if (!attempt?.nativeSessionId) {
    deliveryError = 'native_session_missing';
  } else {
    try {
      const result = await callOwnerHerderTool('send_message', {
        sessionId: attempt.nativeSessionId, harness: attempt.harness,
        inputId: sha256(`board-answer\0${cardId}\0${question.id}`),
        message: answerMessage(question, question.answer!.label, question.answer!.value),
        mode: 'queue', humanRequested: true,
      });
      if (result.isError) deliveryError = 'send_message_error'; else deliveryAcceptedAt = now();
    } catch (error) {
      deliveryError = error instanceof Error ? error.message.slice(0, 120) : 'send_message_failed';
    }
  }
  const final = mutateCard(cardId, tasksDir, card => card.pendingQuestion?.id === question.id
    ? { pendingQuestion: { ...card.pendingQuestion, ...(deliveryAcceptedAt ? { deliveryAcceptedAt } : {}), ...(deliveryError ? { deliveryError } : {}) } }
    : undefined) ?? saved;
  return { status: 'ok', card: final, question: final.pendingQuestion ?? question, idempotent: false };
}

/** Read the exact durable job; admission alone does not prove delivery. Never resend. */
export async function reconcileQuestionDelivery(card: KanbanCard, tasksDir: string): Promise<void> {
  const q = card.pendingQuestion;
  if (!q?.answer || q.deliveredAt) return;
  const attempt = card.taskExecutionHistory?.find(item => item.operationId === q.attemptOperationId);
  if (!attempt?.nativeSessionId || !attempt.harness) return;
  const inputId = sha256(`board-answer\0${card.id}\0${q.id}`);
  const onceKey = ['user-message', attempt.harness, attempt.nativeSessionId, inputId].join('\0');
  const jobId = `job_${sha256(onceKey)}`;
  try {
    const response = await callOwnerHerderTool('job_get', { jobId });
    let payload: unknown = response.structuredContent;
    if (!payload) {
      const raw = response.content.filter(item => item.type === 'text').map(item => item.text ?? '').join('');
      payload = JSON.parse(raw);
    }
    if (!payload || typeof payload !== 'object') return;
    const job = (payload as { job?: Record<string, unknown> }).job;
    const result = job?.result as Record<string, unknown> | undefined;
    if (job?.id !== jobId || job.state !== 'completed' || job.ownerSessionId !== attempt.nativeSessionId
        || job.onceKey !== onceKey || result?.ok !== true || result.admitted !== true || result.inputId !== inputId
        || typeof result.nativeInputMessageId !== 'string' || !/^msg_[A-Za-z0-9_-]{8,256}$/.test(result.nativeInputMessageId)) return;
    mutateCard(card.id, tasksDir, current => {
      if (current.pendingQuestion?.id !== q.id || current.pendingQuestion.deliveredAt) return undefined;
      const { deliveryError: _deliveryError, ...question } = current.pendingQuestion;
      return { pendingQuestion: { ...question, deliveredAt: now() } };
    });
  } catch { /* retry readback on the next tick; sending remains exactly once */ }
}

/** Lazy timeout: any board call after the deadline applies timeoutValue as the owner's answer. */
export async function sweepQuestionTimeout(card: KanbanCard, tasksDir: string): Promise<KanbanCard> {
  const q = card.pendingQuestion;
  if (!q || q.answer || !q.timeoutValue) return card;
  const asked = Date.parse(q.askedAt);
  if (!Number.isFinite(asked) || Date.now() - asked < questionTimeoutMs()) return card;
  const outcome = await applyAnswer(card.id, tasksDir, q.timeoutValue, 'timeout');
  return outcome.status === 'ok' ? outcome.card : card;
}

/** Best effort plain Notice event; failures are logged and never block the question. */
export async function notifyQuestion(card: KanbanCard, question: PendingQuestion): Promise<void> {
  const token = process.env.EXMANAGER_NOTICE_PROJECT_TOKEN?.trim();
  const recipient = process.env.NOTIFY_CENTER_RECIPIENT?.trim();
  if (!token || !recipient) return;
  let origin = DEFAULT_NOTICE_ORIGIN;
  try { origin = new URL(process.env.EXMANAGER_NOTICE_API_BASE_URL?.trim() || DEFAULT_NOTICE_ORIGIN).origin; } catch { /* default */ }
  const link = `${(process.env.KANBAN_PUBLIC_BASE_URL?.trim() || DEFAULT_PUBLIC_BASE_URL).replace(/\/+$/, '')}/board`;
  const payload = JSON.stringify({
    schema: 'notify.event.v1', project: card.project, recipient, kind: 'notification', severity: 'notice',
    title: `Вопрос по задаче: ${card.title}`.slice(0, 200),
    body: `${question.text}\nВарианты: ${question.choices.map(c => c.label).join(' / ')}\nКарточка ${card.id}: ${link}`,
    dedup_key: `board-question:${card.id}:${question.id}`, producer: 'kanban-board',
  });
  try {
    const response = await fetch(`${origin}/v1/events`, {
      method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(4_000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': sha256(payload) },
      body: payload,
    });
    if (response.status >= 400 && response.status !== 409) console.warn('[kanban question notice]', { status: response.status });
  } catch (error) {
    console.warn('[kanban question notice]', { error: error instanceof Error ? error.name : typeof error });
  }
}

