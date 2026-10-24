import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fileStore from '../../../../../../lib/kanban/file-store';
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
vi.mock('@/lib/kanban/task-execution', () => ({ taskExecutionSnapshot: vi.fn() }));
vi.mock('@/lib/kanban/task-execution-client', () => ({ callOwnerHerderTool: vi.fn() }));
vi.mock('@/lib/kanban/transition-policy', () => ({ validateTransition: vi.fn() }));

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-notice-join-'));
const previousNoticeEnv = {
  token: process.env.EXMANAGER_NOTICE_PROJECT_TOKEN,
  recipient: process.env.NOTIFY_CENTER_RECIPIENT,
};

let store: typeof import('@/lib/kanban/file-store');
let route: typeof import('./route');
let server: http.Server;
let serverPort = 0;
let realFetch: typeof globalThis.fetch;
let dropNextPost = false;
let postCount = 0;
let getCount = 0;
const noticeRows = new Map<string, Record<string, unknown>>();

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

function sendJson(response: http.ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

beforeAll(async () => {
  harness.tasksDir = fixtureRoot;
  process.env.EXMANAGER_NOTICE_PROJECT_TOKEN = 'fixture-only-token';
  process.env.NOTIFY_CENTER_RECIPIENT = 'operator-fixture';
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
  noticeRows.clear();
  dropNextPost = false;
  postCount = 0;
  getCount = 0;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const originalUrl = input instanceof Request ? input.url : String(input);
    const source = new URL(originalUrl);
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
  if (previousNoticeEnv.token !== undefined) process.env.EXMANAGER_NOTICE_PROJECT_TOKEN = previousNoticeEnv.token;
  if (previousNoticeEnv.recipient !== undefined) process.env.NOTIFY_CENTER_RECIPIENT = previousNoticeEnv.recipient;
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
