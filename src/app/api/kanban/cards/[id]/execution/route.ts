import { createHash } from 'node:crypto';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { boardIdentityFromRequest, identityFromRequest } from '@/lib/auth/request';
import { tasksDirForScope } from '@/lib/auth/data-scope';
import { findCardById, updateCard } from '@/lib/kanban/file-store';
import { taskExecutionSnapshot } from '@/lib/kanban/task-execution';
import { callOwnerHerderTool, type HerderToolResult } from '@/lib/kanban/task-execution-client';
import { validateTransition } from '@/lib/kanban/transition-policy';
import type { KanbanCard, KanbanCardUpdates, TaskExecutionReceipt } from '@/lib/kanban/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RecordValue = Record<string, unknown>;
const SESSION_MODEL = 'gpt-6-luna';
const MAX_TASK_TEXT = 48_000;

const isRecord = (value: unknown): value is RecordValue => !!value && typeof value === 'object' && !Array.isArray(value);
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();

function textOf(result: HerderToolResult): string {
  return result.content.filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map(part => part.text).join('\n').slice(0, 4096);
}

function jsonFromTool(result: HerderToolResult): RecordValue | undefined {
  if (isRecord(result.structuredContent)) return result.structuredContent;
  const text = textOf(result);
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function taskOwner(card: KanbanCard, username: string): boolean {
  return (card.owner ?? 'nikita') === username || card.assignee === username || card.assignees.includes(username);
}

function taskFingerprint(card: KanbanCard, actor: string, hostId: string, cwd: string): string {
  return sha256(JSON.stringify({
    id: card.id, title: card.title, description: card.description, project: card.project,
    owner: card.owner ?? 'nikita', assignee: card.assignee ?? null, assignees: card.assignees,
    actor, hostId, harness: 'codex', cwd, model: SESSION_MODEL,
  }));
}

function startAvailability(card: KanbanCard) {
  const cwd = process.env.EXMANAGER_TASK_EXECUTION_CWD?.trim();
  if (!cwd || !path.isAbsolute(cwd)) return { startAvailable: false, unavailableReason: 'Проект для запуска задачи не настроен' };
  if (!process.env.AGENT_HERDER_HTTP_TOKEN?.trim()) return { startAvailable: false, unavailableReason: 'Защищённый канал запуска задачи не настроен' };
  if (['review', 'done', 'archived', 'blocked'].includes(card.column) || card.needsReview) {
    return { startAvailable: false, unavailableReason: 'Карточка сейчас недоступна для запуска' };
  }
  const latest = card.taskExecutionHistory?.at(-1);
  if (latest && !['result', 'stopped'].includes(latest.phase)) {
    return { startAvailable: false, unavailableReason: 'Предыдущий запуск ещё не разрешён' };
  }
  return { startAvailable: true as const };
}

function operationIdFor(cardId: string, rawOperationId: string): string {
  return sha256(`${cardId}\0${rawOperationId}`);
}

function authorizedTaskCard(request: NextRequest, id: string) {
  const identity = identityFromRequest(request);
  if (!identity) return { response: NextResponse.json({ error: 'authenticated operator required' }, { status: 401 }) };
  if (identity.scope !== 'work') return { response: NextResponse.json({ error: 'work board required' }, { status: 403 }) };
  const tasksDir = tasksDirForScope(identity.scope);
  const card = findCardById(id, tasksDir);
  if (!card) return { response: NextResponse.json({ error: 'not found' }, { status: 404 }) };
  if (!taskOwner(card, identity.username)) return { response: NextResponse.json({ error: 'task owner or assignee required' }, { status: 403 }) };
  return { identity, tasksDir, card };
}

function saveReceiptProgress(
  cardId: string,
  tasksDir: string,
  operationId: string,
  requestHash: string,
  patch: Partial<TaskExecutionReceipt>,
  cardUpdates?: (current: KanbanCard) => KanbanCardUpdates,
): KanbanCard | undefined {
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = findCardById(cardId, tasksDir);
    if (!current) return undefined;
    const history = current.taskExecutionHistory ?? [];
    const index = history.findIndex(entry => entry.operationId === operationId);
    if (index < 0 || history[index]!.requestHash !== requestHash) return undefined;
    const old = history[index]!;
    const terminal = old.phase === 'result' || old.phase === 'stopped' || old.phase === 'create-unknown' || old.phase === 'dispatch-unknown';
    if (terminal && old.phase !== patch.phase) return current;
    const updated: TaskExecutionReceipt = { ...old, ...patch, lastBoardVersion: current.version + 1, updatedAt: now() };
    const nextHistory = [...history];
    nextHistory[index] = updated;
    const saved = updateCard(cardId, { ...cardUpdates?.(current), taskExecutionHistory: nextHistory }, current.version, tasksDir);
    if (!('conflict' in saved)) return saved;
  }
  return undefined;
}

