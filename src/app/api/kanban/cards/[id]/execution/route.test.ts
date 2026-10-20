import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KanbanCard } from '@/lib/kanban/types';

const mocks = vi.hoisted(() => ({
  currentCard: { value: undefined as KanbanCard | undefined },
  findCardById: vi.fn(),
  updateCard: vi.fn(),
  tasksDirForScope: vi.fn(),
  identity: { value: { username: 'nikita', scope: 'work' as const } as { username: string; scope: 'work' } | null },
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

function postRequest(body: Record<string, unknown> = { operationId, expectedVersion: 4 }) {
  return new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
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
  });

  it('returns start readiness without exposing fixed host or project configuration', async () => {
    const response = await GET(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution'), {
      params: Promise.resolve({ id: baseCard.id }),
    });
    expect(await response.json()).toEqual({ cardId: 'task-1', state: 'not-started', startAvailable: true });
    expect(mocks.callOwnerHerderTool).not.toHaveBeenCalled();
  });

  it('marks start unavailable when the protected owner channel is missing', async () => {
    delete process.env.AGENT_HERDER_HTTP_TOKEN;
    const response = await GET(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution'), {
      params: Promise.resolve({ id: baseCard.id }),
    });
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
});
