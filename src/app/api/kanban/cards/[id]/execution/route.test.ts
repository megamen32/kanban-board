import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { KanbanCard } from '@/lib/kanban/types';

const mocks = vi.hoisted(() => ({
  currentCard: { value: undefined as KanbanCard | undefined },
  findCardById: vi.fn(),
  updateCard: vi.fn(),
  tasksDirForScope: vi.fn(),
  identity: { value: { username: 'nikita', scope: 'work' as const } as { username: string; scope: 'work' } | null },
  humanIdentity: { value: undefined as { username: string; scope: 'work' } | null | undefined },
  boardHumanIdentityFromRequest: vi.fn(),
  callOwnerHerderTool: vi.fn(),
  validateTransition: vi.fn(),
  taskExecutionSnapshot: vi.fn(),
  sessionInfo: { value: undefined as Record<string, unknown> | undefined },
  turnChangesAfterView: { value: false },
}));

vi.mock('@/lib/kanban/file-store', () => ({ findCardById: mocks.findCardById, updateCard: mocks.updateCard }));
vi.mock('@/lib/auth/request', () => ({
  boardIdentityFromRequest: () => mocks.identity.value ?? { username: 'anonymous', scope: 'work' },
  identityFromRequest: () => mocks.identity.value,
}));
vi.mock('../../../../../../lib/auth/board-human', () => ({
  boardHumanIdentityFromRequest: mocks.boardHumanIdentityFromRequest,
}));
vi.mock('@/lib/auth/data-scope', () => ({ tasksDirForScope: mocks.tasksDirForScope }));
vi.mock('@/lib/kanban/task-execution', () => ({ taskExecutionSnapshot: mocks.taskExecutionSnapshot }));
vi.mock('@/lib/kanban/task-execution-client', () => ({ callOwnerHerderTool: mocks.callOwnerHerderTool }));
vi.mock('@/lib/kanban/transition-policy', () => ({ validateTransition: mocks.validateTransition }));

import { GET, PATCH, POST } from './route';

const baseCard: KanbanCard = {
  id: 'task-1', title: 'Research candidates', description: 'Find two SMB integrators', column: 'todo',
  priority: 'medium', tags: [], order: 1, created: '2026-10-20T10:00:00.000Z', updated: '2026-10-20T10:00:00.000Z',
  fileName: 'task.md', version: 4, project: 'Demo', assignees: [], owner: 'nikita',
};
const operationId = 'ui-operation-1234567890';
const sessionId = 'native-session-1';
const cwd = '/srv/excode';
const questionOperationId = 'question-operation-1234567890';
const canonicalQuestionOperationId = createHash('sha256').update(`${baseCard.id}\0${questionOperationId}`).digest('hex');

function postRequest(body: Record<string, unknown> = { operationId, expectedVersion: 4 }) {
  return new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

function runningQuestionCard(): KanbanCard {
  return {
    ...baseCard,
    taskExecutionHistory: [{
      operationId: canonicalQuestionOperationId,
      requestHash: 'f'.repeat(64),
      lastBoardVersion: baseCard.version,
      createInputId: '1'.repeat(64), messageInputId: '2'.repeat(64), phase: 'running',
      hostId: 'roomhacker-server-100', harness: 'codex', nativeSessionId: 'question-session',
      nativeTurnId: 'question-turn', startedBy: 'nikita',
      createdAt: baseCard.created, updatedAt: baseCard.updated,
    }],
  };
}

function createQuestionRequest(expectedVersion = baseCard.version, extra: Record<string, unknown> = {}) {
  return new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution', {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      action: 'create-question', expectedVersion, operationId: questionOperationId,
      purpose: 'clarify-scope', message: 'Which source set should I compare?',
      choices: [{ value: 'current', label: 'Current project only' }, { value: 'all', label: 'All available sources' }],
      timeoutValue: 'current', ...extra,
    }),
  });
}

function expectedNoticeRequestId(taskId: string, purpose: string, version: number): string {
  return `td-${createHash('sha256').update(JSON.stringify([taskId, purpose, String(version)])).digest('hex').slice(0, 40)}`;
}