/** Read the execution-facing snapshot from the authenticated caller's existing Board scope. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const identity = boardIdentityFromRequest(request);
    const { id } = await params;
    const card = findCardById(id, tasksDirForScope(identity.scope));
    if (!card) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({ ...taskExecutionSnapshot(card), ...startAvailability(card) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'execution status could not be read' }, { status: 400 });
  }
}

/** Start one task through the existing protected owner MCP; every native action has a persisted ID first. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let context: ReturnType<typeof authorizedTaskCard>;
  try {
    const { id } = await params;
    context = authorizedTaskCard(request, id);
  } catch {
    return NextResponse.json({ error: 'task execution identity unavailable' }, { status: 400 });
  }
  if ('response' in context) return context.response;

  try {
    const body: unknown = await request.json();
    if (!isRecord(body) || Object.keys(body).length !== 2
      || Object.keys(body).some(key => !['expectedVersion', 'operationId'].includes(key))
      || !Number.isSafeInteger(body.expectedVersion) || typeof body.operationId !== 'string'
      || !/^[A-Za-z0-9_-]{16,128}$/.test(body.operationId)) {
      return NextResponse.json({ error: 'invalid execution request' }, { status: 400 });
    }
    const configuredCwd = process.env.EXMANAGER_TASK_EXECUTION_CWD?.trim();
    if (!configuredCwd || !path.isAbsolute(configuredCwd)) return NextResponse.json({ error: 'task execution project is not configured' }, { status: 503 });
    const cwd = path.resolve(configuredCwd);
    const operationId = operationIdFor(context.card.id, body.operationId);
    const createInputId = sha256(`${operationId}\0create`);
    const messageInputId = sha256(`${operationId}\0dispatch`);

    // Resolve the protected MCP peer server-side; the browser never chooses a
    // native host or project path for this fixed application.
    if (!process.env.AGENT_HERDER_HTTP_TOKEN?.trim()) {
      return NextResponse.json({ error: 'protected task execution channel is not configured' }, { status: 503 });
    }
    let nodeInfoResult: HerderToolResult;
    try {
      nodeInfoResult = await callOwnerHerderTool('fleet_node_info', {});
    } catch {
      return NextResponse.json({ error: 'protected task execution channel is unavailable' }, { status: 503 });
    }
    const nodeInfo = jsonFromTool(nodeInfoResult);
    if (!nodeInfo || typeof nodeInfo.hostId !== 'string' || !nodeInfo.hostId.trim()
      || typeof nodeInfo.nativeUser !== 'string' || !nodeInfo.nativeUser.trim()) {
      return NextResponse.json({ error: 'selected native host is not the configured owner peer' }, { status: 409 });
    }
    const hostId = nodeInfo.hostId;
    const requestHash = taskFingerprint(context.card, context.identity.username, hostId, cwd);
    const prior = context.card.taskExecutionHistory?.find(entry => entry.operationId === operationId);
    if (prior) {
      if (prior.requestHash !== requestHash || context.card.version !== prior.lastBoardVersion) {
        return NextResponse.json({ error: 'operation identity conflict or card changed after execution receipt' }, { status: 409 });
      }
      return NextResponse.json({ ...taskExecutionSnapshot(context.card), operationId: prior.operationId, replay: true }, {
        status: prior.phase === 'running' || prior.phase === 'result' ? 200 : 202,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    if (context.card.version !== body.expectedVersion) return NextResponse.json({ conflict: true, serverCard: context.card }, { status: 409 });
    if (['review', 'done', 'archived', 'blocked'].includes(context.card.column) || context.card.needsReview) {
      return NextResponse.json({ error: 'task is not available for execution' }, { status: 409 });
    }
    const active = context.card.taskExecutionHistory?.at(-1);
    if (active && !['result', 'stopped'].includes(active.phase)) {
      return NextResponse.json({ error: 'another task execution is unresolved', operationId: active.operationId }, { status: 409 });
    }

    const intent: TaskExecutionReceipt = {
      operationId, requestHash, lastBoardVersion: context.card.version + 1, createInputId, messageInputId, phase: 'intent',
      hostId, harness: 'codex', startedBy: context.identity.username,
      createdAt: now(), updatedAt: now(),
    };
    const intentSave = updateCard(context.card.id, {
      taskExecutionHistory: [...(context.card.taskExecutionHistory ?? []), intent],
    }, context.card.version, context.tasksDir);
    if ('conflict' in intentSave) return NextResponse.json({ conflict: true, serverCard: intentSave.serverCard }, { status: 409 });

    const name = `task-${context.card.id.slice(0, 8)}-${operationId.slice(0, 12)}`;
    let createTool: HerderToolResult;
    try {
      createTool = await callOwnerHerderTool('fleet_create_session', {
        inputId: createInputId, harness: 'codex', name, cwd, model: SESSION_MODEL,
      });
    } catch {
      const saved = saveReceiptProgress(context.card.id, context.tasksDir, operationId, requestHash, {
        phase: 'create-unknown', createReceiptText: 'owner MCP create outcome unknown; never replay under a new operation',
      });
      const snapshot = saved ? taskExecutionSnapshot(saved) : { cardId: context.card.id, state: 'unknown' as const };
      return NextResponse.json({ ...snapshot, operationId, retryable: false }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
    }
    const createText = textOf(createTool);
    const created = jsonFromTool(createTool);
    if (!created || created.ok !== true || created.created !== true || created.inputId !== createInputId
      || created.harness !== 'codex' || typeof created.sessionId !== 'string' || !created.sessionId.trim()
      || created.cwd !== cwd) {
      const saved = saveReceiptProgress(context.card.id, context.tasksDir, operationId, requestHash, {
        phase: 'create-unknown', createReceiptText: createText,
      });
      const snapshot = saved ? taskExecutionSnapshot(saved) : { cardId: context.card.id, state: 'unknown' as const };
      return NextResponse.json({ ...snapshot, operationId, retryable: false }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
    }

    const createdCard = saveReceiptProgress(context.card.id, context.tasksDir, operationId, requestHash, {
      phase: 'created', nativeSessionId: created.sessionId, createReceiptText: createText,
    });
    if (!createdCard) return NextResponse.json({ error: 'native session exists but its Board receipt could not be committed', operationId, retryable: false }, { status: 202 });
    const currentCard = findCardById(context.card.id, context.tasksDir);
    if (!currentCard || currentCard.version !== createdCard.version
      || taskFingerprint(currentCard, context.identity.username, hostId, cwd) !== requestHash) {
      return NextResponse.json({ ...taskExecutionSnapshot(createdCard), operationId, retryable: false, error: 'task changed after native session creation; no task prompt was sent' }, { status: 409 });
    }

    // Verify exact native host/session/CWD/model before sending any task text.
    const viewTool = await callOwnerHerderTool('fleet_session_view', { harness: 'codex', sessionId: created.sessionId });
    const view = isRecord(viewTool.structuredContent) ? viewTool.structuredContent : undefined;
    const details = isRecord(view?.details) ? view.details : undefined;
    const native = isRecord(details?.session) ? details.session : undefined;
    if (view?.hostId !== hostId || native?.id !== created.sessionId || native?.harness !== 'codex'
      || native.cwd !== cwd || native.model !== SESSION_MODEL) {
      const saved = saveReceiptProgress(context.card.id, context.tasksDir, operationId, requestHash, {
        phase: 'stopped', nativeSessionId: created.sessionId,
        lastProgress: 'Сессия создана, но её точный проект/model/session readback не совпал; задание не отправлено.',
        lastProgressAt: now(),
      });
      return NextResponse.json({ ...(saved ? taskExecutionSnapshot(saved) : taskExecutionSnapshot(createdCard)), operationId, retryable: false }, { status: 409 });
    }

    const prompt = [
      `Выполни задачу канбан карточки ${currentCard.id} из проекта «${currentCard.project}».`,
      `Название: ${currentCard.title}`,
      `Описание задачи:\n${currentCard.description}`,
      'Используй только явно указанный проект и задачу. Не пиши людям, не звони и не выполняй внешние действия, если это прямо не разрешено в тексте задачи.',
      'Подготовь результат для проверки человеком: краткий вывод, публичные ссылки на источники и следующий шаг. Не отмечай карточку выполненной.',
    ].join('\n\n').slice(0, MAX_TASK_TEXT);
    let dispatchTool: HerderToolResult;
    try {
      dispatchTool = await callOwnerHerderTool('send_message', {
        sessionId: created.sessionId, harness: 'codex', inputId: messageInputId,
        message: prompt, mode: 'steer', humanRequested: true,
      });
    } catch {
      const saved = saveReceiptProgress(context.card.id, context.tasksDir, operationId, requestHash, {
        phase: 'dispatch-unknown', nativeSessionId: created.sessionId,
        dispatchReceiptText: 'owner MCP dispatch outcome unknown; never replay this operation',
      });
      return NextResponse.json({ ...(saved ? taskExecutionSnapshot(saved) : { cardId: context.card.id, state: 'unknown' as const }), operationId, retryable: false }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
    }

    const dispatchText = textOf(dispatchTool);
    const receiptMatch = dispatchText.match(/(?:Native admission|Current-turn context reservation) receipt:\s*(\{[^\n]+\})/);
    let dispatchReceipt: RecordValue | undefined;
    if (receiptMatch?.[1]) {
      try { const value: unknown = JSON.parse(receiptMatch[1]); if (isRecord(value)) dispatchReceipt = value; } catch { /* Receipt text remains recorded as unknown. */ }
    }
    const admitted = dispatchReceipt?.admitted === true && dispatchReceipt.inputId === messageInputId
      && typeof dispatchReceipt.turnId === 'string' && dispatchReceipt.turnId.trim().length > 0;
    const startedFromVersion = createdCard.version;
    const updated = saveReceiptProgress(context.card.id, context.tasksDir, operationId, requestHash, {
      phase: admitted ? 'running' : 'dispatch-unknown', nativeSessionId: created.sessionId,
      ...(typeof dispatchReceipt?.turnId === 'string' ? { nativeTurnId: dispatchReceipt.turnId } : {}),
      dispatchReceiptText: dispatchText,
      lastProgress: admitted ? 'Задание передано в нативную сессию; ожидается результат.' : 'Статус передачи задания не подтверждён.',
      lastProgressAt: now(),
    }, admitted ? current => {
      if (current.version !== startedFromVersion || current.column === 'in-progress') return {};
      const startTransition = validateTransition(current, { column: 'in-progress' }, {
        origin: 'automation', actor: context.identity.username,
      });
      return startTransition.kind === 'accepted' ? startTransition.patch : {};
    } : undefined);
    const snapshot = updated ? taskExecutionSnapshot(updated) : { cardId: context.card.id, state: 'unknown' as const };
    return NextResponse.json({ ...snapshot, operationId, retryable: false }, {
      status: admitted ? 201 : 202,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json({ error: 'task execution request could not be processed safely' }, { status: 400 });
  }
}

