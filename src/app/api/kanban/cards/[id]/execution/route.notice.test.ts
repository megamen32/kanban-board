import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fileStore from '../../../../../../lib/kanban/file-store';
import * as taskExecutionClient from '@/lib/kanban/task-execution-client';
import * as transitionPolicy from '@/lib/kanban/transition-policy';
import * as executionRoute from './route';

const harness = vi.hoisted(() => ({
  identity: { username: 'nikita', scope: 'work' as const },
  tasksDir: '',
}));

vi.mock('@/lib/auth/request', () => ({
  boardIdentityFromRequest: () => harness.identity,
  identityFromRequest: () => harness.identity,
  nativeProjectAccessContextFromRequest: async () => null,
}));
vi.mock('@/lib/auth/data-scope', () => ({ tasksDirForScope: () => harness.tasksDir }));
vi.mock('@/lib/kanban/file-store', async () => import('../../../../../../lib/kanban/file-store'));
vi.mock('@/lib/kanban/task-execution', () => ({ taskExecutionSnapshot: vi.fn((card: { id: string }) => ({ cardId: card.id })) }));
vi.mock('@/lib/kanban/task-execution-client', () => ({ callOwnerHerderTool: vi.fn(), readOwnerHerderResource: vi.fn() }));
vi.mock('@/lib/kanban/transition-policy', () => ({ validateTransition: vi.fn() }));

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-notice-join-'));
const previousNoticeEnv = {
  token: process.env.EXMANAGER_NOTICE_PROJECT_TOKEN,
  recipient: process.env.NOTIFY_CENTER_RECIPIENT,
  baseUrl: process.env.EXMANAGER_NOTICE_API_BASE_URL,
  qaFlag: process.env.KANBAN_QA_ANONYMOUS_READS,
};

let store: typeof import('@/lib/kanban/file-store');
let route: typeof import('./route');
let server: http.Server;
let serverPort = 0;
let realFetch: typeof globalThis.fetch;
let dropNextPost = false;
let postCount = 0;
let getCount = 0;
let resolveCount = 0;
const noticeRows = new Map<string, Record<string, unknown>>();
const observedNoticeOrigins: string[] = [];
const FIXTURE_HUMAN_REQUEST_ID = '67ce04db-d775-4f81-a86d-31af4bbe1091';
const resolveRequests: Array<{ id: string; proposalRef: string; body: Record<string, unknown> }> = [];

function noticeId(taskRef: string, purpose: string, version: string): string {
  return `td-${createHash('sha256').update(JSON.stringify([taskRef, purpose, version])).digest('hex').slice(0, 40)}`;
}

function fixtureView(mandate: Record<string, unknown>, id: string): Record<string, unknown> {
  return {
    schema: 'noticeplace.task_decision_view.v1', request_id: id, project: mandate.project,
    recipient: mandate.recipient, status: 'pending',
    question: { text: mandate.message, mode: 'choice', choices: mandate.choices, expires_at: null,
      reference: { task_ref: mandate.task_ref, purpose: mandate.purpose,
        version: mandate.version, mandate_ref: mandate.mandate_ref } },
    notification: { attempt_state: 'sent', receipt: { kind: 'successful_sender_response', confirmed_at: 100,
      chat_id: 'fixture-chat', message_id: 1 }, deadline_at: 1900 },
    winner: null, control: { state: 'clear' }, late_instructions: [],
    delivery_status: 'sent', idempotent: false,
  };
}

function sortedJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(',')}]`;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${sortedJson(row[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function createExecutorQuestionCard() {
  const created = store.createCard('QA executor question', 'Fictional task result', 'todo', 'medium', [], 'UX QA 2026-10-26', [], fixtureRoot);
  const actorCard = store.updateCard(created.id, { owner: 'testlogin' }, created.version, fixtureRoot);
  if ('conflict' in actorCard) throw new Error('fixture owner CAS failed');
  const operationId = createHash('sha256').update(`${actorCard.id}\0qa-operation`).digest('hex');
  const inputId = 'a'.repeat(64);
  const sessionId = 'qa-opencode-session';
  const hostId = 'roomhacker-server-100';
  const cwd = '/workspace/qa';
  const humanRequestId = FIXTURE_HUMAN_REQUEST_ID;
  const sourceInputMessageId = 'msg_input_1234567890';
  const sourceJobId = `job_${createHash('sha256').update(['user-message', 'opencode', sessionId, inputId].join('\0')).digest('hex')}`;
  const sourceMessageId = 'msg_question_1234567890';
  const sourceMessageHash = 'c'.repeat(64);
  const text = 'Which format should I use?';
  const choices = [{ value: 'brief', label: 'Short table' }, { value: 'total', label: 'Table with total row' }];
  const timeoutValue = 'brief';
  const contextRef = `exmanager-task:${actorCard.id}:${operationId}`;
  const fields = { humanRequestId, sourceMessageId, sourceMessageHash, sourceInputMessageId, sourceJobId, text, choices, timeoutValue };
  const executorQuestion = {
    ...fields, contextRef, registrationMessageId: 'msg_registration_123456789',
    registrationCallId: 'call_registration_123456789', registrationTarget: { harness: 'opencode' as const, sessionId, cwd },
    questionHash: createHash('sha256').update(sortedJson(fields)).digest('hex'),
  };
  const taskDecisionRequest = {
    requestId: noticeId(actorCard.id, 'clarification', String(actorCard.version + 1)),
    requestHash: 'b'.repeat(64), purpose: 'clarification', version: actorCard.version + 1,
  };
  const attempt = {
    operationId, requestHash: 'd'.repeat(64), lastBoardVersion: actorCard.version + 1,
    createInputId: 'e'.repeat(64), messageInputId: inputId, phase: 'waiting' as const,
    hostId, harness: 'opencode' as const,
    projectBinding: { contract: 'integrator-host-readiness-v1' as const, projectId: actorCard.project,
      projectRoot: cwd, rootIdentity: 'qa-root', policyRevision: 'qa-policy-1', observedAtMs: 1,
      runtimeInstanceId: 'qa-runtime-1', hostId, harness: 'opencode' as const, harnessVersion: 'test', model: 'qa-model',
      requiredTools: [], availableTools: [], availableModels: ['qa-model'], resourceReady: true as const, cwd,
      pathResolution: { requestedCwd: cwd, canonicalCwd: cwd, rootPath: cwd, contained: true as const, identityMatches: true as const } },
    nativeSessionId: sessionId, nativeInputMessageId: sourceInputMessageId, nativeDispatchJobId: sourceJobId,
    taskDecisionRequest, executorQuestion, startedBy: 'testlogin', createdAt: actorCard.created, updatedAt: actorCard.updated,
  };
  const card = store.updateCard(actorCard.id, { taskExecutionHistory: [attempt] }, actorCard.version, fixtureRoot);
  if ('conflict' in card) throw new Error('executor question receipt CAS failed');
  const mandate = { task_ref: card.id, purpose: taskDecisionRequest.purpose, version: String(taskDecisionRequest.version),
    mandate_ref: operationId, project: card.project, recipient: 'operator-fixture', message: text,
    choices: choices.map(choice => ({ ...choice })), timeout_value: timeoutValue };
  noticeRows.set(taskDecisionRequest.requestId, fixtureView(mandate, taskDecisionRequest.requestId));
  return { card, operationId, taskDecisionRequest, humanRequestId, value: 'total' };
}

function sendJson(response: http.ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

beforeAll(async () => {
  harness.tasksDir = fixtureRoot;
  process.env.EXMANAGER_NOTICE_PROJECT_TOKEN = 'fixture-only-token';
  process.env.NOTIFY_CENTER_RECIPIENT = 'operator-fixture';
  process.env.EXMANAGER_NOTICE_API_BASE_URL = 'http://192.168.192.1:19450';
  process.env.KANBAN_QA_ANONYMOUS_READS = '1';
  store = fileStore;
  route = executionRoute;
  realFetch = globalThis.fetch;
  server = http.createServer(async (request, response) => {
    if (request.headers.authorization !== 'Bearer fixture-only-token') {
      sendJson(response, 401, { error: 'fixture auth denied' });
      return;
    }
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    if (request.method === 'POST' && pathname === '/v1/task-decisions') {
      let rawBody = '';
      for await (const chunk of request) rawBody += Buffer.from(chunk).toString('utf8');
      const body = JSON.parse(rawBody) as { mandate?: Record<string, unknown> };
      if (!body.mandate || Object.keys(body).length !== 1) {
        sendJson(response, 400, { error: 'fixture accepts one mandate wrapper' });
        return;
      }
      postCount += 1;
      const mandate = body.mandate;
      const id = noticeId(String(mandate.task_ref), String(mandate.purpose), String(mandate.version));
      const existing = noticeRows.get(id);
      const view = existing ?? fixtureView(mandate, id);
      noticeRows.set(id, view);
      if (dropNextPost) {
        dropNextPost = false;
        response.destroy();
        return;
      }
      sendJson(response, existing ? 200 : 201, { ...view, idempotent: Boolean(existing) });
      return;
    }
    if (request.method === 'POST' && /^\/v1\/task-decisions\/td-[a-f0-9]{40}\/resolve$/.test(pathname)) {
      let rawBody = '';
      for await (const chunk of request) rawBody += Buffer.from(chunk).toString('utf8');
      const body = JSON.parse(rawBody) as Record<string, unknown>;
      const proposalRef = String(body.proposal_ref ?? '');
      if (Object.keys(body).length !== 1 || !proposalRef || request.headers['idempotency-key'] !== proposalRef) {
        sendJson(response, 400, { error: 'invalid fixture Board answer request' });
        return;
      }
      resolveCount += 1;
      const id = pathname.split('/')[3]!;
      resolveRequests.push({ id, proposalRef, body });
      const previous = noticeRows.get(id);
      if (!previous) {
        sendJson(response, 404, { error: 'fixture task decision missing' });
        return;
      }
      const winner = { source: 'human', value: 'total', decided_at: 1200 };
      const idempotencyKey = `human-request:${FIXTURE_HUMAN_REQUEST_ID}:qa-attempt`;
      const resolved = { ...previous, status: 'decided', winner, answer_status: 'accepted', answer_accepted: true,
        continuation: { state: 'accepted', request_id: FIXTURE_HUMAN_REQUEST_ID,
          result_ref: '8fa17a22-b5c8-49e8-8434-974846c3792c', idempotency_key: idempotencyKey,
          receipt: `agent-herder://opencode/qa-opencode-session/${idempotencyKey}`,
          input_id: `herder-resume-${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 32)}` } };
      noticeRows.set(id, resolved);
      sendJson(response, 200, resolved);
      return;
    }
    if (request.method === 'GET' && pathname.startsWith('/v1/task-decisions/')) {
      getCount += 1;
      const id = decodeURIComponent(pathname.slice('/v1/task-decisions/'.length));
      const view = noticeRows.get(id);
      if (!view) {
        sendJson(response, 404, { error: 'task decision not found' });
        return;
      }
      const { delivery_status: _deliveryStatus, idempotent: _idempotent, ...readView } = view;
      sendJson(response, 200, readView);
      return;
    }
    sendJson(response, 404, { error: 'fixture route not found' });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('local Notice fixture did not bind a TCP port');
  serverPort = address.port;
});