function noticeQuestionView(input: {
  requestId: string; taskRef: string; operationId: string; purpose: string; version: number;
  winner?: { source: 'human' | 'timeout'; value: string; decided_at: number } | null;
  deliveryStatus?: string; idempotent?: boolean;
}) {
  return {
    schema: 'noticeplace.task_decision_view.v1', request_id: input.requestId,
    project: 'Demo', recipient: 'operator-fixture', status: input.winner?.source === 'timeout' ? 'expired'
      : input.winner?.source === 'human' ? 'resolved' : 'pending',
    question: { text: 'Which source set should I compare?', mode: 'choice',
      choices: [{ value: 'current', label: 'Current project only' }, { value: 'all', label: 'All available sources' }],
      expires_at: null, reference: { task_ref: input.taskRef, purpose: input.purpose, version: String(input.version), mandate_ref: input.operationId } },
    notification: { attempt_state: 'sent', receipt: { kind: 'successful_sender_response', confirmed_at: 123, chat_id: 'private-id', message_id: 45 }, deadline_at: 456 },
    winner: input.winner ? input.winner : null,
    ...(input.deliveryStatus ? { delivery_status: input.deliveryStatus } : {}),
    ...(input.idempotent !== undefined ? { idempotent: input.idempotent } : {}),
  };
}

function noticeResponse(body: unknown, status = 201): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function toolResult(tool: string, args: Record<string, unknown>) {
  if (tool === 'fleet_node_info') {
    return { structuredContent: { hostId: 'roomhacker-server-100', nativeUser: 'operator' }, content: [] };
  }
  if (tool === 'fleet_create_session') {
    return { structuredContent: {
      ok: true, created: true, inputId: args.inputId, harness: 'codex', sessionId, cwd: args.cwd,
    }, content: [] };
  }
  if (tool === 'fleet_session_view') {
    const result = { structuredContent: {
      hostId: 'roomhacker-server-100', details: {
        session: { id: sessionId, harness: 'codex', cwd, model: 'gpt-6-luna' },
        historyUnavailable: false, messages: [{ role: 'assistant', text: 'Found two candidates' }],
      },
    }, content: [] };
    if (mocks.turnChangesAfterView.value) {
      mocks.turnChangesAfterView.value = false;
      mocks.sessionInfo.value = {
        ...mocks.sessionInfo.value,
        meta: { nativeLastTurn: { turnId: 'new-turn-started-during-read', status: 'inProgress' } },
      };
    }
    return result;
  }
  if (tool === 'agent_info') return { structuredContent: { session: mocks.sessionInfo.value }, content: [] };
  if (tool === 'send_message') {
    return { content: [{ type: 'text', text: `Native admission receipt: ${JSON.stringify({ admitted: true, inputId: args.inputId, turnId: 'turn-1' })}` }] };
  }
  throw new Error(`unexpected tool ${tool}`);
}

