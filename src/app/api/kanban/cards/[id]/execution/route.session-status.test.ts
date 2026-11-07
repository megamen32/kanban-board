import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestIdentity } from '@/lib/auth/request';
import type { KanbanCard, TaskExecutionPhase } from '@/lib/kanban/types';
import type { NativeProjectAccessContext } from '@/lib/kanban/native-project-access';

const mocks = vi.hoisted(() => ({
  current: { value: undefined as KanbanCard | undefined },
  identity: { value: { username: 'operator', scope: 'work' } as RequestIdentity | null },
  human: { value: null as RequestIdentity | null },
  native: { value: null as NativeProjectAccessContext | null },
  findCardById: vi.fn(), updateCard: vi.fn(), tasksDirForScope: vi.fn(),
  ownerBrowserReadAllowed: vi.fn(), nativeProjectAccessContextFromRequest: vi.fn(),
  automationTokenValid: vi.fn(), boardHumanIdentityFromRequest: vi.fn(),
  callOwnerHerderTool: vi.fn(), readOwnerHerderResource: vi.fn(), taskExecutionSnapshot: vi.fn(),
  sweepQuestionTimeout: vi.fn(), reconcileConfiguredDotReceipt: vi.fn(), configuredDotTransport: vi.fn(),
  startDotExecution: vi.fn(), dotExecutionAvailability: vi.fn(), markSourceIntentConsumed: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('@/lib/kanban/file-store', () => ({ findCardById: mocks.findCardById, updateCard: mocks.updateCard }));
vi.mock('@/lib/auth/request', () => ({
  identityFromRequest: () => mocks.identity.value,
  boardIdentityFromRequest: () => mocks.identity.value ?? { username: 'anonymous', scope: 'work' },
  nativeProjectAccessContextFromRequest: mocks.nativeProjectAccessContextFromRequest,
  automationTokenValid: mocks.automationTokenValid,
}));
vi.mock('@/lib/auth/board-human', () => ({ boardHumanIdentityFromRequest: mocks.boardHumanIdentityFromRequest }));
vi.mock('@/lib/auth/owner-browser-read', () => ({ ownerBrowserReadAllowed: mocks.ownerBrowserReadAllowed }));
vi.mock('@/lib/auth/data-scope', () => ({ tasksDirForScope: mocks.tasksDirForScope }));
vi.mock('@/lib/kanban/task-execution', () => ({ taskExecutionSnapshot: mocks.taskExecutionSnapshot }));
vi.mock('@/lib/kanban/task-execution-client', () => ({
  callOwnerHerderTool: mocks.callOwnerHerderTool, readOwnerHerderResource: mocks.readOwnerHerderResource,
}));
vi.mock('@/lib/kanban/board-questions', () => ({
  executorProtocolBlock: vi.fn(), newExecutorKey: vi.fn(), sweepQuestionTimeout: mocks.sweepQuestionTimeout,
}));
vi.mock('@/lib/kanban/dot-runtime', () => ({
  configuredDotTransport: mocks.configuredDotTransport, reconcileConfiguredDotReceipt: mocks.reconcileConfiguredDotReceipt,
}));
vi.mock('@/lib/kanban/dot-execution', () => ({
  startDotExecution: mocks.startDotExecution, dotExecutionAvailability: mocks.dotExecutionAvailability,
}));
vi.mock('@/lib/kanban/source-operation', () => ({ markSourceIntentConsumed: mocks.markSourceIntentConsumed }));

import { GET } from './route';

const cardId = '11111111-2222-4333-8444-555555555555';
const operationId = 'a'.repeat(64);
const sessionId = 'test-session';

function request(query = `session=status&operationId=${operationId}`, headers: Record<string, string> = {}) {
  return new NextRequest(`https://board.example.test/api/kanban/cards/${cardId}/execution?${query}`, { headers });
}
function read(query?: string, headers?: Record<string, string>) {
  return GET(request(query, headers), { params: Promise.resolve({ id: cardId }) });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.current.value = {
    id: cardId, title: 'Test', description: '', column: 'in-progress', priority: 'medium', tags: [], order: 1,
    created: '2026-11-07T10:00:00.000Z', updated: '2026-11-07T10:00:00.000Z', fileName: 'test.md',
    version: 4, project: 'Demo', owner: 'operator', assignees: [],
    pendingQuestion: { id: 'test-question', text: 'An expired question', choices: [], timeoutValue: 'expired',
      askedAt: '2000-01-01T00:00:00Z', attemptOperationId: operationId },
    taskExecutionHistory: [{ operationId, requestHash: 'b'.repeat(64), lastBoardVersion: 4,
      createInputId: 'c'.repeat(64), messageInputId: 'd'.repeat(64), phase: 'created',
      hostId: 'test-host', harness: 'codex', nativeSessionId: sessionId,
      createReceiptText: JSON.stringify({ cwd: '/srv/demo' }), startedBy: 'operator',
      createdAt: '2026-11-07T10:00:00.000Z', updatedAt: '2026-11-07T10:00:00.000Z' }],
  };
  mocks.identity.value = { username: 'operator', scope: 'work' };
  mocks.human.value = null;
  mocks.native.value = null;
  mocks.ownerBrowserReadAllowed.mockResolvedValue(false);
  mocks.nativeProjectAccessContextFromRequest.mockImplementation(async () => mocks.native.value);
  mocks.boardHumanIdentityFromRequest.mockImplementation(async () => mocks.human.value);
  mocks.tasksDirForScope.mockReturnValue('/synthetic/tasks');
  mocks.findCardById.mockImplementation(() => mocks.current.value);
  mocks.callOwnerHerderTool.mockResolvedValue({ content: [], structuredContent: { session: {
    id: sessionId, hostId: 'test-host', harness: 'codex', cwd: '/srv/demo', model: 'gpt-6-luna',
    status: 'running', lastActivity: '2026-11-07T11:00:00.000Z',
  } } });
  vi.stubGlobal('fetch', mocks.fetch);
});

afterEach(() => {
  // Every path, including errors and phase=created, must remain observation only.
  for (const forbidden of [mocks.updateCard, mocks.readOwnerHerderResource, mocks.taskExecutionSnapshot,
    mocks.sweepQuestionTimeout, mocks.reconcileConfiguredDotReceipt, mocks.configuredDotTransport,
    mocks.startDotExecution, mocks.dotExecutionAvailability, mocks.markSourceIntentConsumed, mocks.fetch,
    mocks.automationTokenValid]) expect(forbidden).not.toHaveBeenCalled();
  expect(mocks.callOwnerHerderTool.mock.calls.every(([name]) => name === 'agent_info')).toBe(true);
  expect(mocks.callOwnerHerderTool.mock.calls.length).toBeLessThanOrEqual(1);
  vi.unstubAllGlobals();
});

describe('explicit read-only session status GET', () => {
  it.each(['created', 'running', 'waiting', 'result', 'dispatch-unknown'] satisfies TaskExecutionPhase[])(
    'reads an exact session with no sweep, dispatch, result sync, or write in phase %s', async phase => {
      mocks.current.value!.taskExecutionHistory![0]!.phase = phase;
      const before = structuredClone(mocks.current.value);
      const response = await read();
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(await response.json()).toMatchObject({ cardId, cardVersion: 4, operationId, sessionId,
        state: 'running', source: 'agent-herder:agent_info', checkedAt: expect.any(String), reason: null });
      expect(mocks.callOwnerHerderTool).toHaveBeenCalledExactlyOnceWith('agent_info', {
        hostId: 'test-host', harness: 'codex', sessionId,
      }, 8_000);
      expect(mocks.findCardById).toHaveBeenCalledTimes(2);
      expect(mocks.findCardById).toHaveBeenCalledWith(cardId, '/synthetic/tasks');
      expect(mocks.current.value).toEqual(before);
    },
  );

  it('accepts the existing human identity fallback and assignee policy', async () => {
    mocks.identity.value = null;
    mocks.human.value = { username: 'assignee', scope: 'work' };
    mocks.current.value!.assignees = ['assignee'];
    expect((await read()).status).toBe(200);
    expect(mocks.boardHumanIdentityFromRequest).toHaveBeenCalledOnce();
  });

  it('accepts an existing signed native project read grant without requiring write', async () => {
    mocks.identity.value = null;
    const forProject = vi.fn(async (project: string) => ({ project, team: 'Demo team', readAllowed: true as const, writeAllowed: false }));
    mocks.native.value = { userId: 'native-reader', forProject };
    expect((await read()).status).toBe(200);
    expect(forProject).toHaveBeenCalledExactlyOnceWith('Demo');
    expect(mocks.boardHumanIdentityFromRequest).not.toHaveBeenCalled();
  });

  it.each([
    ['native_project_access_denied', 404], ['native_project_access_unavailable', 503],
  ] as const)('refuses a native project grant error %s before provider access', async (message, status) => {
    mocks.native.value = { userId: 'native-reader', forProject: async () => { throw new Error(message); } };
    expect((await read()).status).toBe(status);
    expect(mocks.callOwnerHerderTool).not.toHaveBeenCalled();
  });

  it('does not fall back to a valid owner cookie after a native assertion failure', async () => {
    mocks.nativeProjectAccessContextFromRequest.mockRejectedValueOnce(new Error('native_identity_invalid'));
    expect((await read()).status).toBe(403);
    expect(mocks.callOwnerHerderTool).not.toHaveBeenCalled();
    expect(mocks.findCardById).not.toHaveBeenCalled();
  });

  it.each([
    [null, 401], [{ username: 'foreign', scope: 'work' }, 403], [{ username: 'operator', scope: 'personal' }, 403],
  ] as const)('preserves the existing caller identity/scope gate', async (identity, status) => {
    mocks.identity.value = identity;
    expect((await read()).status).toBe(status);
    expect(mocks.callOwnerHerderTool).not.toHaveBeenCalled();
  });

  it('does not enable automation-token or assigned-reviewer access for this read', async () => {
    mocks.identity.value = null;
    mocks.automationTokenValid.mockReturnValue(true);
    expect((await read(undefined, { 'x-kanban-automation-token': 'synthetic-token' })).status).toBe(401);
    mocks.identity.value = { username: 'reviewer', scope: 'work' };
    mocks.current.value!.requiresApprovalFrom = ['reviewer'];
    expect((await read()).status).toBe(403);
    expect(mocks.callOwnerHerderTool).not.toHaveBeenCalled();
  });

  it('returns not found for an absent card without a provider read', async () => {
    mocks.current.value = undefined;
    expect((await read()).status).toBe(404);
    expect(mocks.callOwnerHerderTool).not.toHaveBeenCalled();
  });

  it.each([
    `session=status`, `session=status&operationId=${operationId}&sessionId=foreign`,
    `session=status&operationId=${operationId}&target=preview`,
    `session=status&operationId=${operationId}&operationId=${operationId}`,
  ])('rejects ambiguous or injected query selectors', async query => {
    expect((await read(query)).status).toBe(400);
    expect(mocks.callOwnerHerderTool).not.toHaveBeenCalled();
  });

  it('keeps an unsupported dot receipt unknown without reconciling it', async () => {
    mocks.current.value!.taskExecutionHistory![0]!.provider = 'dot';
    const response = await read();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ state: 'unknown', source: null, checkedAt: null, reason: 'provider_not_supported' });
    expect(mocks.callOwnerHerderTool).not.toHaveBeenCalled();
  });

  it('does not return a known state for a card changed while the provider was read', async () => {
    const original = structuredClone(mocks.current.value!);
    mocks.findCardById.mockReturnValueOnce(original).mockReturnValueOnce({ ...original, version: 5 });
    const response = await read();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ state: 'unknown', source: null, checkedAt: null, reason: 'card_changed' });
  });

  it('returns a sanitized unknown response when the provider is unavailable', async () => {
    mocks.callOwnerHerderTool.mockRejectedValueOnce(new Error('fake-secret-token\nprivate stack trace'));
    const response = await read();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ cardId, operationId, sessionId, state: 'unknown', source: null, checkedAt: null, reason: 'transport_unavailable' });
    expect(JSON.stringify(body)).not.toMatch(/fake-secret-token|stack trace/);
  });
});