beforeEach(() => {
  harness.identity = { username: 'nikita', scope: 'work' };
  vi.mocked(taskExecutionClient.callOwnerHerderTool).mockReset();
  vi.mocked(taskExecutionClient.readOwnerHerderResource).mockReset();
  vi.mocked(transitionPolicy.validateTransition).mockReset();
  process.env.KANBAN_QA_ANONYMOUS_READS = '1';
  noticeRows.clear();
  observedNoticeOrigins.length = 0;
  resolveRequests.length = 0;
  dropNextPost = false;
  postCount = 0;
  getCount = 0;
  resolveCount = 0;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const originalUrl = input instanceof Request ? input.url : String(input);
    const source = new URL(originalUrl);
    observedNoticeOrigins.push(source.origin);
    const localUrl = `http://127.0.0.1:${serverPort}${source.pathname}${source.search}`;
    return realFetch(localUrl, init);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  delete process.env.TASKS_DIR;
  delete process.env.EXMANAGER_NOTICE_PROJECT_TOKEN;
  delete process.env.NOTIFY_CENTER_RECIPIENT;
  delete process.env.EXMANAGER_NOTICE_API_BASE_URL;
  delete process.env.KANBAN_QA_ANONYMOUS_READS;
  if (previousNoticeEnv.token !== undefined) process.env.EXMANAGER_NOTICE_PROJECT_TOKEN = previousNoticeEnv.token;
  if (previousNoticeEnv.recipient !== undefined) process.env.NOTIFY_CENTER_RECIPIENT = previousNoticeEnv.recipient;
  if (previousNoticeEnv.baseUrl !== undefined) process.env.EXMANAGER_NOTICE_API_BASE_URL = previousNoticeEnv.baseUrl;
  if (previousNoticeEnv.qaFlag !== undefined) process.env.KANBAN_QA_ANONYMOUS_READS = previousNoticeEnv.qaFlag;
  if (server && server.listening) {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

function createRunningCard() {
  const card = store.createCard('Fixture task', 'Compare source sets', 'todo', 'medium', [], 'Demo', [], fixtureRoot);
  const rawOperationId = `fixture-operation-${card.id.slice(0, 12)}`;
  const operationId = createHash('sha256').update(`${card.id}\0${rawOperationId}`).digest('hex');
  const receipt = {
    operationId, requestHash: 'b'.repeat(64), lastBoardVersion: card.version + 1,
    createInputId: 'c'.repeat(64), messageInputId: 'd'.repeat(64), phase: 'running' as const,
    hostId: 'roomhacker-server-100', harness: 'codex' as const,
    nativeSessionId: `session-${card.id}`, nativeTurnId: `turn-${card.id}`, startedBy: 'nikita',
    createdAt: card.created, updatedAt: card.updated,
  };
  const saved = store.updateCard(card.id, { taskExecutionHistory: [receipt] }, card.version, fixtureRoot);
  if ('conflict' in saved) throw new Error('fixture execution receipt CAS failed');
  return { card: saved, rawOperationId, operationId };
}

function questionRequest(id: string, rawOperationId: string, expectedVersion: number, action = 'create-question') {
  return new NextRequest(`https://todo.example.test/api/kanban/cards/${id}/execution`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      action, expectedVersion, operationId: rawOperationId,
      purpose: 'clarify-scope', message: 'Which source set should I compare?',
      choices: [{ value: 'current', label: 'Current set' }, { value: 'all', label: 'All sources' }],
      timeoutValue: 'current',
    }),
  });
}