describe('task execution API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.humanIdentity.value = undefined;
    mocks.boardHumanIdentityFromRequest.mockImplementation(async () =>
      mocks.humanIdentity.value === undefined ? mocks.identity.value : mocks.humanIdentity.value);
    mocks.currentCard.value = { ...baseCard };
    mocks.findCardById.mockImplementation(() => mocks.currentCard.value);
    mocks.updateCard.mockImplementation((_id: string, patch: Partial<KanbanCard>, expectedVersion: number) => {
      const current = mocks.currentCard.value!;
      if (current.version !== expectedVersion) return { conflict: true, serverCard: current };
      mocks.currentCard.value = { ...current, ...patch, version: current.version + 1 };
      return mocks.currentCard.value;
    });
    mocks.tasksDirForScope.mockReturnValue('/tasks/work');
    mocks.identity.value = { username: 'nikita', scope: 'work' };
    mocks.sessionInfo.value = {
      id: sessionId, harness: 'codex', cwd, model: 'gpt-6-luna', status: 'idle',
      lastActivity: '2026-10-20T10:05:00.000Z', lastMessage: 'Found two candidates',
      meta: { nativeLastTurn: { turnId: 'turn-1', status: 'completed' } },
    };
    mocks.turnChangesAfterView.value = false;
    mocks.callOwnerHerderTool.mockImplementation(toolResult);
    mocks.validateTransition.mockReturnValue({ kind: 'accepted', patch: { column: 'in-progress' } });
    mocks.taskExecutionSnapshot.mockImplementation((card: KanbanCard) => ({
      cardId: card.id,
      state: card.taskExecutionHistory?.at(-1)?.phase === 'running' ? 'running'
        : card.taskExecutionHistory?.at(-1)?.phase === 'created' ? 'waiting' : 'not-started',
    }));
    process.env.EXMANAGER_TASK_EXECUTION_CWD = cwd;
    process.env.AGENT_HERDER_HTTP_TOKEN = 'test-only-protected-ref';
    vi.stubEnv('NOTIFY_CENTER_RECIPIENT', 'operator-fixture');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('returns start readiness without exposing fixed host or project configuration', async () => {
    const response = await GET(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution'), {
      params: Promise.resolve({ id: baseCard.id }),
    });
    if (!response) throw new Error('execution response missing');
    expect(await response.json()).toEqual({ cardId: 'task-1', state: 'not-started', startAvailable: true });
    expect(mocks.callOwnerHerderTool).not.toHaveBeenCalled();
  });

  it('does not advertise start readiness to an anonymous board visitor', async () => {
    mocks.identity.value = null;
    const response = await GET(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution'), {
      params: Promise.resolve({ id: baseCard.id }),
    });
    if (!response) throw new Error('execution response missing');
    expect(await response.json()).toMatchObject({
      cardId: baseCard.id, state: 'not-started', startAvailable: false,
      unavailableReason: expect.stringMatching(/войдите|авториз/i),
    });
    expect(mocks.callOwnerHerderTool).not.toHaveBeenCalled();
    expect(mocks.updateCard).not.toHaveBeenCalled();
  });

  it('uses the verified shared board login for readiness and start', async () => {
    mocks.identity.value = null;
    mocks.humanIdentity.value = { username: 'nikita', scope: 'work' };

    const ready = await GET(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution'), {
      params: Promise.resolve({ id: baseCard.id }),
    });
    if (!ready) throw new Error('execution readiness response missing');
    expect(await ready.json()).toMatchObject({ startAvailable: true });

    const response = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('task execution response missing');
    expect(response.status).toBe(201);
    expect(mocks.updateCard).toHaveBeenCalled();
    expect(mocks.callOwnerHerderTool).toHaveBeenCalledWith('fleet_node_info', {});
    expect(mocks.callOwnerHerderTool).toHaveBeenCalledWith('fleet_create_session', expect.objectContaining({ cwd, model: 'gpt-6-luna' }));
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.startedBy).toBe('nikita');
  });

  it('preserves an existing Board OAuth identity without re-resolving it as a human login', async () => {
    mocks.identity.value = { username: 'nikita', scope: 'work', accessToken: { clientId: 'board-client' } } as never;
    mocks.humanIdentity.value = null;
    const response = await GET(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution', {
      headers: { authorization: 'Bearer valid-board-oauth-token' },
    }), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('execution readiness response missing');
    expect(await response.json()).toMatchObject({ startAvailable: true });
    expect(mocks.boardHumanIdentityFromRequest).not.toHaveBeenCalled();
  });

  it('does not advertise start readiness to a verified non-owner', async () => {
    mocks.identity.value = { username: 'oleg', scope: 'work' };
    const response = await GET(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution'), {
      params: Promise.resolve({ id: baseCard.id }),
    });
    if (!response) throw new Error('execution response missing');
    expect(await response.json()).toMatchObject({
      startAvailable: false, unavailableReason: expect.stringMatching(/ответствен|исполнитель|доступ/i),
    });
    expect(mocks.callOwnerHerderTool).not.toHaveBeenCalled();
  });

  it('does not start a task from the anonymous display persona alone', async () => {
    mocks.identity.value = null;
    const response = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('task execution response missing');
    expect(response.status).toBe(401);
    expect(mocks.updateCard).not.toHaveBeenCalled();
    expect(mocks.callOwnerHerderTool).not.toHaveBeenCalled();
  });

  it('marks start unavailable when the protected owner channel is missing', async () => {
    delete process.env.AGENT_HERDER_HTTP_TOKEN;
    const response = await GET(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution'), {
      params: Promise.resolve({ id: baseCard.id }),
    });
    if (!response) throw new Error('execution response missing');
    expect(await response.json()).toMatchObject({ startAvailable: false, unavailableReason: expect.any(String) });
  });

  it('denies a new start before any owner call when the retained receipt history is full', async () => {
    mocks.currentCard.value = {
      ...baseCard,
      taskExecutionHistory: Array.from({ length: 32 }, (_, index) => ({
        operationId: `operation-${index}`,
        requestHash: `request-${index}`,
        lastBoardVersion: baseCard.version,
        createInputId: `create-${index}`,
        messageInputId: `dispatch-${index}`,
        phase: 'result' as const,
        hostId: 'roomhacker-server-100',
        harness: 'codex' as const,
        startedBy: 'nikita',
        createdAt: baseCard.created,
        updatedAt: baseCard.updated,
      })),
    };
    const ready = await GET(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution'), {
      params: Promise.resolve({ id: baseCard.id }),
    });
    if (!ready) throw new Error('execution readiness response missing');
    expect(await ready.json()).toMatchObject({ startAvailable: false, unavailableReason: expect.stringMatching(/истори/i) });

    const response = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('task execution response missing');
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/истори/i) });
    expect(mocks.callOwnerHerderTool).not.toHaveBeenCalled();
    expect(mocks.updateCard).not.toHaveBeenCalled();
  });

  it('accepts only stable operation and expected version; host, CWD and project are server derived', async () => {
    const response = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('task execution response missing');
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ state: 'running', operationId: expect.any(String), retryable: false });
    expect(mocks.callOwnerHerderTool.mock.calls.map(([tool]) => tool)).toEqual([
      'fleet_node_info', 'fleet_create_session', 'fleet_session_view', 'send_message',
    ]);
    expect(mocks.callOwnerHerderTool.mock.calls[1]?.[1]).toMatchObject({
      harness: 'codex', cwd, model: 'gpt-6-luna',
    });
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]).toMatchObject({
      hostId: 'roomhacker-server-100', phase: 'running', nativeTurnId: 'turn-1',
      lastBoardVersion: mocks.currentCard.value?.version,
    });
    expect(mocks.currentCard.value?.column).toBe('in-progress');
    expect(mocks.updateCard).toHaveBeenCalledTimes(3);
  });

  it('rejects extra browser-supplied execution configuration before any write', async () => {
    const response = await POST(postRequest({ operationId, expectedVersion: 4, hostId: 'forged', cwd }), {
      params: Promise.resolve({ id: baseCard.id }),
    });
    if (!response) throw new Error('task execution response missing');
    expect(response.status).toBe(400);
    expect(mocks.updateCard).not.toHaveBeenCalled();
    expect(mocks.callOwnerHerderTool).not.toHaveBeenCalled();
  });

  it('keeps an admitted dispatch unknown when the owner receipt lacks its native turn ID', async () => {
    mocks.callOwnerHerderTool.mockImplementation((tool: string, args: Record<string, unknown>) => {
      if (tool === 'send_message') {
        return { content: [{ type: 'text', text: `Native admission receipt: ${JSON.stringify({ admitted: true, inputId: args.inputId })}` }] };
      }
      return toolResult(tool, args);
    });
    const response = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('task execution response missing');
    expect(response.status).toBe(202);
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.phase).toBe('dispatch-unknown');
    expect(mocks.currentCard.value?.column).toBe('todo');
  });

  it('replays the exact stable operation after its own version writes and refuses a later card edit', async () => {
    const first = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!first) throw new Error('first task execution response missing');
    expect(first.status).toBe(201);
    const writeCount = mocks.updateCard.mock.calls.length;
    const replay = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!replay) throw new Error('task execution replay response missing');
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ replay: true, state: 'running' });
    expect(mocks.updateCard).toHaveBeenCalledTimes(writeCount);
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'fleet_create_session')).toHaveLength(1);

    mocks.currentCard.value = { ...mocks.currentCard.value!, version: mocks.currentCard.value!.version + 1, tags: ['unrelated edit'] };
    const staleReplay = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!staleReplay) throw new Error('stale task execution response missing');
    expect(staleReplay.status).toBe(409);
    expect(mocks.updateCard).toHaveBeenCalledTimes(writeCount);
  });

  it('keeps a created receipt recoverable after transient view failure and resumes the same operation explicitly', async () => {
    let failFirstView = true;
    mocks.callOwnerHerderTool.mockImplementation((tool: string, args: Record<string, unknown>) => {
      if (tool === 'fleet_session_view' && failFirstView) {
        failFirstView = false;
        throw new Error('transient owner readback failure');
      }
      return toolResult(tool, args);
    });

    const first = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!first) throw new Error('first task execution response missing');
    expect(first.status).toBe(202);
    expect((await first.json()).state).toBe('waiting');
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]).toMatchObject({
      phase: 'created', nativeSessionId: sessionId,
    });

    const current = mocks.currentCard.value!;
    const recovery = await PATCH(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'sync-result', operationId, expectedVersion: current.version }),
    }), { params: Promise.resolve({ id: baseCard.id }) });

    if (!recovery) throw new Error('created-session recovery response missing');
    expect(recovery.status).toBe(202);
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]).toMatchObject({
      phase: 'running', nativeSessionId: sessionId, nativeTurnId: 'turn-1',
    });
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'fleet_create_session')).toHaveLength(1);
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'send_message')).toHaveLength(1);
    expect(mocks.callOwnerHerderTool.mock.calls.find(([tool]) => tool === 'send_message')?.[1]).toMatchObject({
      inputId: mocks.currentCard.value?.taskExecutionHistory?.[0]?.messageInputId,
      sessionId,
    });
  });

  it('does not promote stale idle commentary while the exact admitted turn is still running', async () => {
    const first = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!first) throw new Error('first task execution response missing');
    mocks.callOwnerHerderTool.mockClear();
    mocks.sessionInfo.value = {
      ...mocks.sessionInfo.value,
      status: 'running', lastMessage: 'Я проверю это сейчас',
      meta: { nativeLastTurn: { turnId: 'older-turn', status: 'completed' } },
    };
    const current = mocks.currentCard.value!;
    const response = await PATCH(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'sync-result', operationId, expectedVersion: current.version }),
    }), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('task sync response missing');

    expect(response.status).toBe(202);
    expect(mocks.currentCard.value?.column).toBe('in-progress');
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.phase).toBe('running');
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'fleet_session_view')).toHaveLength(0);
  });

  it('keeps the execution unresolved when idle belongs to a different native turn', async () => {
    const first = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!first) throw new Error('first task execution response missing');
    mocks.callOwnerHerderTool.mockClear();
    mocks.sessionInfo.value = {
      ...mocks.sessionInfo.value,
      status: 'idle', lastMessage: 'Stale prior result',
      meta: { nativeLastTurn: { turnId: 'different-turn', status: 'completed' } },
    };
    const current = mocks.currentCard.value!;
    const response = await PATCH(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'sync-result', operationId, expectedVersion: current.version }),
    }), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('task sync response missing');

    expect(response.status).toBe(202);
    expect(mocks.currentCard.value?.column).toBe('in-progress');
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.phase).toBe('running');
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'fleet_session_view')).toHaveLength(0);
  });

  it('uses the native final message when agent_info.lastMessage is a stale prefixed summary', async () => {
    const first = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!first) throw new Error('first task execution response missing');
    mocks.validateTransition.mockReturnValue({
      kind: 'redirected', patch: { column: 'review', needsReview: true, resultHistory: [{
        summary: 'Found two candidates', evidenceRefs: [], submittedBy: 'nikita', submittedAt: '2026-10-20T10:06:00.000Z',
      }] },
    });
    mocks.callOwnerHerderTool.mockClear();
    mocks.sessionInfo.value = {
      ...mocks.sessionInfo.value,
      status: 'idle', lastMessage: 'assistant: The push succeeded. A fresh origin/main readback confirms…',
      meta: { nativeLastTurn: { turnId: 'turn-1', status: 'completed' } },
    };
    const current = mocks.currentCard.value!;
    const response = await PATCH(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'sync-result', operationId, expectedVersion: current.version }),
    }), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('task sync response missing');

    expect(response.status).toBe(200);
    expect(mocks.currentCard.value?.column).toBe('review');
    expect(mocks.currentCard.value?.resultHistory?.at(-1)?.summary).toBe('Found two candidates');
  });

  it('refuses transcript promotion if the exact native turn changes during the read', async () => {
    const first = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!first) throw new Error('first task execution response missing');
    mocks.callOwnerHerderTool.mockClear();
    mocks.turnChangesAfterView.value = true;
    const current = mocks.currentCard.value!;
    const response = await PATCH(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'sync-result', operationId, expectedVersion: current.version }),
    }), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('task sync response missing');

    expect(response.status).toBe(202);
    expect(mocks.currentCard.value?.column).toBe('in-progress');
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.phase).toBe('running');
  });

  it('moves only the exact completed admitted turn to human review', async () => {
    const first = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!first) throw new Error('first task execution response missing');
    mocks.validateTransition.mockReturnValue({
      kind: 'redirected', patch: { column: 'review', needsReview: true, resultHistory: [{
        summary: 'Found two candidates', evidenceRefs: [], submittedBy: 'nikita', submittedAt: '2026-10-20T10:06:00.000Z',
      }] },
    });
    const current = mocks.currentCard.value!;
    const response = await PATCH(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'sync-result', operationId, expectedVersion: current.version }),
    }), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('task sync response missing');

    expect(response.status).toBe(200);
    expect(mocks.currentCard.value?.column).toBe('review');
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]).toMatchObject({
      phase: 'result', nativeTurnId: 'turn-1', lastBoardVersion: mocks.currentCard.value?.version,
    });
  });

  it('creates a Notice question only by explicit authenticated CAS action and stores its deterministic reference', async () => {
    vi.stubEnv('EXMANAGER_NOTICE_PROJECT_TOKEN', 'fixture-only-token');
    vi.stubEnv('NOTIFY_CENTER_RECIPIENT', 'operator-fixture');
    mocks.currentCard.value = runningQuestionCard();
    const expectedVersion = baseCard.version + 1;
    const requestId = expectedNoticeRequestId(baseCard.id, 'clarify-scope', expectedVersion);
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      const body = JSON.parse(String(init?.body)) as { mandate: Record<string, unknown> };
      expect(Object.keys(body)).toEqual(['mandate']);
      expect(body.mandate).toMatchObject({
        task_ref: baseCard.id, purpose: 'clarify-scope', version: String(expectedVersion),
        mandate_ref: canonicalQuestionOperationId, project: 'Demo', recipient: 'operator-fixture',
        timeout_value: 'current',
      });
      expect(body.mandate).not.toHaveProperty('actor');
      expect(body.mandate).not.toHaveProperty('host_id');
      return noticeResponse({
        ...noticeQuestionView({ requestId, taskRef: baseCard.id, operationId: canonicalQuestionOperationId,
          purpose: 'clarify-scope', version: expectedVersion, deliveryStatus: 'sent', idempotent: false }),
      }, 201);
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await PATCH(createQuestionRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('task question response missing');
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.taskQuestion).toMatchObject({ requestId, purpose: 'clarify-scope', version: expectedVersion,
      state: 'pending', deliveryStatus: 'sent', notification: { delivered: true } });
    expect(body.taskQuestion.notification).not.toHaveProperty('receipt');
    expect(mocks.currentCard.value?.version).toBe(expectedVersion);
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]).toMatchObject({
      lastBoardVersion: expectedVersion,
      taskDecisionRequest: { requestId, requestHash: expect.stringMatching(/^[a-f0-9]{64}$/), purpose: 'clarify-scope', version: expectedVersion },
    });
    expect(mocks.updateCard).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.callOwnerHerderTool).not.toHaveBeenCalled();
  });

  it('rejects stale version, wrong actor and caller-supplied recipient before writes or Notice calls', async () => {
    vi.stubEnv('EXMANAGER_NOTICE_PROJECT_TOKEN', 'fixture-only-token');
    vi.stubEnv('NOTIFY_CENTER_RECIPIENT', 'operator-fixture');
    mocks.currentCard.value = runningQuestionCard();
    vi.stubGlobal('fetch', vi.fn());
    const stale = await PATCH(createQuestionRequest(baseCard.version - 1), { params: Promise.resolve({ id: baseCard.id }) });
    if (!stale) throw new Error('stale question response missing');
    expect(stale.status).toBe(409);
    expect(mocks.updateCard).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();

    mocks.identity.value = { username: 'unassigned', scope: 'work' };
    const wrongActor = await PATCH(createQuestionRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!wrongActor) throw new Error('actor-denial response missing');
    expect(wrongActor.status).toBe(403);
    expect(mocks.updateCard).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();

    mocks.identity.value = { username: 'nikita', scope: 'work' };
    const forgedRecipient = await PATCH(createQuestionRequest(baseCard.version, { recipient: 'other-person' }), {
      params: Promise.resolve({ id: baseCard.id }),
    });
    if (!forgedRecipient) throw new Error('recipient-denial response missing');
    expect(forgedRecipient.status).toBe(400);
    expect(mocks.updateCard).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails closed before the CAS write when the protected Notice bearer or fixed recipient is absent', async () => {
    vi.stubEnv('EXMANAGER_NOTICE_PROJECT_TOKEN', '');
    vi.stubEnv('NOTIFY_CENTER_RECIPIENT', '');
    mocks.currentCard.value = runningQuestionCard();
    vi.stubGlobal('fetch', vi.fn());
    const response = await PATCH(createQuestionRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('unconfigured Notice response missing');
    expect(response.status).toBe(503);
    expect(mocks.updateCard).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reads only the stored Notice request and exposes timeout without transport identifiers', async () => {
    vi.stubEnv('EXMANAGER_NOTICE_PROJECT_TOKEN', 'fixture-only-token');
    const version = baseCard.version + 1;
    const requestId = expectedNoticeRequestId(baseCard.id, 'clarify-scope', version);
    const card = runningQuestionCard();
    card.version = version;
    card.taskExecutionHistory![0] = {
      ...card.taskExecutionHistory![0]!,
      lastBoardVersion: version,
      taskDecisionRequest: { requestId, requestHash: 'a'.repeat(64), purpose: 'clarify-scope', version },
    };
    mocks.currentCard.value = card;
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => noticeResponse(noticeQuestionView({
      requestId, taskRef: baseCard.id, operationId: canonicalQuestionOperationId,
      purpose: 'clarify-scope', version,
      winner: { source: 'timeout', value: 'current', decided_at: 789 },
    }), 200));
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution?question=latest'), {
      params: Promise.resolve({ id: baseCard.id }),
    });
    if (!response) throw new Error('task question read response missing');
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.taskQuestion).toMatchObject({ requestId, state: 'expired', decision: { source: 'timeout', value: 'current', decidedAt: 789 } });
    expect(JSON.stringify(body)).not.toContain('private-id');
    expect(JSON.stringify(body)).not.toContain('message_id');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('GET');
    expect(mocks.updateCard).not.toHaveBeenCalled();
  });

  it('rejects canonical Notice views bound to a different Board project or configured recipient', async () => {
    vi.stubEnv('EXMANAGER_NOTICE_PROJECT_TOKEN', 'fixture-only-token');
    const version = baseCard.version + 1;
    const requestId = expectedNoticeRequestId(baseCard.id, 'clarify-scope', version);
    const card = runningQuestionCard();
    card.version = version;
    card.taskExecutionHistory![0] = {
      ...card.taskExecutionHistory![0]!,
      lastBoardVersion: version,
      taskDecisionRequest: { requestId, requestHash: 'a'.repeat(64), purpose: 'clarify-scope', version },
    };
    mocks.currentCard.value = card;

    for (const mismatch of [{ project: 'Different project' }, { recipient: 'different-recipient' }]) {
      const payload = noticeQuestionView({ requestId, taskRef: baseCard.id,
        operationId: canonicalQuestionOperationId, purpose: 'clarify-scope', version });
      const fetchMock = vi.fn(async () => noticeResponse({ ...payload, ...mismatch }, 200));
      vi.stubGlobal('fetch', fetchMock);
      const response = await GET(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution?question=latest'), {
        params: Promise.resolve({ id: baseCard.id }),
      });
      if (!response) throw new Error('mismatched Notice view response missing');
      expect(response.status).toBe(502);
      expect(await response.json()).toMatchObject({ taskQuestion: { requestId, state: 'unknown' } });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
    expect(mocks.updateCard).not.toHaveBeenCalled();
  });

  it('requires a successful sender receipt before projecting a Notice deadline', async () => {
    vi.stubEnv('EXMANAGER_NOTICE_PROJECT_TOKEN', 'fixture-only-token');
    const version = baseCard.version + 1;
    const requestId = expectedNoticeRequestId(baseCard.id, 'clarify-scope', version);
    const card = runningQuestionCard();
    card.version = version;
    card.taskExecutionHistory![0] = {
      ...card.taskExecutionHistory![0]!,
      lastBoardVersion: version,
      taskDecisionRequest: { requestId, requestHash: 'a'.repeat(64), purpose: 'clarify-scope', version },
    };
    mocks.currentCard.value = card;
    const malformed = noticeQuestionView({ requestId, taskRef: baseCard.id,
      operationId: canonicalQuestionOperationId, purpose: 'clarify-scope', version }) as Record<string, unknown>;
    const malformedNotification = malformed.notification as Record<string, unknown>;
    malformedNotification.receipt = null;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(noticeResponse(malformed, 200))
      .mockResolvedValueOnce(noticeResponse({ ...malformed,
        notification: { ...malformedNotification, deadline_at: null } }, 200));
    vi.stubGlobal('fetch', fetchMock);
    const request = () => new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution?question=latest');
    const params = { params: Promise.resolve({ id: baseCard.id }) };

    const inconsistent = await GET(request(), params);
    if (!inconsistent) throw new Error('inconsistent deadline response missing');
    expect(inconsistent.status).toBe(502);

    const validNoReceipt = await GET(request(), params);
    if (!validNoReceipt) throw new Error('no-receipt Notice response missing');
    expect(validNoReceipt.status).toBe(200);
    expect(await validNoReceipt.json()).toMatchObject({ taskQuestion: { notification: { delivered: false, deadlineAt: null } } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('projects a human answer through the same authenticated read route', async () => {
    vi.stubEnv('EXMANAGER_NOTICE_PROJECT_TOKEN', 'fixture-only-token');
    const version = baseCard.version + 1;
    const requestId = expectedNoticeRequestId(baseCard.id, 'clarify-scope', version);
    const card = runningQuestionCard();
    card.version = version;
    card.taskExecutionHistory![0] = {
      ...card.taskExecutionHistory![0]!,
      lastBoardVersion: version,
      taskDecisionRequest: { requestId, requestHash: 'a'.repeat(64), purpose: 'clarify-scope', version },
    };
    mocks.currentCard.value = card;
    vi.stubGlobal('fetch', vi.fn(async () => noticeResponse(noticeQuestionView({
      requestId, taskRef: baseCard.id, operationId: canonicalQuestionOperationId,
      purpose: 'clarify-scope', version,
      winner: { source: 'human', value: 'all', decided_at: 789 },
    }), 200)));

    const response = await GET(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution?question=latest'), {
      params: Promise.resolve({ id: baseCard.id }),
    });
    if (!response) throw new Error('human answer read response missing');
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.taskQuestion).toMatchObject({ state: 'resolved', decision: { source: 'human', value: 'all', decidedAt: 789 } });
  });

  it('keeps ambiguous creation query-only on read/reopen and recovers only after the same ID is authoritatively absent', async () => {
    vi.stubEnv('EXMANAGER_NOTICE_PROJECT_TOKEN', 'fixture-only-token');
    vi.stubEnv('NOTIFY_CENTER_RECIPIENT', 'operator-fixture');
    mocks.currentCard.value = runningQuestionCard();
    const requestId = expectedNoticeRequestId(baseCard.id, 'clarify-scope', baseCard.version + 1);
    let allowRetry = false;
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'GET') return noticeResponse({ error: 'not found' }, 404);
      if (!allowRetry) throw new Error('synthetic ambiguous Notice response');
      const mandate = JSON.parse(String(init?.body)).mandate as Record<string, unknown>;
      return noticeResponse(noticeQuestionView({ requestId, taskRef: baseCard.id,
        operationId: canonicalQuestionOperationId, purpose: 'clarify-scope', version: Number(mandate.version),
        deliveryStatus: 'sent', idempotent: true }), 200);
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = await PATCH(createQuestionRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!first) throw new Error('initial question response missing');
    expect(first.status).toBe(202);
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.taskDecisionRequest?.requestId).toBe(requestId);

    const read = await GET(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution?question=latest'), {
      params: Promise.resolve({ id: baseCard.id }),
    });
    if (!read) throw new Error('question read response missing');
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ taskQuestion: { requestId, state: 'not_found' } });
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'GET']);

    allowRetry = true;
    const currentVersion = mocks.currentCard.value!.version;
    const retry = await PATCH(createQuestionRequest(currentVersion), { params: Promise.resolve({ id: baseCard.id }) });
    if (!retry) throw new Error('question retry response missing');
    expect(retry.status).toBe(200);
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'GET', 'GET', 'POST']);
    const postedMandates = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')
      .map(([, init]) => JSON.parse(String(init?.body)).mandate as Record<string, unknown>);
    expect(postedMandates).toHaveLength(2);
    expect(postedMandates[0]).toEqual(postedMandates[1]);
    expect(postedMandates[0]?.version).toBe(String(currentVersion));
  });
});