/** Sync one exact completed native result into the existing human-review card flow. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const context = authorizedTaskCard(request, id);
    if ('response' in context) return context.response;
    const body: unknown = await request.json();
    if (!isRecord(body) || body.action !== 'sync-result' || typeof body.operationId !== 'string'
      || !/^[A-Za-z0-9_-]{16,128}$/.test(body.operationId) || !Number.isSafeInteger(body.expectedVersion)) {
      return NextResponse.json({ error: 'invalid result sync request' }, { status: 400 });
    }
    if (body.expectedVersion !== context.card.version) return NextResponse.json({ conflict: true, serverCard: context.card }, { status: 409 });
    const operationId = operationIdFor(id, body.operationId);
    const attempt = context.card.taskExecutionHistory?.find(entry => entry.operationId === operationId);
    if (!attempt) return NextResponse.json({ error: 'execution operation not found' }, { status: 404 });
    if (attempt.phase === 'result') return NextResponse.json(taskExecutionSnapshot(context.card), { headers: { 'Cache-Control': 'no-store' } });
    if (!['running', 'waiting'].includes(attempt.phase) || !attempt.nativeSessionId) {
      return NextResponse.json({ ...taskExecutionSnapshot(context.card), retryable: false }, { status: 409 });
    }

    const infoTool = await callOwnerHerderTool('agent_info', { harness: attempt.harness, sessionId: attempt.nativeSessionId });
    const info = isRecord(infoTool.structuredContent) ? infoTool.structuredContent : undefined;
    const session = isRecord(info?.session) ? info.session : undefined;
    if (!session || session.id !== attempt.nativeSessionId || session.harness !== attempt.harness
      || session.cwd !== process.env.EXMANAGER_TASK_EXECUTION_CWD
      || session.model !== SESSION_MODEL || typeof session.status !== 'string') {
      return NextResponse.json({ error: 'native session identity could not be verified' }, { status: 502 });
    }
    const nativeLastTurn = isRecord(session.meta) && isRecord(session.meta.nativeLastTurn)
      ? session.meta.nativeLastTurn : undefined;
    const lastActivity = typeof session.lastActivity === 'string' ? session.lastActivity : now();
    if (session.status === 'running') {
      const updated = saveReceiptProgress(id, context.tasksDir, operationId, attempt.requestHash, {
        phase: 'running', lastProgress: 'Нативная сессия выполняет задачу.', lastProgressAt: lastActivity,
      });
      return NextResponse.json(updated ? taskExecutionSnapshot(updated) : taskExecutionSnapshot(context.card), {
        status: 202, headers: { 'Cache-Control': 'no-store' },
      });
    }
    if (session.status === 'needs_input') {
      const updated = saveReceiptProgress(id, context.tasksDir, operationId, attempt.requestHash, {
        phase: 'waiting', lastProgress: 'Нативной сессии требуется ввод или разрешение.', lastProgressAt: lastActivity,
      });
      return NextResponse.json(updated ? taskExecutionSnapshot(updated) : taskExecutionSnapshot(context.card), {
        status: 202, headers: { 'Cache-Control': 'no-store' },
      });
    }
    if (session.status === 'stopped' || session.status === 'error') {
      const updated = saveReceiptProgress(id, context.tasksDir, operationId, attempt.requestHash, {
        phase: 'stopped', lastProgress: 'Нативная сессия остановлена; результат не принят в проверку.', lastProgressAt: lastActivity,
      });
      return NextResponse.json(updated ? taskExecutionSnapshot(updated) : taskExecutionSnapshot(context.card), { headers: { 'Cache-Control': 'no-store' } });
    }

    // Agent history can contain commentary or a previous idle turn. Only the
    // exact turn admitted by this Board operation can become a review result.
    if (session.status !== 'idle' || !nativeLastTurn
      || nativeLastTurn.turnId !== attempt.nativeTurnId || nativeLastTurn.status !== 'completed'
      || nativeLastTurn.assistantSucceeded === false || nativeLastTurn.cancelledByUser === true
      || nativeLastTurn.transportLost === true) {
      return NextResponse.json({
        ...taskExecutionSnapshot(context.card),
        waitReason: 'Ожидается точное подтверждение завершения переданного запуска',
      }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
    }

    const viewTool = await callOwnerHerderTool('fleet_session_view', { harness: attempt.harness, sessionId: attempt.nativeSessionId });
    const view = isRecord(viewTool.structuredContent) ? viewTool.structuredContent : undefined;
    const details = isRecord(view?.details) ? view.details : undefined;
    const native = isRecord(details?.session) ? details.session : undefined;
    if (!details || view?.hostId !== attempt.hostId || native?.id !== attempt.nativeSessionId
      || native?.harness !== attempt.harness || native.cwd !== session.cwd || native.model !== session.model) {
      return NextResponse.json({ error: 'native session identity could not be verified' }, { status: 502 });
    }
    if (details.historyUnavailable === true || !Array.isArray(details.messages)) {
      return NextResponse.json({ ...taskExecutionSnapshot(context.card), waitReason: 'Нативная история пока недоступна' }, { status: 202 });
    }

    // The native transcript is the message source; the index summary is not.
    // Reconfirm the same exact completed turn after reading it to fail closed
    // if another turn started between the terminal proof and transcript read.
    const confirmTool = await callOwnerHerderTool('agent_info', { harness: attempt.harness, sessionId: attempt.nativeSessionId });
    const confirmPayload = isRecord(confirmTool.structuredContent) ? confirmTool.structuredContent : undefined;
    const confirmedSession = isRecord(confirmPayload?.session) ? confirmPayload.session : undefined;
    const confirmedLastTurn = isRecord(confirmedSession?.meta) && isRecord(confirmedSession.meta.nativeLastTurn)
      ? confirmedSession.meta.nativeLastTurn : undefined;
    if (!confirmedSession || confirmedSession.id !== attempt.nativeSessionId || confirmedSession.harness !== attempt.harness
      || confirmedSession.cwd !== session.cwd || confirmedSession.model !== SESSION_MODEL || confirmedSession.status !== 'idle'
      || !confirmedLastTurn || confirmedLastTurn.turnId !== attempt.nativeTurnId || confirmedLastTurn.status !== 'completed'
      || confirmedLastTurn.assistantSucceeded === false || confirmedLastTurn.cancelledByUser === true
      || confirmedLastTurn.transportLost === true) {
      return NextResponse.json({
        ...taskExecutionSnapshot(context.card),
        waitReason: 'Нативный turn изменился при проверке результата; требуется повторное чтение',
      }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
    }
    const messages = details.messages.filter(isRecord);

    const assistant = [...messages].reverse().find(message => message.role === 'assistant' && typeof message.text === 'string' && message.text.trim());
    if (!assistant || typeof assistant.text !== 'string' || !assistant.text.trim()) {
      return NextResponse.json({
        ...taskExecutionSnapshot(context.card),
        waitReason: 'Завершённый запуск пока не содержит проверяемого ответа',
      }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
    }
    const summary = assistant.text.slice(0, 40_000);
    const evidenceRefs = [...new Set(summary.match(/https?:\/\/[^\s<>"')\]]+/g)?.map(url => url.replace(/[.,;:!?]+$/u, '')) ?? [])].slice(0, 50);
    const transition = validateTransition(context.card, {
      executorResult: { summary, evidenceRefs, nextAction: 'Проверьте результат и источники, затем примите решение.' },
    }, { origin: 'automation', actor: attempt.startedBy });
    if (transition.kind !== 'redirected') return NextResponse.json({ error: 'executor result did not enter human review' }, { status: 409 });
    const nextHistory = [...(context.card.taskExecutionHistory ?? [])];
    const index = nextHistory.findIndex(entry => entry.operationId === operationId);
    if (index < 0) return NextResponse.json({ error: 'execution receipt disappeared' }, { status: 409 });
    nextHistory[index] = { ...nextHistory[index]!, phase: 'result', lastBoardVersion: context.card.version + 1, lastProgress: 'Результат сохранён и ожидает проверки человека.', lastProgressAt: now(), updatedAt: now() };
    const saved = updateCard(id, { ...transition.patch, taskExecutionHistory: nextHistory }, context.card.version, context.tasksDir);
    if ('conflict' in saved) return NextResponse.json({ conflict: true, serverCard: saved.serverCard }, { status: 409 });
    return NextResponse.json({ ...taskExecutionSnapshot(saved), card: saved }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'native task result could not be synchronized' }, { status: 502 });
  }
}
