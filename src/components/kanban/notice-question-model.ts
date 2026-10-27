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
