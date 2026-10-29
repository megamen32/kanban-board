export type TaskQuestionDecision = {
  source: 'human' | 'timeout';
  value: string;
  decidedAt: number | null;
};

export interface TaskQuestionView {
  requestId: string;
  purpose: string;
  version: number;
  state: string;
  question: {
    text: string;
    choices: Array<{ value: string; label: string }>;
    expiresAt: number | null;
  };
  notification: {
    attemptState: string;
    delivered: boolean;
    deadlineAt: number | null;
  };
  decision: TaskQuestionDecision | null;
  answerStatus?: 'accepted' | 'duplicate' | 'unknown' | 'conflict' | 'pending' | 'timeout' | 'control_requested' | 'no_accept';
  continuation?: Record<string, unknown>;
}

export interface ExecutorQuestionPayload {
  humanRequestId: string;
  text: string;
  choices: Array<{ value: string; label: string }>;
  timeoutValue: string;
}

const HUMAN_REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Validate the exact typed result an executor emits after its metadata-only Herder binding. */
export function parseExecutorQuestionPayload(value: unknown, expectedHumanRequestId: string): ExecutorQuestionPayload | undefined {
  if (!HUMAN_REQUEST_ID_PATTERN.test(expectedHumanRequestId)
      || !value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const expectedKeys = ['choices', 'human_request_id', 'kind', 'question', 'timeoutValue'];
  if (Object.keys(row).sort().join('\0') !== expectedKeys.join('\0')
      || row.kind !== 'question' || row.human_request_id !== expectedHumanRequestId
      || typeof row.question !== 'string' || !row.question.trim() || row.question.length > 4_000
      || /[\x00-\x08\x0b-\x1f\x7f]/.test(row.question)
      || !Array.isArray(row.choices) || row.choices.length < 2 || row.choices.length > 4
      || typeof row.timeoutValue !== 'string') return undefined;
  const choices: Array<{ value: string; label: string }> = [];
  for (const item of row.choices) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
    const choice = item as Record<string, unknown>;
    if (Object.keys(choice).sort().join('\0') !== 'label\0value'
        || typeof choice.value !== 'string' || typeof choice.label !== 'string') return undefined;
    const value = choice.value.trim();
    const label = choice.label.trim();
    if (!value || value.length > 128 || /[\x00-\x1f\x7f]/.test(value)
        || !label || label.length > 256 || /[\x00-\x1f\x7f]/.test(label)) return undefined;
    choices.push({ value, label });
  }
  const timeoutValue = row.timeoutValue.trim();
  if (new Set(choices.map(choice => choice.value)).size !== choices.length
      || !choices.some(choice => choice.value === timeoutValue)) return undefined;
  return { humanRequestId: expectedHumanRequestId, text: row.question.trim(), choices, timeoutValue };
}

export type TaskQuestionRead =
  | { kind: 'none' }
  | { kind: 'unknown'; requestId?: string }
  | { kind: 'not-found' }
  | { kind: 'ready'; view: TaskQuestionView }
  | { kind: 'invalid' };

