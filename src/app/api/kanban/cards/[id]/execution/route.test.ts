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
  nativeProjectAccess: { value: null as null | { userId: string; forProject: ReturnType<typeof vi.fn> } },
  callOwnerHerderTool: vi.fn(),
  validateTransition: vi.fn(),
  taskExecutionSnapshot: vi.fn(),
  sessionInfo: { value: undefined as Record<string, unknown> | undefined },
  projectReadinessOverride: { value: undefined as Record<string, unknown> | undefined },
  projectRouteOverride: { value: undefined as Record<string, unknown> | undefined },
  turnChangesAfterView: { value: false },
  cardChangesAfterView: { value: false },
}));

vi.mock('@/lib/kanban/file-store', () => ({ findCardById: mocks.findCardById, updateCard: mocks.updateCard }));
vi.mock('@/lib/auth/request', () => ({
  boardIdentityFromRequest: () => mocks.identity.value ?? { username: 'anonymous', scope: 'work' },
  identityFromRequest: () => mocks.identity.value,
  nativeProjectAccessContextFromRequest: vi.fn(async () => mocks.nativeProjectAccess.value),
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
const scopedProjectRoot = '/workspace/exmanager-task-workspace';
const questionOperationId = 'question-operation-1234567890';
const canonicalQuestionOperationId = createHash('sha256').update(`${baseCard.id}\0${questionOperationId}`).digest('hex');

function postRequest(body: Record<string, unknown> = { operationId, expectedVersion: 4 }, headers: Record<string, string> = {}) {
  return new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
}

function scopedReadiness(project = 'Demo', overrides: Record<string, unknown> = {}) {
  const pathResolution = {
    requestedCwd: scopedProjectRoot, canonicalCwd: scopedProjectRoot, rootPath: scopedProjectRoot,
    contained: true, identityMatches: true,
  };
  // The host reports the readiness of the route it names: the snapshot carries that harness and model.
  const route = mocks.projectRouteOverride.value ?? { harness: 'codex', model: 'gpt-6-luna', state: 'ready' };
  const harness = typeof route.harness === 'string' ? route.harness : 'codex';
  const model = typeof route.model === 'string' ? route.model : 'gpt-6-luna';
  const codex = harness === 'codex';
  return {
    hostId: 'roomhacker-server-100', nativeUser: 'operator',
    projectReadinessContract: 'integrator-host-readiness-v1',
    projectRoute: route,
    projectReadiness: {
      state: 'ready', projectId: project, projectRoot: scopedProjectRoot,
      rootIdentity: 'exmanager-workspace-root-v1', policyRevision: 'scope-policy-7',
      observedAtMs: Date.now(), runtimeInstanceId: 'herder-runtime-12', hostId: 'roomhacker-server-100',
      harness, harnessVersion: codex ? 'codex-test-1' : '', model,
      requiredTools: codex ? ['web_search'] : [], availableTools: codex ? ['web_search', 'shell_exec'] : [],
      availableModels: [model], resourceReady: true, cwd: scopedProjectRoot, pathResolution,
      ...overrides,
    },
  };
}

const parentOperationId = 'a'.repeat(64);
function researchCard(description = baseCard.description): KanbanCard {
  const card: KanbanCard = {
    ...baseCard, description, column: 'review', needsReview: true, version: 8,
    resultHistory: [{ summary: 'Original result', evidenceRefs: ['https://original.example'], submittedBy: 'nikita', submittedAt: '2026-10-20T10:06:00.000Z' }],
    reviewHistory: [],
  };
  const requestHash = createHash('sha256').update(JSON.stringify({
    id: card.id, title: card.title, description: card.description, project: card.project,
    owner: card.owner ?? 'nikita', assignee: card.assignee ?? null, assignees: card.assignees,
    actor: 'nikita', hostId: 'roomhacker-server-100', harness: 'codex', cwd, model: 'gpt-6-luna',
  })).digest('hex');
  card.taskExecutionHistory = [{
    operationId: parentOperationId, requestHash, lastBoardVersion: card.version,
    createInputId: '1'.repeat(64), messageInputId: '2'.repeat(64), phase: 'result',
    hostId: 'roomhacker-server-100', harness: 'codex', nativeSessionId: sessionId,
    nativeTurnId: 'parent-turn', startedBy: 'nikita', createdAt: card.created, updatedAt: card.updated,
  }];
  return card;
}

const continuationText = 'Research two relevant SMB integrators using official public sources; state hypotheses separately and do not contact them.';
function followUpRequest(action: 'continue-task' | 'sync-task-continuation', expectedVersion: number,
  continuationId?: string, text = continuationText, native = false) {
  return new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution', {
    method: 'PATCH', headers: { 'content-type': 'application/json', ...(native ? { 'X-Airlock-Todo-Native-Identity': 'verified-test-assertion' } : {}) }, body: JSON.stringify({
      action, operationId: parentOperationId, expectedVersion,
      ...(action === 'continue-task' ? { continuationText: text } : {}),
      ...(continuationId ? { continuationId } : {}),
    }),
  });
}

const controlCardId = '11111111-2222-4333-8444-555555555555';
const controlOperationId = 'b'.repeat(64);

function controllableOpenCodeCard(): KanbanCard {
  return {
    ...baseCard,
    id: controlCardId,
    taskExecutionHistory: [{
      operationId: controlOperationId, requestHash: 'c'.repeat(64), lastBoardVersion: baseCard.version,
      createInputId: '1'.repeat(64), messageInputId: '2'.repeat(64), phase: 'running',
      hostId: 'roomhacker-server-100', harness: 'opencode', nativeSessionId: 'opencode-session-1',
      nativeTurnId: 'opencode-turn-1', startedBy: 'nikita', createdAt: baseCard.created, updatedAt: baseCard.updated,
    }],
  };
}

function sessionControlRequest(body: Record<string, unknown>) {
  return new NextRequest(`https://todo.example.test/api/kanban/cards/${controlCardId}/execution`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
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
    const info = typeof args.project === 'string' ? (mocks.projectReadinessOverride.value ?? scopedReadiness(args.project)) : { hostId: 'roomhacker-server-100', nativeUser: 'operator' };
    return { structuredContent: info, content: [{ type: 'text', text: JSON.stringify(info) }] };
  }
  if (tool === 'fleet_create_session') {
    mocks.sessionInfo.value = { ...mocks.sessionInfo.value, cwd: args.cwd };
    const readiness = args.projectReadiness as Record<string, unknown> | undefined;
    const requiredTools = readiness?.requiredTools ?? [];
    const projectExecution = readiness ? {
      projectId: readiness.projectId, projectRoot: readiness.projectRoot,
      rootIdentity: readiness.rootIdentity, policyRevision: readiness.policyRevision,
      hostId: readiness.hostId, harness: readiness.harness, model: readiness.model,
      requiredTools, address: { hostId: readiness.hostId, harness: readiness.harness, nativeSessionId: sessionId },
      launchCwd: readiness.cwd,
    } : undefined;
    return { structuredContent: {
      ok: true, created: true, inputId: args.inputId, harness: readiness?.harness ?? 'codex', sessionId, cwd: args.cwd,
      ...(projectExecution ? { projectReadinessContract: args.projectReadinessContract, projectExecution } : {}),
    }, content: [] };
  }
  if (tool === 'fleet_session_view') {
    const binding = mocks.currentCard.value?.taskExecutionHistory?.at(-1)?.projectBinding;
    const receiptCwd = binding?.cwd ?? cwd;
    const result = { structuredContent: {
      hostId: 'roomhacker-server-100', details: {
        session: { id: sessionId, harness: binding?.harness ?? 'codex', cwd: receiptCwd, model: binding?.model ?? 'gpt-6-luna' },
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
    if (mocks.cardChangesAfterView.value && mocks.currentCard.value) {
      mocks.cardChangesAfterView.value = false;
      mocks.currentCard.value = { ...mocks.currentCard.value, version: mocks.currentCard.value.version + 1,
        tags: ['edited during transcript read'] };
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
    mocks.nativeProjectAccess.value = null;
    mocks.sessionInfo.value = {
      id: sessionId, harness: 'codex', cwd, model: 'gpt-6-luna', status: 'idle',
      lastActivity: '2026-10-20T10:05:00.000Z', lastMessage: 'Found two candidates',
      meta: { nativeLastTurn: { turnId: 'turn-1', status: 'completed' } },
    };
    mocks.turnChangesAfterView.value = false;
    mocks.cardChangesAfterView.value = false;
    mocks.projectReadinessOverride.value = undefined;
    mocks.projectRouteOverride.value = undefined;
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
    expect(mocks.callOwnerHerderTool).toHaveBeenCalledWith('fleet_node_info', { project: baseCard.project });
    expect(mocks.callOwnerHerderTool).toHaveBeenCalledWith('fleet_create_session', expect.objectContaining({ cwd: scopedProjectRoot, model: 'gpt-6-luna', project: baseCard.project }));
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.startedBy).toBe('nikita');
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]).not.toHaveProperty('requestedBy');
  });

  it('uses current native project read membership for execution status without inventing a board username', async () => {
    const forProject = vi.fn(async () => ({ project: 'Demo', team: 'integrator', readAllowed: true as const, writeAllowed: false }));
    mocks.nativeProjectAccess.value = { userId: 'airlock-native-user-42', forProject };
    const response = await GET(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution', {
      headers: { 'X-Airlock-Todo-Native-Identity': 'verified-test-assertion' },
    }), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('native execution read response missing');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ startAvailable: false, unavailableReason: expect.stringMatching(/только для чтения/i) });
    expect(forProject).toHaveBeenCalledWith('Demo');
    expect(mocks.callOwnerHerderTool).not.toHaveBeenCalled();
  });

  it('starts and exactly replays one native-manager task with the signed user id as receipt actor', async () => {
    const forProject = vi.fn(async () => ({ project: 'Demo', team: 'integrator', readAllowed: true as const, writeAllowed: true }));
    mocks.nativeProjectAccess.value = { userId: 'airlock-native-user-42', forProject };
    const request = () => postRequest(undefined, { 'X-Airlock-Todo-Native-Identity': 'verified-test-assertion' });
    const response = await POST(request(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('native execution response missing');
    expect(response.status).toBe(201);
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.startedBy).toBe('airlock-native-user-42');
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.requestedBy).toBe('airlock-native-user-42');
    expect(forProject).toHaveBeenCalledWith('Demo');
    const createsAfterFirst = mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'fleet_create_session').length;
    expect(createsAfterFirst).toBe(1);

    const replay = await POST(request(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!replay) throw new Error('native execution replay response missing');
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ replay: true });
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'fleet_create_session')).toHaveLength(1);
  });

  it('denies native execution without current write grant and never falls back from an invalid present assertion', async () => {
    const forProject = vi.fn(async () => ({ project: 'Demo', team: 'integrator', readAllowed: true as const, writeAllowed: false }));
    mocks.nativeProjectAccess.value = { userId: 'airlock-native-user-42', forProject };
    const denied = await POST(postRequest(undefined, { 'X-Airlock-Todo-Native-Identity': 'verified-test-assertion' }), {
      params: Promise.resolve({ id: baseCard.id }),
    });
    if (!denied) throw new Error('native denied response missing');
    expect(denied.status).toBe(404);
    expect(mocks.updateCard).not.toHaveBeenCalled();
    expect(mocks.callOwnerHerderTool).not.toHaveBeenCalled();

    mocks.nativeProjectAccess.value = null;
    const requestModule = await import('@/lib/auth/request');
    vi.mocked(requestModule.nativeProjectAccessContextFromRequest).mockRejectedValueOnce(new Error('native_identity_invalid'));
    const invalid = await POST(postRequest(undefined, { 'X-Airlock-Todo-Native-Identity': 'tampered' }), {
      params: Promise.resolve({ id: baseCard.id }),
    });
    if (!invalid) throw new Error('invalid native assertion response missing');
    expect(invalid.status).toBe(403);
    expect(mocks.updateCard).not.toHaveBeenCalled();
    expect(mocks.callOwnerHerderTool).not.toHaveBeenCalled();
    expect(mocks.boardHumanIdentityFromRequest).not.toHaveBeenCalled();
  });

  it('does not map a legacy username receipt onto a native user id during PATCH recovery', async () => {
    const forProject = vi.fn(async () => ({ project: 'Demo', team: 'integrator', readAllowed: true as const, writeAllowed: true }));
    mocks.nativeProjectAccess.value = { userId: 'airlock-native-user-42', forProject };
    mocks.currentCard.value = { ...baseCard, taskExecutionHistory: [{
      operationId: canonicalQuestionOperationId, requestHash: 'f'.repeat(64), lastBoardVersion: baseCard.version,
      createInputId: 'create-input', messageInputId: 'message-input', phase: 'running', hostId: 'roomhacker-server-100',
      harness: 'codex', startedBy: 'nikita', createdAt: baseCard.created, updatedAt: baseCard.updated,
    }] };
    const response = await PATCH(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution', {
      method: 'PATCH', headers: { 'content-type': 'application/json', 'X-Airlock-Todo-Native-Identity': 'verified-test-assertion' },
      body: JSON.stringify({ action: 'sync-result', operationId: questionOperationId, expectedVersion: baseCard.version }),
    }), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('native legacy receipt response missing');
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/receipt owner does not match native identity/i) });
    expect(mocks.updateCard).not.toHaveBeenCalled();
    expect(mocks.callOwnerHerderTool).not.toHaveBeenCalled();
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
    mocks.currentCard.value = { ...baseCard, project: 'canonical-project-from-card' };
    const response = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('task execution response missing');
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ state: 'running', operationId: expect.any(String), retryable: false });
    expect(mocks.callOwnerHerderTool.mock.calls.map(([tool]) => tool)).toEqual([
      'fleet_node_info', 'fleet_create_session', 'fleet_session_view', 'send_message',
    ]);
    expect(mocks.callOwnerHerderTool.mock.calls[1]?.[1]).toMatchObject({
      harness: 'codex', cwd: scopedProjectRoot, model: 'gpt-6-luna', project: 'canonical-project-from-card',
      projectReadinessContract: 'integrator-host-readiness-v1',
      projectReadiness: expect.objectContaining({ projectId: 'canonical-project-from-card', projectRoot: scopedProjectRoot, rootIdentity: 'exmanager-workspace-root-v1' }),
    });
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]).toMatchObject({
      hostId: 'roomhacker-server-100', phase: 'running', nativeTurnId: 'turn-1',
      lastBoardVersion: mocks.currentCard.value?.version,
    });
    expect(mocks.currentCard.value?.column).toBe('in-progress');
    expect(mocks.updateCard).toHaveBeenCalledTimes(3);
  });

  it('does not persist intent or create when project-scoped readiness is absent, stale, or mismatched', async () => {
    const invalid = [
      { hostId: 'roomhacker-server-100', nativeUser: 'operator' },
      scopedReadiness('Demo', { state: 'not_ready' }),
      scopedReadiness('another-project'),
      scopedReadiness('Demo', { observedAtMs: Date.now() - 31_000 }),
      scopedReadiness('Demo', { availableTools: [] }),
      scopedReadiness('Demo', { cwd: '/other/root' }),
      scopedReadiness('Demo', { pathResolution: { requestedCwd: '/other/absolute/path', canonicalCwd: scopedProjectRoot, rootPath: scopedProjectRoot, contained: true, identityMatches: true } }),
    ];
    for (const readiness of invalid) {
      mocks.projectReadinessOverride.value = readiness;
      mocks.updateCard.mockClear();
      mocks.callOwnerHerderTool.mockClear();
      const response = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
      if (!response) throw new Error('readiness response missing');
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ state: 'not_attempted' });
      expect(mocks.updateCard).not.toHaveBeenCalled();
      expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'fleet_create_session')).toHaveLength(0);
    }
  });

  it('launches the harness and model of the project route the herder reported', async () => {
    mocks.projectRouteOverride.value = { harness: 'opencode', model: 'omniroute/minimax-combo-m3.1', state: 'ready' };
    const response = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('task execution response missing');
    const creates = mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'fleet_create_session');
    expect(creates).toHaveLength(1);
    expect(creates[0]![1]).toMatchObject({ harness: 'opencode', model: 'omniroute/minimax-combo-m3.1' });
  });

  it('keeps a codex project route on the codex harness and model', async () => {
    const response = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('task execution response missing');
    const creates = mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'fleet_create_session');
    expect(creates).toHaveLength(1);
    expect(creates[0]![1]).toMatchObject({ harness: 'codex', model: 'gpt-6-luna' });
  });

  it('refuses a launch with a concrete reason when the project route is not named', async () => {
    for (const route of [
      { state: 'unavailable', reason: 'project_route_unconfigured' },
      { state: 'ready', harness: 'unknown-harness', model: 'gpt-6-luna' },
    ]) {
      mocks.projectRouteOverride.value = route;
      mocks.updateCard.mockClear();
      mocks.callOwnerHerderTool.mockClear();
      const response = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
      if (!response) throw new Error('task execution response missing');
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ state: 'not_attempted' });
      expect(mocks.updateCard).not.toHaveBeenCalled();
      expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'fleet_create_session')).toHaveLength(0);
    }
  });

  it('rejects extra browser-supplied execution configuration before any write', async () => {
    for (const extra of [
      { hostId: 'forged', cwd },
      { project: 'attacker-controlled-project' },
    ]) {
      const response = await POST(postRequest({ operationId, expectedVersion: 4, ...extra }), {
        params: Promise.resolve({ id: baseCard.id }),
      });
      if (!response) throw new Error('task execution response missing');
      expect(response.status).toBe(400);
    }
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

  it('does not relaunch an existing UNKNOWN receipt to add project scope retroactively', async () => {
    const canonicalOperationId = createHash('sha256').update(`${baseCard.id}\0${operationId}`).digest('hex');
    const requestHash = createHash('sha256').update(JSON.stringify({
      id: baseCard.id, title: baseCard.title, description: baseCard.description, project: baseCard.project,
      owner: baseCard.owner ?? 'nikita', assignee: baseCard.assignee ?? null, assignees: baseCard.assignees,
      actor: 'nikita', hostId: 'roomhacker-server-100', harness: 'codex', cwd, model: 'gpt-6-luna',
    })).digest('hex');
    mocks.currentCard.value = { ...baseCard, taskExecutionHistory: [{
      operationId: canonicalOperationId, requestHash, lastBoardVersion: baseCard.version, createInputId: 'create-input',
      messageInputId: 'dispatch-input', phase: 'create-unknown', hostId: 'roomhacker-server-100',
      harness: 'codex', startedBy: 'nikita', createdAt: baseCard.created, updatedAt: baseCard.updated,
    }] };

    const response = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('UNKNOWN replay response missing');
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ replay: true, operationId: canonicalOperationId });
    expect(mocks.updateCard).not.toHaveBeenCalled();
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'fleet_create_session')).toHaveLength(0);
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

  it('admits one owner-instructed generic continuation in the same session and preserves the existing human review result', async () => {
    mocks.currentCard.value = researchCard();
    mocks.sessionInfo.value = {
      ...mocks.sessionInfo.value,
      meta: { nativeLastTurn: { turnId: 'parent-turn', status: 'completed' } },
    };
    const first = await PATCH(followUpRequest('continue-task', 8), { params: Promise.resolve({ id: baseCard.id }) });
    if (!first) throw new Error('task continuation response missing');
    expect(first.status).toBe(202);
    const child = mocks.currentCard.value?.taskExecutionHistory?.[0]?.continuations?.[0];
    expect(child).toMatchObject({ kind: 'task-follow-up-v1', instruction: continuationText, phase: 'running', nativeTurnId: 'turn-1' });
    expect(mocks.currentCard.value).toMatchObject({ column: 'review', needsReview: true, reviewHistory: [] });
    expect(mocks.currentCard.value?.resultHistory?.[0]?.summary).toBe('Original result');
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]).toMatchObject({ phase: 'result', nativeTurnId: 'parent-turn' });
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'fleet_create_session')).toHaveLength(0);
    const send = mocks.callOwnerHerderTool.mock.calls.find(([tool]) => tool === 'send_message');
    expect(send?.[1]).toMatchObject({ sessionId, harness: 'codex', inputId: child?.inputId, mode: 'steer', humanRequested: true });
    expect(send?.[1].message).toContain(continuationText);
    expect(send?.[1].message).toContain('Не пиши людям, не звони');
    expect(send?.[1].message).not.toContain('внедрение Airlock для малого и среднего бизнеса');

    const current = mocks.currentCard.value!;
    const replay = await PATCH(followUpRequest('continue-task', current.version), { params: Promise.resolve({ id: baseCard.id }) });
    if (!replay) throw new Error('research continuation replay response missing');
    expect(replay.status).toBe(202);
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'send_message')).toHaveLength(1);
  });

  it('lets a current project manager append one child to another actor legacy parent without remapping or cross-actor replay', async () => {
    const forProject = vi.fn(async () => ({ project: 'Demo', team: 'integrator', readAllowed: true as const, writeAllowed: true }));
    mocks.nativeProjectAccess.value = { userId: 'native-manager-b', forProject };
    mocks.currentCard.value = researchCard();
    mocks.sessionInfo.value = { ...mocks.sessionInfo.value, meta: { nativeLastTurn: { turnId: 'parent-turn', status: 'completed' } } };

    const first = await PATCH(followUpRequest('continue-task', 8, undefined, continuationText, true), { params: Promise.resolve({ id: baseCard.id }) });
    if (!first) throw new Error('shared-project continuation response missing');
    expect(first.status).toBe(202);
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]).toMatchObject({ startedBy: 'nikita', nativeSessionId: sessionId });
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.continuations?.[0]).toMatchObject({ requestedBy: 'native-manager-b', phase: 'running' });
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'send_message')).toHaveLength(1);

    const current = mocks.currentCard.value!;
    mocks.nativeProjectAccess.value = null;
    const legacyReplay = await PATCH(followUpRequest('continue-task', current.version), { params: Promise.resolve({ id: baseCard.id }) });
    if (!legacyReplay) throw new Error('legacy cross-actor replay response missing');
    expect(legacyReplay.status).toBe(409);
    mocks.nativeProjectAccess.value = { userId: 'native-manager-c', forProject };
    const replay = await PATCH(followUpRequest('continue-task', current.version, undefined, continuationText, true), { params: Promise.resolve({ id: baseCard.id }) });
    if (!replay) throw new Error('cross-actor replay response missing');
    expect(replay.status).toBe(409);
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'send_message')).toHaveLength(1);
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.startedBy).toBe('nikita');
  });

  it('keeps an unknown child non-replayable by a different current project manager', async () => {
    const forProject = vi.fn(async () => ({ project: 'Demo', team: 'integrator', readAllowed: true as const, writeAllowed: true }));
    mocks.nativeProjectAccess.value = { userId: 'native-manager-b', forProject };
    mocks.currentCard.value = researchCard();
    mocks.sessionInfo.value = { ...mocks.sessionInfo.value, meta: { nativeLastTurn: { turnId: 'parent-turn', status: 'completed' } } };
    mocks.callOwnerHerderTool.mockImplementation((tool: string, args: Record<string, unknown>) => {
      if (tool === 'send_message') throw new Error('ambiguous dispatch');
      return toolResult(tool, args);
    });
    const first = await PATCH(followUpRequest('continue-task', 8, undefined, continuationText, true), { params: Promise.resolve({ id: baseCard.id }) });
    if (!first) throw new Error('native unknown child response missing');
    expect(first.status).toBe(202);
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.continuations?.[0]).toMatchObject({ requestedBy: 'native-manager-b', phase: 'unknown' });

    mocks.nativeProjectAccess.value = { userId: 'native-manager-c', forProject };
    const current = mocks.currentCard.value!;
    const replay = await PATCH(followUpRequest('continue-task', current.version, undefined, continuationText, true), { params: Promise.resolve({ id: baseCard.id }) });
    if (!replay) throw new Error('cross-actor unknown replay response missing');
    expect(replay.status).toBe(409);
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'send_message')).toHaveLength(1);
  });

  it('keeps the complete owner instruction and fixed rules when long card context must be shortened', async () => {
    const longDescription = `CARD-CONTEXT-START ${'Карточный контекст '.repeat(3_000)} CARD-CONTEXT-END`;
    const instruction = 'Use official public sources only; do not contact anyone. OWNER-INSTRUCTION-END-MARKER';
    mocks.currentCard.value = researchCard(longDescription);
    mocks.sessionInfo.value = {
      ...mocks.sessionInfo.value,
      meta: { nativeLastTurn: { turnId: 'parent-turn', status: 'completed' } },
    };

    const response = await PATCH(followUpRequest('continue-task', 8, undefined, instruction), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('long-card continuation response missing');
    expect(response.status).toBe(202);

    const send = mocks.callOwnerHerderTool.mock.calls.find(([tool]) => tool === 'send_message');
    const prompt = send?.[1].message;
    if (typeof prompt !== 'string') throw new Error('long-card continuation prompt missing');
    expect(prompt).toContain(JSON.stringify(instruction));
    expect(prompt).toContain('Выполни только это ограниченное продолжение. Используй доступные надёжные источники');
    expect(prompt).toContain('Не пиши людям, не звони, не отправляй формы и не меняй внешние данные.');
    expect(prompt).toContain('Не отмечай карточку выполненной и не утверждай, что человек принял результат. Верни результат и источники для обычной проверки человеком.');
    expect(prompt).toContain('… [контекст сокращён]');
    expect(prompt).not.toContain('CARD-CONTEXT-END');
    expect(prompt.length).toBeLessThanOrEqual(48_000);
  });

  it('keeps an unknown continuation query-only after uncertain dispatch', async () => {
    mocks.currentCard.value = researchCard();
    mocks.sessionInfo.value = { ...mocks.sessionInfo.value, meta: { nativeLastTurn: { turnId: 'parent-turn', status: 'completed' } } };
    mocks.callOwnerHerderTool.mockImplementation((tool: string, args: Record<string, unknown>) => {
      if (tool === 'send_message') throw new Error('ambiguous dispatch');
      return toolResult(tool, args);
    });
    const first = await PATCH(followUpRequest('continue-task', 8), { params: Promise.resolve({ id: baseCard.id }) });
    if (!first) throw new Error('unknown continuation response missing');
    expect(first.status).toBe(202);
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.continuations?.[0]?.phase).toBe('unknown');
    const current = mocks.currentCard.value!;
    const replay = await PATCH(followUpRequest('continue-task', current.version), { params: Promise.resolve({ id: baseCard.id }) });
    if (!replay) throw new Error('unknown continuation query response missing');
    expect(replay.status).toBe(202);
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'send_message')).toHaveLength(1);
    const changedText = await PATCH(followUpRequest('continue-task', current.version, undefined, 'A different instruction'), { params: Promise.resolve({ id: baseCard.id }) });
    if (!changedText) throw new Error('changed instruction response missing');
    expect(changedText.status).toBe(409);
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'send_message')).toHaveLength(1);
  });

  it('keeps a late native admission receipt when the card is edited during send', async () => {
    mocks.currentCard.value = researchCard();
    mocks.sessionInfo.value = { ...mocks.sessionInfo.value, meta: { nativeLastTurn: { turnId: 'parent-turn', status: 'completed' } } };
    mocks.callOwnerHerderTool.mockImplementation((tool: string, args: Record<string, unknown>) => {
      if (tool === 'send_message') {
        mocks.currentCard.value = { ...mocks.currentCard.value!, version: mocks.currentCard.value!.version + 1,
          tags: ['edited while send was in flight'] };
      }
      return toolResult(tool, args);
    });
    const response = await PATCH(followUpRequest('continue-task', 8), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('late admission response missing');
    expect(response.status).toBe(202);
    expect(mocks.currentCard.value?.tags).toEqual(['edited while send was in flight']);
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.continuations?.[0]).toMatchObject({
      phase: 'running', inputId: expect.any(String), nativeTurnId: 'turn-1',
    });
    expect(mocks.currentCard.value?.column).toBe('review');
    expect(mocks.currentCard.value?.needsReview).toBe(true);
  });

  it('serializes concurrent duplicate continuation requests to one durable intent and one dispatch', async () => {
    mocks.currentCard.value = researchCard();
    mocks.sessionInfo.value = { ...mocks.sessionInfo.value, meta: { nativeLastTurn: { turnId: 'parent-turn', status: 'completed' } } };
    const [first, duplicate] = await Promise.all([
      PATCH(followUpRequest('continue-task', 8), { params: Promise.resolve({ id: baseCard.id }) }),
      PATCH(followUpRequest('continue-task', 8), { params: Promise.resolve({ id: baseCard.id }) }),
    ]);
    if (!first || !duplicate) throw new Error('concurrent continuation response missing');
    expect([first.status, duplicate.status].sort()).toEqual([202, 409]);
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.continuations).toHaveLength(1);
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'send_message')).toHaveLength(1);
  });

  it('denies continuation for stale version, changed card, or non-owner before dispatch', async () => {
    mocks.currentCard.value = researchCard();
    const stale = await PATCH(followUpRequest('continue-task', 7), { params: Promise.resolve({ id: baseCard.id }) });
    if (!stale) throw new Error('stale continuation response missing');
    expect(stale.status).toBe(409);
    mocks.currentCard.value = { ...researchCard(), version: 9, tags: ['changed'] };
    const changed = await PATCH(followUpRequest('continue-task', 9), { params: Promise.resolve({ id: baseCard.id }) });
    if (!changed) throw new Error('changed continuation response missing');
    expect(changed.status).toBe(409);
    mocks.currentCard.value = researchCard();
    mocks.identity.value = { username: 'other', scope: 'work' };
    const unauthorized = await PATCH(followUpRequest('continue-task', 8), { params: Promise.resolve({ id: baseCard.id }) });
    if (!unauthorized) throw new Error('unauthorized continuation response missing');
    expect(unauthorized.status).toBe(403);
    expect(mocks.callOwnerHerderTool).not.toHaveBeenCalled();
    expect(mocks.updateCard).not.toHaveBeenCalled();
  });

  it('lets a second current manager reconcile the exact child result without changing parent actor or review history', async () => {
    const projectWrite = (userId: string) => ({ userId, forProject: vi.fn(async () => ({ project: 'Demo', team: 'integrator', readAllowed: true as const, writeAllowed: true })) });
    mocks.nativeProjectAccess.value = projectWrite('native-manager-b');
    mocks.currentCard.value = researchCard();
    mocks.sessionInfo.value = { ...mocks.sessionInfo.value, meta: { nativeLastTurn: { turnId: 'parent-turn', status: 'completed' } } };
    const first = await PATCH(followUpRequest('continue-task', 8, undefined, continuationText, true), { params: Promise.resolve({ id: baseCard.id }) });
    if (!first) throw new Error('research continuation admission missing');
    const admitted = mocks.currentCard.value!;
    expect(admitted.taskExecutionHistory?.[0]?.startedBy).toBe('nikita');
    expect(admitted.taskExecutionHistory?.[0]?.continuations?.[0]?.requestedBy).toBe('native-manager-b');
    const continuationId = admitted.taskExecutionHistory?.[0]?.continuations?.[0]?.id;
    if (!continuationId) throw new Error('persisted continuation ID missing');
    const writeCount = mocks.updateCard.mock.calls.length;
    mocks.sessionInfo.value = { ...mocks.sessionInfo.value, status: 'idle', meta: { nativeLastTurn: { turnId: 'other-turn', status: 'completed' } } };
    const mismatched = await PATCH(followUpRequest('sync-task-continuation', admitted.version, continuationId), { params: Promise.resolve({ id: baseCard.id }) });
    if (!mismatched) throw new Error('mismatched child turn response missing');
    expect(mismatched.status).toBe(202);
    expect(mocks.currentCard.value?.version).toBe(admitted.version);
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.continuations?.[0]?.phase).toBe('running');
    expect(mocks.updateCard).toHaveBeenCalledTimes(writeCount);
    mocks.sessionInfo.value = { ...mocks.sessionInfo.value, status: 'idle', meta: { nativeLastTurn: { turnId: 'turn-1', status: 'completed' } } };
    mocks.nativeProjectAccess.value = projectWrite('native-manager-c');
    const response = await PATCH(followUpRequest('sync-task-continuation', admitted.version, continuationId, continuationText, true), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('research continuation sync missing');
    expect(response.status).toBe(200);
    expect(mocks.currentCard.value).toMatchObject({ column: 'review', needsReview: true, reviewHistory: [] });
    expect(mocks.currentCard.value?.resultHistory?.map(item => item.summary)).toEqual(['Original result', 'Found two candidates']);
    expect(mocks.currentCard.value?.resultHistory?.[1]?.submittedBy).toBe('native-manager-c');
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.phase).toBe('result');
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.continuations?.[0]).toMatchObject({
      phase: 'result', nativeTurnId: 'turn-1', summary: 'Found two candidates',
    });
    expect(mocks.validateTransition).not.toHaveBeenCalled();
    const savedVersion = mocks.currentCard.value!.version;
    const duplicateSync = await PATCH(followUpRequest('sync-task-continuation', savedVersion, continuationId, continuationText, true), { params: Promise.resolve({ id: baseCard.id }) });
    if (!duplicateSync) throw new Error('duplicate child result readback missing');
    expect(duplicateSync.status).toBe(200);
    expect(mocks.currentCard.value?.resultHistory?.map(item => item.summary)).toEqual(['Original result', 'Found two candidates']);
  });

  it('does not commit a child result if the card version changes during transcript read', async () => {
    mocks.currentCard.value = researchCard();
    mocks.sessionInfo.value = { ...mocks.sessionInfo.value, meta: { nativeLastTurn: { turnId: 'parent-turn', status: 'completed' } } };
    const first = await PATCH(followUpRequest('continue-task', 8), { params: Promise.resolve({ id: baseCard.id }) });
    if (!first) throw new Error('task continuation admission missing');
    const admitted = mocks.currentCard.value!;
    const continuationId = admitted.taskExecutionHistory?.[0]?.continuations?.[0]?.id;
    if (!continuationId) throw new Error('persisted continuation ID missing');
    mocks.sessionInfo.value = { ...mocks.sessionInfo.value, status: 'idle', meta: { nativeLastTurn: { turnId: 'turn-1', status: 'completed' } } };
    mocks.cardChangesAfterView.value = true;
    const writeCount = mocks.updateCard.mock.calls.length;
    const response = await PATCH(followUpRequest('sync-task-continuation', admitted.version, continuationId), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('stale child sync response missing');
    expect(response.status).toBe(409);
    expect(mocks.currentCard.value?.tags).toEqual(['edited during transcript read']);
    expect(mocks.currentCard.value?.column).toBe('review');
    expect(mocks.currentCard.value?.needsReview).toBe(true);
    expect(mocks.currentCard.value?.reviewHistory).toEqual([]);
    expect(mocks.currentCard.value?.resultHistory?.map(item => item.summary)).toEqual(['Original result']);
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.continuations?.[0]?.phase).toBe('running');
    expect(mocks.updateCard).toHaveBeenCalledTimes(writeCount);
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

  it('allows distinct direct messages once, stops the exact receipt, and never replays either action', async () => {
    mocks.currentCard.value = controllableOpenCodeCard();
    mocks.callOwnerHerderTool.mockImplementation(async (tool: string, args: Record<string, unknown>) => ({
      content: [{ type: 'text', text: tool === 'send_message'
        ? `Message sent to [${String(args.harness)}] ${String(args.sessionId)} (steering).\nNative admission receipt: ${JSON.stringify({ admitted: true, inputId: args.inputId })}`
        : `Stopped agent [${String(args.harness)}] ${String(args.sessionId)} on host '${String(args.hostId)}'.` }],
    }));

    const direct = await PATCH(sessionControlRequest({ action: 'session-direct', expectedVersion: 4, message: 'Проверь текущий шаг' }), {
      params: Promise.resolve({ id: controlCardId }),
    });
    if (!direct) throw new Error('direct response missing');
    expect(direct.status).toBe(200);
    expect(await direct.json()).toMatchObject({ boardOperationId: controlOperationId, action: 'direct', state: 'accepted' });
    expect(mocks.callOwnerHerderTool).toHaveBeenCalledWith('send_message', {
      sessionId: 'opencode-session-1', harness: 'opencode', hostId: 'roomhacker-server-100',
      inputId: createHash('sha256').update(JSON.stringify({
        cardId: controlCardId, operationId: controlOperationId, action: 'direct', message: 'Проверь текущий шаг',
      })).digest('hex'),
      message: 'Проверь текущий шаг', mode: 'steer',
    });

    const secondDirect = await PATCH(sessionControlRequest({ action: 'session-direct', expectedVersion: mocks.currentCard.value!.version, message: 'Сделай следующий шаг' }), {
      params: Promise.resolve({ id: controlCardId }),
    });
    if (!secondDirect) throw new Error('second direct response missing');
    expect(secondDirect.status).toBe(200);
    expect(mocks.callOwnerHerderTool).toHaveBeenCalledWith('send_message', {
      sessionId: 'opencode-session-1', harness: 'opencode', hostId: 'roomhacker-server-100',
      inputId: createHash('sha256').update(JSON.stringify({
        cardId: controlCardId, operationId: controlOperationId, action: 'direct', message: 'Сделай следующий шаг',
      })).digest('hex'),
      message: 'Сделай следующий шаг', mode: 'steer',
    });
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.sessionControls?.direct).toHaveLength(2);
    const callsAfterTwoMessages = mocks.callOwnerHerderTool.mock.calls.length;
    const replayFirstMessage = await PATCH(sessionControlRequest({ action: 'session-direct', expectedVersion: mocks.currentCard.value!.version, message: 'Проверь текущий шаг' }), {
      params: Promise.resolve({ id: controlCardId }),
    });
    if (!replayFirstMessage) throw new Error('direct replay response missing');
    expect(replayFirstMessage.status).toBe(200);
    expect(mocks.callOwnerHerderTool).toHaveBeenCalledTimes(callsAfterTwoMessages);
    const replaySecondMessage = await PATCH(sessionControlRequest({ action: 'session-direct', expectedVersion: mocks.currentCard.value!.version, message: 'Сделай следующий шаг' }), {
      params: Promise.resolve({ id: controlCardId }),
    });
    if (!replaySecondMessage) throw new Error('second direct replay response missing');
    expect(replaySecondMessage.status).toBe(200);
    expect(mocks.callOwnerHerderTool).toHaveBeenCalledTimes(callsAfterTwoMessages);

    const versionAfterDirect = mocks.currentCard.value!.version;
    const stop = await PATCH(sessionControlRequest({ action: 'session-stop', expectedVersion: versionAfterDirect }), {
      params: Promise.resolve({ id: controlCardId }),
    });
    if (!stop) throw new Error('stop response missing');
    expect(stop.status).toBe(200);
    expect(await stop.json()).toMatchObject({ boardOperationId: controlOperationId, action: 'stop', state: 'accepted' });
    expect(mocks.callOwnerHerderTool).toHaveBeenCalledWith('stop_agent', {
      sessionId: 'opencode-session-1', harness: 'opencode', hostId: 'roomhacker-server-100',
    });

    const beforeDuplicate = mocks.callOwnerHerderTool.mock.calls.length;
    const duplicate = await PATCH(sessionControlRequest({ action: 'session-stop', expectedVersion: mocks.currentCard.value!.version }), {
      params: Promise.resolve({ id: controlCardId }),
    });
    if (!duplicate) throw new Error('duplicate stop response missing');
    expect(duplicate.status).toBe(200);
    expect(mocks.callOwnerHerderTool).toHaveBeenCalledTimes(beforeDuplicate);
  });

  it('persists UNKNOWN before returning and refuses to repeat the same direct action', async () => {
    mocks.currentCard.value = controllableOpenCodeCard();
    mocks.callOwnerHerderTool.mockRejectedValue(new Error('synthetic transport ambiguity'));
    const first = await PATCH(sessionControlRequest({ action: 'session-direct', expectedVersion: 4, message: 'Продолжай текущий шаг' }), {
      params: Promise.resolve({ id: controlCardId }),
    });
    if (!first) throw new Error('unknown direct response missing');
    expect(first.status).toBe(202);
    expect(await first.json()).toMatchObject({ action: 'direct', state: 'unknown' });
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.sessionControls?.direct?.[0]?.phase).toBe('unknown');

    const retry = await PATCH(sessionControlRequest({ action: 'session-direct', expectedVersion: mocks.currentCard.value!.version, message: 'Продолжай текущий шаг' }), {
      params: Promise.resolve({ id: controlCardId }),
    });
    if (!retry) throw new Error('unknown direct retry response missing');
    expect(retry.status).toBe(202);
    expect(mocks.callOwnerHerderTool).toHaveBeenCalledTimes(1);
  });

  it('accepts the native current-turn reservation only with its exact stable input receipt', async () => {
    mocks.currentCard.value = controllableOpenCodeCard();
    const message = 'Зарезервируй текущий шаг';
    const inputId = createHash('sha256').update(JSON.stringify({
      cardId: controlCardId, operationId: controlOperationId, action: 'direct', message,
    })).digest('hex');
    mocks.callOwnerHerderTool.mockImplementation(async (_tool: string, args: Record<string, unknown>) => ({
      content: [{ type: 'text', text: `Message reserved for the current turn of [${String(args.harness)}] ${String(args.sessionId)}; model observation is not yet confirmed.\nCurrent-turn context reservation receipt: ${JSON.stringify({ admitted: true, inputId })}` }],
    }));

    const response = await PATCH(sessionControlRequest({ action: 'session-direct', expectedVersion: 4, message }), {
      params: Promise.resolve({ id: controlCardId }),
    });
    if (!response) throw new Error('current-turn reservation response missing');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ boardOperationId: controlOperationId, action: 'direct', state: 'accepted' });
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.sessionControls?.direct?.[0]?.phase).toBe('accepted');
  });

  it('does not accept a browser-supplied board operation id or an ambiguous active receipt set', async () => {
    mocks.currentCard.value = controllableOpenCodeCard();
    const forged = await PATCH(sessionControlRequest({ action: 'session-stop', expectedVersion: 4, board_operation_id: 'f'.repeat(64) }), {
      params: Promise.resolve({ id: controlCardId }),
    });
    if (!forged) throw new Error('forged request response missing');
    expect(forged.status).toBe(400);
    expect(mocks.callOwnerHerderTool).not.toHaveBeenCalled();

    const card = mocks.currentCard.value!;
    mocks.currentCard.value = { ...card, taskExecutionHistory: [
      ...card.taskExecutionHistory!,
      { ...card.taskExecutionHistory![0]!, operationId: 'd'.repeat(64) },
    ] };
    const ambiguous = await PATCH(sessionControlRequest({ action: 'session-stop', expectedVersion: 4 }), {
      params: Promise.resolve({ id: controlCardId }),
    });
    if (!ambiguous) throw new Error('ambiguous request response missing');
    expect(ambiguous.status).toBe(409);
    expect(mocks.callOwnerHerderTool).not.toHaveBeenCalled();
  });
});
