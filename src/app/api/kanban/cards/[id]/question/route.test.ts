import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as store from '../../../../../../lib/kanban/file-store';
import { callOwnerHerderTool } from '@/lib/kanban/task-execution-client';
import { executorProtocolBlock, reconcileQuestionDelivery } from '../../../../../../lib/kanban/board-questions';
import { runDueReminderTick } from '../../../../../../lib/notifications/scheduler';
import * as questionRoute from './route';
import * as answerRoute from '../answer/route';
import * as resultRoute from '../result/route';

const harness = vi.hoisted(() => ({ tasksDir: '' }));
vi.mock('../../../../../../lib/auth/data-scope', () => ({ tasksDirForScope: () => harness.tasksDir }));
vi.mock('@/lib/kanban/task-execution-client', () => ({ callOwnerHerderTool: vi.fn(), readOwnerHerderResource: vi.fn() }));
vi.mock('../../../../../../lib/kanban/source-launch', () => ({ consumeSourceIntentLaunchOnce: vi.fn() }));

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-board-questions-'));
harness.tasksDir = fixtureRoot;
const KEY = 'k'.repeat(64);
const AUTOMATION = 'automation-secret-for-tests';
const send = vi.mocked(callOwnerHerderTool);
const CHOICES = [{ value: 'a', label: 'Вариант А' }, { value: 'b', label: 'Вариант Б' }];

afterAll(() => { fs.rmSync(fixtureRoot, { recursive: true, force: true }); });

beforeEach(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  fs.mkdirSync(fixtureRoot, { recursive: true });
  send.mockReset();
  send.mockResolvedValue({ content: [{ type: 'text', text: 'queued' }] });
  vi.stubEnv('KANBAN_AUTOMATION_TOKEN', AUTOMATION);
  vi.stubEnv('KANBAN_QUESTION_TIMEOUT_MS', '1800000');
  vi.stubEnv('EXMANAGER_NOTICE_PROJECT_TOKEN', '');
  vi.stubEnv('NOTIFY_CENTER_RECIPIENT', '');
});