export async function matchesTaskExecutionOperation(cardId: string, receiptOperationId: string, operationId: string): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/.test(receiptOperationId)) return false;
  const bytes = new TextEncoder().encode(`${cardId}\0${operationId}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hex = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
  return hex === receiptOperationId;
}

export function canCreateTaskQuestion(card: {
  owner?: string;
  assignee?: string | null;
  assignees: string[];
  version: number;
  taskExecutionHistory?: Array<{ operationId: string; lastBoardVersion: number; phase: string; harness: string; nativeTurnId?: string }>;
}, username: string | null, operation: { operationId: string; status: string } | null, operationMatchesReceipt: boolean): boolean {
  const latest = card.taskExecutionHistory?.at(-1);
  return isTaskQuestionOwner(card, username) && operation?.status === 'admitted' && operationMatchesReceipt
    && latest?.operationId.length === 64 && latest.harness === 'codex'
    && ['running', 'waiting'].includes(latest.phase) && Boolean(latest.nativeTurnId)
    && latest.lastBoardVersion === card.version;
}

export function isTaskQuestionOwner(card: {
  owner?: string;
  assignee?: string | null;
  assignees: string[];
}, username: string | null): boolean {
  if (!username) return false;
  return (card.owner ?? 'nikita') === username || card.assignee === username || card.assignees.includes(username);
}

export function canAnswerTaskQuestion(card: {
  owner?: string;
  assignee?: string | null;
  assignees: string[];
  version: number;
  taskExecutionHistory?: Array<{
    lastBoardVersion: number;
    phase: string;
    harness: string;
    taskDecisionRequest?: { requestId: string };
    executorQuestion?: { humanRequestId: string; questionHash: string; choices: readonly { value: string; label: string }[] };
    taskDecisionProposal?: { requestId: string; value: string; authenticatedActor: string };
    sessionControls?: {
      stop?: { phase: string; controlEpoch?: string };
      stops?: readonly { phase: string; controlEpoch?: string }[];
      direct?: readonly { phase: string; requestHash: string }[];
    };
  }>;
}, username: string | null, view: TaskQuestionView | null): boolean {
  const latest = card.taskExecutionHistory?.at(-1);
  const latestStop = latest?.sessionControls?.stops?.at(-1) ?? latest?.sessionControls?.stop;
  const latestDirect = latest?.sessionControls?.direct?.at(-1);
  // Match the execution route: only an exact accepted direct input with a
  // different epoch makes an accepted stop historical. Unknown controls fail closed.
  const activeStop = !!latestStop && (latestStop.phase !== 'accepted'
    || latestDirect?.phase !== 'accepted'
    || !/^[a-f0-9]{64}$/.test(latestDirect.requestHash)
    || !latestStop.controlEpoch
    || latestStop.controlEpoch === latestDirect.requestHash);
  return isTaskQuestionOwner(card, username) && view?.state === 'pending' && !view.decision
    && latest?.harness === 'opencode' && latest.phase === 'waiting' && latest.lastBoardVersion === card.version
    && latest.taskDecisionRequest?.requestId === view.requestId
    && !!latest.executorQuestion?.humanRequestId && /^[0-9a-f-]{36}$/i.test(latest.executorQuestion.humanRequestId)
    && /^[a-f0-9]{64}$/.test(latest.executorQuestion.questionHash)
    && latest.executorQuestion.choices.length === view.question.choices.length
    && latest.executorQuestion.choices.every((choice, index) => choice.value === view.question.choices[index]?.value
      && choice.label === view.question.choices[index]?.label)
    && !latest.taskDecisionProposal && !activeStop;
}

export function parseTaskQuestion(value: unknown): TaskQuestionRead {
  if (value === null) return { kind: 'none' };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { kind: 'invalid' };
  const row = value as Record<string, unknown>;
  if (row.state === 'unknown') return { kind: 'unknown', ...(typeof row.requestId === 'string' ? { requestId: row.requestId } : {}) };
  if (row.state === 'not_found') return { kind: 'not-found' };
  if (typeof row.requestId !== 'string' || typeof row.purpose !== 'string' || !Number.isSafeInteger(row.version)
      || typeof row.state !== 'string' || !row.question || typeof row.question !== 'object' || Array.isArray(row.question)
      || !row.notification || typeof row.notification !== 'object' || Array.isArray(row.notification)) return { kind: 'invalid' };
  const question = row.question as Record<string, unknown>;
  const notification = row.notification as Record<string, unknown>;
  if (typeof question.text !== 'string' || !Array.isArray(question.choices) || question.choices.length < 2 || question.choices.length > 4
      || typeof notification.attemptState !== 'string' || typeof notification.delivered !== 'boolean'
      || (notification.deadlineAt !== null && (typeof notification.deadlineAt !== 'number' || !Number.isFinite(notification.deadlineAt)))
      || (question.expiresAt !== null && (typeof question.expiresAt !== 'number' || !Number.isFinite(question.expiresAt)))) return { kind: 'invalid' };
  const choices: Array<{ value: string; label: string }> = [];
  for (const choice of question.choices) {
    if (!choice || typeof choice !== 'object' || Array.isArray(choice)) return { kind: 'invalid' };
    const item = choice as Record<string, unknown>;
    if (typeof item.value !== 'string' || typeof item.label !== 'string') return { kind: 'invalid' };
    choices.push({ value: item.value, label: item.label });
  }
  let decision: TaskQuestionDecision | null = null;
  if (row.decision !== null) {
    if (!row.decision || typeof row.decision !== 'object' || Array.isArray(row.decision)) return { kind: 'invalid' };
    const raw = row.decision as Record<string, unknown>;
    if ((raw.source !== 'human' && raw.source !== 'timeout') || typeof raw.value !== 'string'
        || (raw.decidedAt !== null && (typeof raw.decidedAt !== 'number' || !Number.isFinite(raw.decidedAt)))) return { kind: 'invalid' };
    decision = { source: raw.source, value: raw.value, decidedAt: raw.decidedAt as number | null };
  }
  return {
    kind: 'ready',
    view: {
      requestId: row.requestId,
      purpose: row.purpose,
      version: row.version as number,
      state: row.state,
      question: {
        text: question.text,
        choices,
        expiresAt: question.expiresAt as number | null,
      },
      notification: {
        attemptState: notification.attemptState,
        delivered: notification.delivered,
        deadlineAt: notification.deadlineAt as number | null,
      },
      decision,
      ...(typeof row.answerStatus === 'string' && ['accepted', 'duplicate', 'unknown', 'conflict', 'pending', 'timeout', 'control_requested', 'no_accept'].includes(row.answerStatus)
        ? { answerStatus: row.answerStatus as TaskQuestionView['answerStatus'] } : {}),
      ...(isRecord(row.continuation) ? { continuation: row.continuation } : {}),
    },
  };
}

export function taskQuestionCreateRequest(input: {
  expectedVersion: number;
  operationId: string;
  purpose: string;
  message: string;
  choices: Array<{ value: string; label: string }>;
  timeoutValue: string;
}) {
  return {
    action: 'create-question' as const,
    expectedVersion: input.expectedVersion,
    operationId: input.operationId,
    purpose: input.purpose.trim(),
    message: input.message.trim(),
    choices: input.choices.map(choice => ({ value: choice.value, label: choice.label.trim() })),
    timeoutValue: input.timeoutValue,
  };
}

export function taskQuestionStateLabel(state: string): string {
  return ({
    pending: 'Ожидается ответ',
    decided: 'Ответ получен',
    resolved: 'Ответ получен',
    expired: 'Срок ответа истёк',
    cancelled: 'Вопрос отменён',
    closed: 'Вопрос закрыт',
  } as Record<string, string>)[state] ?? 'Состояние вопроса получено';
}

export function taskQuestionTimestamp(epochSeconds: number): string {
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(epochSeconds * 1000));
}