describe('Board and disposable Notice task-question join', () => {
  it('stores one authenticated current-card answer proposal and queries the same receipt on a repeated click', async () => {
    const fixture = createExecutorQuestionCard();
    harness.identity = { username: 'testlogin', scope: 'work' };
    const fixtureAttempt = fixture.card.taskExecutionHistory?.at(-1)!;
    expect({
      phase: fixtureAttempt.phase, versionMatches: fixtureAttempt.lastBoardVersion === fixture.card.version,
      operationMatches: fixtureAttempt.operationId === fixture.operationId,
      projectMatches: fixtureAttempt.projectBinding?.projectId === fixture.card.project,
      hostMatches: fixtureAttempt.projectBinding?.hostId === fixtureAttempt.hostId,
      contextMatches: fixtureAttempt.executorQuestion?.contextRef === `exmanager-task:${fixture.card.id}:${fixture.operationId}`,
      inputMatches: fixtureAttempt.executorQuestion?.sourceInputMessageId === fixtureAttempt.nativeInputMessageId,
      jobMatches: fixtureAttempt.executorQuestion?.sourceJobId === fixtureAttempt.nativeDispatchJobId,
      targetMatches: fixtureAttempt.executorQuestion?.registrationTarget.cwd === fixtureAttempt.projectBinding?.cwd,
      choiceExists: fixtureAttempt.executorQuestion?.choices.some(choice => choice.value === fixture.value),
    }).toEqual({ phase: 'waiting', versionMatches: true, operationMatches: true, projectMatches: true,
      hostMatches: true, contextMatches: true, inputMatches: true, jobMatches: true, targetMatches: true, choiceExists: true });
    const answerRequest = (expectedVersion: number, extra: Record<string, unknown> = {}) => new NextRequest(
      `https://todo.example.test/api/kanban/cards/${fixture.card.id}/execution`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'answer-question', expectedVersion,
          operationId: fixture.operationId, value: fixture.value, ...extra }),
      });

    harness.identity = { username: 'someone-else', scope: 'work' };
    const denied = await route.PATCH(answerRequest(fixture.card.version), { params: Promise.resolve({ id: fixture.card.id }) });
    if (!denied) throw new Error('unauthorized answer response missing');
    expect(denied.status).toBe(403);
    harness.identity = { username: 'testlogin', scope: 'work' };
    const forged = await route.PATCH(answerRequest(fixture.card.version, { actor: 'testlogin' }), { params: Promise.resolve({ id: fixture.card.id }) });
    if (!forged) throw new Error('forged actor answer response missing');
    expect(forged.status).toBe(400);
    const stale = await route.PATCH(answerRequest(fixture.card.version - 1), { params: Promise.resolve({ id: fixture.card.id }) });
    if (!stale) throw new Error('stale answer response missing');
    expect(stale.status).toBe(409);
    expect(resolveCount).toBe(0);

    const first = await route.PATCH(answerRequest(fixture.card.version), { params: Promise.resolve({ id: fixture.card.id }) });
    if (!first) throw new Error('Board answer response missing');
    expect(first.status, JSON.stringify(await first.clone().json())).toBe(200);
    const persisted = store.findCardById(fixture.card.id, fixtureRoot)!;
    const receipt = persisted.taskExecutionHistory?.at(-1)!;
    expect(receipt).toMatchObject({ phase: 'waiting', lastBoardVersion: persisted.version,
      taskDecisionProposal: { requestId: fixture.taskDecisionRequest.requestId,
        humanRequestId: fixture.humanRequestId, value: fixture.value, authenticatedActor: 'testlogin',
        cardVersion: persisted.version, sourceMessageId: receipt.executorQuestion?.sourceMessageId,
        sourceJobId: receipt.executorQuestion?.sourceJobId, stopEpoch: receipt.messageInputId,
        proposalRef: expect.stringMatching(/^board-[a-f0-9]{40}$/) } });
    expect(resolveCount).toBe(1);
    expect(resolveRequests).toEqual([{ id: fixture.taskDecisionRequest.requestId,
      proposalRef: receipt.taskDecisionProposal?.proposalRef,
      body: { proposal_ref: receipt.taskDecisionProposal?.proposalRef } }]);
    expect(await first.json()).toMatchObject({ answerStatus: 'accepted', taskQuestion: {
      answerStatus: 'accepted', decision: { source: 'human', value: fixture.value },
      continuation: { state: 'accepted', request_id: fixture.humanRequestId,
        result_ref: '8fa17a22-b5c8-49e8-8434-974846c3792c',
        idempotency_key: `human-request:${fixture.humanRequestId}:qa-attempt`,
        receipt: `agent-herder://opencode/qa-opencode-session/human-request:${fixture.humanRequestId}:qa-attempt`,
        input_id: `herder-resume-${createHash('sha256').update(`human-request:${fixture.humanRequestId}:qa-attempt`).digest('hex').slice(0, 32)}` },
    } });

    const duplicate = await route.PATCH(answerRequest(persisted.version), { params: Promise.resolve({ id: fixture.card.id }) });
    if (!duplicate) throw new Error('Board duplicate answer readback missing');
    expect(duplicate.status).toBe(200);
    expect(resolveCount).toBe(1);
    expect(getCount).toBe(1);
    expect(await duplicate.json()).toMatchObject({ answerStatus: 'accepted', taskQuestion: {
      decision: { source: 'human', value: fixture.value }, continuation: { state: 'accepted' },
    } });
  });

  it('accepts a result only after the exact Notice and Herder callback readback', async () => {
    const fixture = createExecutorQuestionCard();
    harness.identity = { username: 'testlogin', scope: 'work' };
    const answer = await route.PATCH(new NextRequest(`https://todo.example.test/api/kanban/cards/${fixture.card.id}/execution`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'answer-question', expectedVersion: fixture.card.version,
        operationId: fixture.operationId, value: fixture.value }),
    }), { params: Promise.resolve({ id: fixture.card.id }) });
    if (!answer) throw new Error('question answer response missing');
    expect(answer.status).toBe(200);
    const answered = store.findCardById(fixture.card.id, fixtureRoot)!;
    const attempt = answered.taskExecutionHistory?.at(-1)!;
    const idempotencyKey = `human-request:${fixture.humanRequestId}:qa-attempt`;
    const inputId = `herder-resume-${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 32)}`;
    const savedNotice = noticeRows.get(fixture.taskDecisionRequest.requestId)!;
    noticeRows.set(fixture.taskDecisionRequest.requestId, { ...savedNotice, continuation: { state: 'queued' } });
    const waiting = await route.PATCH(new NextRequest(`https://todo.example.test/api/kanban/cards/${fixture.card.id}/execution`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'sync-result', expectedVersion: answered.version, operationId: fixture.operationId }),
    }), { params: Promise.resolve({ id: fixture.card.id }) });
    if (!waiting) throw new Error('queued continuation response missing');
    expect(waiting.status).toBe(202);
    expect(vi.mocked(taskExecutionClient.callOwnerHerderTool)).not.toHaveBeenCalled();
    noticeRows.set(fixture.taskDecisionRequest.requestId, { ...savedNotice, continuation: {
      state: 'accepted', request_id: fixture.humanRequestId, result_ref: '8fa17a22-b5c8-49e8-8434-974846c3792c',
      idempotency_key: idempotencyKey, receipt: `agent-herder://opencode/wrong-session/${idempotencyKey}`,
    } });
    const mismatchedReceipt = await route.PATCH(new NextRequest(`https://todo.example.test/api/kanban/cards/${fixture.card.id}/execution`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'sync-result', expectedVersion: answered.version, operationId: fixture.operationId }),
    }), { params: Promise.resolve({ id: fixture.card.id }) });
    if (!mismatchedReceipt) throw new Error('mismatched continuation receipt response missing');
    expect(mismatchedReceipt.status).toBe(202);
    expect(vi.mocked(taskExecutionClient.callOwnerHerderTool)).not.toHaveBeenCalled();
    noticeRows.set(fixture.taskDecisionRequest.requestId, savedNotice);
    const callbackInputMessageId = 'msg_callback_123456789';
    const callbackTurnId = 'turn_after_answer_123456';
    const messagesUri = `herder://sessions/opencode/${encodeURIComponent(attempt.nativeSessionId!)}/messages`;
    const messages = [
      { id: attempt.executorQuestion!.sourceInputMessageId, inputId: attempt.messageInputId, role: 'user', turnId: 'turn_question' },
      { id: attempt.executorQuestion!.registrationMessageId, role: 'assistant', turnId: 'turn_question', phase: 'completed', parts: [] },
      { id: attempt.executorQuestion!.sourceMessageId, role: 'assistant', turnId: 'turn_question', phase: 'completed', parts: [{ type: 'text', text: '{"kind":"question"}' }] },
      { id: callbackInputMessageId, inputId, role: 'user', turnId: callbackTurnId, parts: [{ type: 'text', text: 'The human selected total.' }] },
      { id: 'msg_callback_result_123456', role: 'assistant', turnId: callbackTurnId,
        nativeParentMessageId: callbackInputMessageId, phase: 'completed', parts: [{ type: 'text', text: 'The full summary is ready.' }] },
    ];
    vi.mocked(taskExecutionClient.readOwnerHerderResource).mockResolvedValue({ contents: [{
      uri: messagesUri, mimeType: 'application/json', text: JSON.stringify(messages),
    }] } as never);
    vi.mocked(taskExecutionClient.callOwnerHerderTool).mockImplementation(async (tool: string) => {
      if (tool === 'agent_info') return { structuredContent: { session: {
        id: attempt.nativeSessionId, harness: 'opencode', hostId: attempt.hostId, cwd: attempt.projectBinding!.cwd,
        model: attempt.projectBinding!.model, status: 'idle',
        meta: { nativeLastTurn: { turnId: callbackTurnId, status: 'completed', assistantSucceeded: true } },
      } }, content: [] } as never;
      throw new Error(`unexpected Herder tool ${tool}`);
    });
    const currentCard = store.findCardById(fixture.card.id, fixtureRoot)!;
    vi.mocked(transitionPolicy.validateTransition).mockReturnValue({ kind: 'redirected', patch: {
      column: 'review', needsReview: true, resultHistory: [{ summary: 'The full summary is ready.', evidenceRefs: [],
        submittedBy: 'testlogin', submittedAt: new Date().toISOString() }],
    } } as never);
    const result = await route.PATCH(new NextRequest(`https://todo.example.test/api/kanban/cards/${fixture.card.id}/execution`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'sync-result', expectedVersion: currentCard.version, operationId: fixture.operationId }),
    }), { params: Promise.resolve({ id: fixture.card.id }) });
    if (!result) throw new Error('continued task result response missing');
    expect(result.status).toBe(200);
    expect(store.findCardById(fixture.card.id, fixtureRoot)?.taskExecutionHistory?.at(-1)).toMatchObject({
      phase: 'result', nativeTurnId: callbackTurnId,
      taskDecisionContinuation: { requestId: fixture.humanRequestId, idempotencyKey, inputId,
        nativeInputMessageId: callbackInputMessageId, nativeTurnId: callbackTurnId, assistantMessageId: 'msg_callback_result_123456' },
    });
    expect(store.findCardById(fixture.card.id, fixtureRoot)?.resultHistory?.at(-1)?.summary).toBe('The full summary is ready.');
    const callsAfterResult = vi.mocked(taskExecutionClient.callOwnerHerderTool).mock.calls.length;
    const duplicate = await route.PATCH(new NextRequest(`https://todo.example.test/api/kanban/cards/${fixture.card.id}/execution`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'sync-result', expectedVersion: store.findCardById(fixture.card.id, fixtureRoot)!.version,
        operationId: fixture.operationId }),
    }), { params: Promise.resolve({ id: fixture.card.id }) });
    if (!duplicate) throw new Error('continued task result readback missing');
    expect(duplicate.status).toBe(200);
    expect(vi.mocked(taskExecutionClient.callOwnerHerderTool)).toHaveBeenCalledTimes(callsAfterResult);
  });

  it('keeps the Board answer fenced when a STOP has already been accepted', async () => {
    const fixture = createExecutorQuestionCard();
    harness.identity = { username: 'testlogin', scope: 'work' };
    const stoppedControl = { requestHash: 'f'.repeat(64), phase: 'accepted' as const, updatedAt: new Date().toISOString() };
    const current = store.findCardById(fixture.card.id, fixtureRoot)!;
    const attempt = current.taskExecutionHistory?.at(-1)!;
    const stopped = store.updateCard(fixture.card.id, { taskExecutionHistory: [{
      ...attempt, lastBoardVersion: current.version + 1,
      sessionControls: { stops: [stoppedControl], stop: stoppedControl },
    }] }, current.version, fixtureRoot);
    if ('conflict' in stopped) throw new Error('fixture STOP CAS failed');
    const response = await route.PATCH(new NextRequest(`https://todo.example.test/api/kanban/cards/${fixture.card.id}/execution`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'answer-question', expectedVersion: stopped.version,
        operationId: fixture.operationId, value: fixture.value }),
    }), { params: Promise.resolve({ id: fixture.card.id }) });
    if (!response) throw new Error('stopped answer response missing');
    expect(response.status).toBe(409);
    expect(resolveCount).toBe(0);
    expect(store.findCardById(fixture.card.id, fixtureRoot)?.taskExecutionHistory?.[0]?.taskDecisionProposal).toBeUndefined();
  });

  it('rejects the private QA Notice HTTP override when the QA runtime flag is absent', async () => {
    const { card, rawOperationId } = createRunningCard();
    process.env.KANBAN_QA_ANONYMOUS_READS = '0';
    const response = await route.PATCH(questionRequest(card.id, rawOperationId, card.version), { params: Promise.resolve({ id: card.id }) });
    if (!response) throw new Error('private Notice override refusal missing');
    expect(response.status).toBe(503);
    expect(postCount).toBe(0);
    expect(observedNoticeOrigins).toEqual([]);
  });

  it('persists, reopens and reads the exact Notice reference through the authenticated Board route', async () => {
    const { card, rawOperationId, operationId } = createRunningCard();
    const response = await route.PATCH(questionRequest(card.id, rawOperationId, card.version), { params: Promise.resolve({ id: card.id }) });
    if (!response) throw new Error('question create response missing');
    expect(response.status).toBe(201);

    const persisted = store.findCardById(card.id, fixtureRoot)!;
    const reference = persisted.taskExecutionHistory?.[0]?.taskDecisionRequest;
    expect(reference).toMatchObject({ requestId: expect.stringMatching(/^td-[a-f0-9]{40}$/),
      purpose: 'clarify-scope', version: card.version + 1, requestHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(persisted.taskExecutionHistory?.[0]).toMatchObject({ operationId, lastBoardVersion: persisted.version });
    const reopened = store.readCardFile(path.join(fixtureRoot, persisted.fileName), fixtureRoot)!;
    expect(reopened.taskExecutionHistory?.[0]?.taskDecisionRequest).toEqual(reference);

    const read = await route.GET(new NextRequest(`https://todo.example.test/api/kanban/cards/${card.id}/execution?question=latest`), {
      params: Promise.resolve({ id: card.id }),
    });
    if (!read) throw new Error('question read response missing');
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ taskQuestion: {
      requestId: reference?.requestId, purpose: 'clarify-scope', state: 'pending',
      question: { text: 'Which source set should I compare?' }, notification: { delivered: true },
    } });
    expect(postCount).toBe(1);
    expect(getCount).toBe(1);
    expect(observedNoticeOrigins.every(origin => origin === 'http://192.168.192.1:19450')).toBe(true);
  });

  it('serializes concurrent creates with one Markdown version transition and one Notice POST', async () => {
    const { card, rawOperationId } = createRunningCard();
    const request = () => questionRequest(card.id, rawOperationId, card.version);
    const invoke = () => route.PATCH(request(), { params: Promise.resolve({ id: card.id }) });
    const [first, second] = await Promise.all([invoke(), invoke()]);
    if (!first || !second) throw new Error('concurrent task question response missing');
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    expect(postCount).toBe(1);
    const persisted = store.findCardById(card.id, fixtureRoot)!;
    expect(persisted.version).toBe(card.version + 1);
    expect(persisted.taskExecutionHistory?.[0]?.taskDecisionRequest?.requestId).toMatch(/^td-[a-f0-9]{40}$/);
  });

  it('denies a new question after an unrelated card revision without writing or contacting Notice', async () => {
    const { card, rawOperationId } = createRunningCard();
    const edited = store.updateCard(card.id, { description: 'Unrelated current edit' }, card.version, fixtureRoot);
    if ('conflict' in edited) throw new Error('fixture unrelated edit CAS failed');
    const response = await route.PATCH(questionRequest(card.id, rawOperationId, edited.version), {
      params: Promise.resolve({ id: card.id }),
    });
    if (!response) throw new Error('stale execution question response missing');
    expect(response.status).toBe(409);
    const persisted = store.findCardById(card.id, fixtureRoot)!;
    expect(persisted.version).toBe(edited.version);
    expect(persisted.taskExecutionHistory?.[0]?.taskDecisionRequest).toBeUndefined();
    expect(postCount).toBe(0);
  });

  it('keeps a lost Notice response query-only and does not repeat a possibly accepted question', async () => {
    const { card, rawOperationId } = createRunningCard();
    dropNextPost = true;
    const response = await route.PATCH(questionRequest(card.id, rawOperationId, card.version), { params: Promise.resolve({ id: card.id }) });
    if (!response) throw new Error('ambiguous question response missing');
    expect(response.status).toBe(202);
    expect(postCount).toBe(1);
    const persisted = store.findCardById(card.id, fixtureRoot)!;
    const reference = persisted.taskExecutionHistory?.[0]?.taskDecisionRequest;
    expect(reference?.requestId).toMatch(/^td-[a-f0-9]{40}$/);

    const read = await route.GET(new NextRequest(`https://todo.example.test/api/kanban/cards/${card.id}/execution?question=latest`), {
      params: Promise.resolve({ id: card.id }),
    });
    if (!read) throw new Error('reconciled question read response missing');
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ taskQuestion: { requestId: reference?.requestId, state: 'pending' } });
    expect(postCount).toBe(1);
    expect(getCount).toBe(1);
  });

  it('denies stale CAS and current non-owner reads before contacting Notice', async () => {
    const { card, rawOperationId } = createRunningCard();
    const stale = await route.PATCH(questionRequest(card.id, rawOperationId, card.version - 1), { params: Promise.resolve({ id: card.id }) });
    if (!stale) throw new Error('stale question response missing');
    expect(stale.status).toBe(409);

    harness.identity = { username: 'another-person', scope: 'work' };
    const denied = await route.GET(new NextRequest(`https://todo.example.test/api/kanban/cards/${card.id}/execution?question=latest`), {
      params: Promise.resolve({ id: card.id }),
    });
    if (!denied) throw new Error('question authorization response missing');
    expect(denied.status).toBe(403);
    expect(postCount).toBe(0);
    expect(getCount).toBe(0);
  });
});