function runningCard() {
  const created = store.createCard('Board question', 'Fictional task', 'todo', 'medium', [], 'Demo', [], fixtureRoot);
  const operationId = createHash('sha256').update(created.id).digest('hex');
  const receipt = {
    operationId, requestHash: 'b'.repeat(64), lastBoardVersion: created.version + 2,
    createInputId: 'c'.repeat(64), messageInputId: 'd'.repeat(64), phase: 'running' as const,
    hostId: 'roomhacker-server-100', harness: 'opencode' as const,
    nativeSessionId: 'ses_board_question', nativeTurnId: 'turn-1', startedBy: 'nikita',
    executorKeyHash: createHash('sha256').update(KEY).digest('hex'),
    createdAt: created.created, updatedAt: created.updated,
  };
  const moved = store.updateCard(created.id, { column: 'in-progress', taskExecutionHistory: [receipt] }, created.version, fixtureRoot);
  if ('conflict' in moved) throw new Error('fixture CAS failed');
  return { card: moved, operationId };
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (id: string, sub: string, body: unknown, headers: Record<string, string>) => new NextRequest(
  `https://board.example.test/api/kanban/cards/${id}/${sub}`,
  { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const asExecutor = { 'x-kanban-executor-key': KEY };
const asAutomation = { 'x-kanban-automation-token': AUTOMATION };
const ask = (id: string, extra: Record<string, unknown> = {}) => questionRoute.POST(
  post(id, 'question', { question: 'Какой вариант?', choices: CHOICES, timeoutValue: 'b', ...extra }, asExecutor), ctx(id));

describe('board-owned executor questions', () => {
  it('rejects a wrong or missing executor key and invalid bodies', async () => {
    const { card } = runningCard();
    const wrong = await questionRoute.POST(post(card.id, 'question', { question: 'q', choices: CHOICES }, { 'x-kanban-executor-key': 'x'.repeat(64) }), ctx(card.id));
    expect(wrong.status).toBe(401);
    const missing = await questionRoute.POST(post(card.id, 'question', { question: 'q', choices: CHOICES }, {}), ctx(card.id));
    expect(missing.status).toBe(401);
    expect((await ask(card.id, { choices: [CHOICES[0]] })).status).toBe(400);
    expect((await ask(card.id, { choices: [CHOICES[0], { value: 'a', label: 'dup' }] })).status).toBe(400);
    expect((await ask(card.id, { timeoutValue: 'zzz' })).status).toBe(400);
    expect((await ask(card.id, { question: 'x'.repeat(501) })).status).toBe(400);
    expect(store.findCardById(card.id, fixtureRoot)?.pendingQuestion).toBeUndefined();
  });

  it('stores a valid question and moves the attempt to waiting', async () => {
    const { card } = runningCard();
    const response = await ask(card.id);
    expect(response.status).toBe(201);
    const saved = store.findCardById(card.id, fixtureRoot)!;
    expect(saved.pendingQuestion).toMatchObject({ text: 'Какой вариант?', choices: CHOICES, timeoutValue: 'b' });
    expect(saved.taskExecutionHistory?.at(-1)?.phase).toBe('waiting');
    expect((await ask(card.id)).status).toBe(409);
  });

  it('accepts the question as proof of dispatch after an uncertain admission', async () => {
    const { card } = runningCard();
    const history = card.taskExecutionHistory!.map(item => ({ ...item, phase: 'dispatch-unknown' as const }));
    store.updateCard(card.id, { taskExecutionHistory: history }, card.version, fixtureRoot);
    expect((await ask(card.id)).status).toBe(201);
    expect(store.findCardById(card.id, fixtureRoot)?.taskExecutionHistory?.at(-1)?.phase).toBe('waiting');
  });

  it('answers by automation token, delivers once into the same session and is idempotent', async () => {
    const { card } = runningCard();
    await ask(card.id);
    const bad = await answerRoute.POST(post(card.id, 'answer', { value: 'zzz' }, asAutomation), ctx(card.id));
    expect(bad.status).toBe(400);
    const denied = await answerRoute.POST(post(card.id, 'answer', { value: 'a' }, {}), ctx(card.id));
    expect(denied.status).toBe(401);
    const first = await answerRoute.POST(post(card.id, 'answer', { value: 'a' }, asAutomation), ctx(card.id));
    expect(first.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toBe('send_message');
    expect(send.mock.calls[0]![1]).toMatchObject({
      sessionId: 'ses_board_question', harness: 'opencode', mode: 'queue', humanRequested: true,
      message: 'Ответ владельца на твой вопрос «Какой вариант?»: «Вариант А» (value: a). Продолжай задачу с этого места.',
    });
    const saved = store.findCardById(card.id, fixtureRoot)!;
    expect(saved.pendingQuestion?.answer).toMatchObject({ value: 'a', label: 'Вариант А', by: 'automation' });
    expect(saved.pendingQuestion?.deliveredAt).toBeUndefined();
    expect(saved.pendingQuestion?.deliveryAcceptedAt).toBeTruthy();
    expect(saved.taskExecutionHistory?.at(-1)?.phase).toBe('running');
    const second = await answerRoute.POST(post(card.id, 'answer', { value: 'b' }, asAutomation), ctx(card.id));
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ idempotent: true, answer: { value: 'a' } });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('records a delivery error without losing the stored answer', async () => {
    const { card } = runningCard();
    await ask(card.id);
    send.mockRejectedValue(new Error('task_execution_transport_unknown'));
    const response = await answerRoute.POST(post(card.id, 'answer', { value: 'a' }, asAutomation), ctx(card.id));
    expect(response.status).toBe(200);
    const saved = store.findCardById(card.id, fixtureRoot)!;
    expect(saved.pendingQuestion?.answer?.value).toBe('a');
    expect(saved.pendingQuestion?.deliveryError).toBe('task_execution_transport_unknown');
  });

  it('marks delivery only after the exact durable job is completed', async () => {
    const { card } = runningCard();
    await ask(card.id);
    await answerRoute.POST(post(card.id, 'answer', { value: 'a' }, asAutomation), ctx(card.id));
    const answered = store.findCardById(card.id, fixtureRoot)!;
    const inputId = createHash('sha256').update(`board-answer\0${card.id}\0${answered.pendingQuestion!.id}`).digest('hex');
    const onceKey = ['user-message', 'opencode', 'ses_board_question', inputId].join('\0');
    const jobId = `job_${createHash('sha256').update(onceKey).digest('hex')}`;
    send.mockResolvedValueOnce({ content: [], structuredContent: { job: { id: jobId, state: 'running' } } });
    await reconcileQuestionDelivery(answered, fixtureRoot);
    expect(store.findCardById(card.id, fixtureRoot)?.pendingQuestion?.deliveredAt).toBeUndefined();
    send.mockResolvedValueOnce({ content: [], structuredContent: { job: { id: jobId, state: 'completed', ownerSessionId: 'ses_board_question', onceKey,
      result: { ok: true, admitted: true, inputId, nativeInputMessageId: 'msg_12345678' } } } });
    await reconcileQuestionDelivery(answered, fixtureRoot);
    expect(store.findCardById(card.id, fixtureRoot)?.pendingQuestion?.deliveredAt).toBeTruthy();
    expect(send.mock.calls.filter(call => call[0] === 'send_message')).toHaveLength(1);
  });

  it('result moves the card to review with the text', async () => {
    const { card } = runningCard();
    const denied = await resultRoute.POST(post(card.id, 'result', { text: 'готово' }, { 'x-kanban-executor-key': 'x'.repeat(64) }), ctx(card.id));
    expect(denied.status).toBe(401);
    const response = await resultRoute.POST(post(card.id, 'result', { text: 'Готово: https://example.com/a.' }, asExecutor), ctx(card.id));
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    const saved = store.findCardById(card.id, fixtureRoot)!;
    expect(saved.column).toBe('review');
    expect(saved.needsReview).toBe(true);
    expect(saved.resultHistory?.at(-1)?.summary).toContain('Готово');
    expect(saved.taskExecutionHistory?.at(-1)?.phase).toBe('result');
    const again = await resultRoute.POST(post(card.id, 'result', { text: 'ещё' }, asExecutor), ctx(card.id));
    expect(again.status).toBe(401);
  });

  it('lazily applies timeoutValue to an overdue unanswered question', async () => {
    const { card } = runningCard();
    await ask(card.id);
    const url = `https://board.example.test/api/kanban/cards/${card.id}/question`;
    const fresh = await questionRoute.GET(new NextRequest(url, { headers: asAutomation }), ctx(card.id));
    expect((await fresh.json()).question.answer).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
    vi.stubEnv('KANBAN_QUESTION_TIMEOUT_MS', '1');
    await new Promise(resolve => setTimeout(resolve, 10));
    const late = await questionRoute.GET(new NextRequest(url, { headers: asExecutor }), ctx(card.id));
    expect((await late.json()).question.answer).toMatchObject({ value: 'b', by: 'timeout' });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![1]).toMatchObject({ message: expect.stringContaining('(value: b)') });
  });

  it('sends the default answer on the scheduler tick without a board request', async () => {
    const { card } = runningCard();
    await ask(card.id);
    vi.stubEnv('KANBAN_QUESTION_TIMEOUT_MS', '1');
    await new Promise(resolve => setTimeout(resolve, 10));
    await runDueReminderTick(new Date(), { scopes: ['work'], tasksDir: () => fixtureRoot });
    expect(store.findCardById(card.id, fixtureRoot)?.pendingQuestion?.answer).toMatchObject({ value: 'b', by: 'timeout' });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![1]).toMatchObject({ message: expect.stringContaining('по умолчанию') });
    await runDueReminderTick(new Date(), { scopes: ['work'], tasksDir: () => fixtureRoot });
    expect(send.mock.calls.filter(call => call[0] === 'send_message')).toHaveLength(1);
  });

  it('does not resume a stopped attempt when a question times out', async () => {
    const { card } = runningCard();
    await ask(card.id);
    const waiting = store.findCardById(card.id, fixtureRoot)!;
    const history = waiting.taskExecutionHistory!.map(item => ({ ...item, phase: 'stopped' as const }));
    store.updateCard(card.id, { taskExecutionHistory: history }, waiting.version, fixtureRoot);
    vi.stubEnv('KANBAN_QUESTION_TIMEOUT_MS', '1');
    await new Promise(resolve => setTimeout(resolve, 10));
    await runDueReminderTick(new Date(), { scopes: ['work'], tasksDir: () => fixtureRoot });
    expect(send).not.toHaveBeenCalled();
    expect(store.findCardById(card.id, fixtureRoot)?.pendingQuestion?.answer).toBeUndefined();
  });

  it('builds a short protocol block that carries the key and the exact commands', () => {
    const block = executorProtocolBlock('card-1', KEY);
    expect(block.split('\n').length).toBeLessThanOrEqual(12);
    expect(block).toContain(`x-kanban-executor-key: ${KEY}`);
    expect(block).toContain('http://127.0.0.1:43327/api/kanban/cards/card-1/question');
    expect(block).toContain('/api/kanban/cards/card-1/result');
  });
});

