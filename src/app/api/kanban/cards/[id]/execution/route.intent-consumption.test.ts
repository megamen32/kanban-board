import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
  readiness: { harness: 'codex' as 'codex' | 'opencode', model: 'gpt-6-luna' },
}));

vi.mock('@/lib/kanban/file-store', () => ({ findCardById: mocks.findCardById, updateCard: mocks.updateCard }));
vi.mock('@/lib/auth/request', () => ({
  boardIdentityFromRequest: () => mocks.identity.value ?? { username: 'anonymous', scope: 'work' },
  identityFromRequest: () => mocks.identity.value,
  nativeProjectAccessContextFromRequest: vi.fn(async () => null),
}));
vi.mock('../../../../../../lib/auth/board-human', () => ({
  boardHumanIdentityFromRequest: mocks.boardHumanIdentityFromRequest,
}));
vi.mock('@/lib/auth/data-scope', () => ({ tasksDirForScope: mocks.tasksDirForScope }));
vi.mock('@/lib/kanban/task-execution', () => ({ taskExecutionSnapshot: mocks.taskExecutionSnapshot }));
vi.mock('@/lib/kanban/task-execution-client', () => ({ callOwnerHerderTool: mocks.callOwnerHerderTool }));
vi.mock('@/lib/kanban/transition-policy', () => ({ validateTransition: mocks.validateTransition }));

// The real source-operation journal is used on purpose: this sheet proves the
// route spends a genuine pending intent, not a mocked transition.
import { POST } from './route';

const operationKey = 'a'.repeat(64);
const journalIntentId = '11111111-2222-3333-4444-555555555555';
const foreignIntentId = '99999999-8888-7777-6666-555555555555';
const operationId = 'ui-operation-1234567890';
const sessionId = 'native-session-1';
const scopedProjectRoot = '/workspace/exmanager-task-workspace';
const roots: string[] = [];

function fixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-intent-consumption-'));
  roots.push(dir);
  return dir;
}

function journalFile(dir: string): string {
  return path.join(dir, '.source-operations', 'source-operations.json');
}

function writeJournal(dir: string, intentState: 'PENDING' | 'CONSUMED'): string {
  const file = journalFile(dir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({
    version: 1,
    operations: {
      [operationKey]: {
        operationKey, requestHash: 'b'.repeat(64), provenanceHash: 'c'.repeat(64),
        cardId: 'task-1', classification: 'explicit-task', intentId: journalIntentId,
        intentState, state: 'COMMITTED', publication: 'ATTEMPTED', updatedAt: '2026-10-23T00:00:00.000Z',
      },
    },
  })}\n`);
  return file;
}

function journalRecord(dir: string): Record<string, unknown> {
  const journal = JSON.parse(fs.readFileSync(journalFile(dir), 'utf8')) as { operations: Record<string, Record<string, unknown>> };
  return Object.values(journal.operations)[0]!;
}

function sourceCard(intentId: string): KanbanCard {
  return {
    id: 'task-1', title: 'Research candidates', description: 'Find two SMB integrators', column: 'todo',
    priority: 'medium', tags: [], order: 1, created: '2026-10-20T10:00:00.000Z', updated: '2026-10-20T10:00:00.000Z',
    fileName: 'task.md', version: 4, project: 'Demo', assignees: [], owner: 'nikita',
    sourceAdmission: {
      operationKey, requestHash: 'b'.repeat(64), provenanceHash: 'c'.repeat(64), intentId,
      tenantId: 'tenant-1', sourceOwnerId: 'owner-1', sourceEventId: 'event-21', primaryItem: 'primary',
      sourceRevision: 'rev-1', requestedProject: 'Demo', classification: 'explicit-task',
      evidenceRefs: ['fixture:event-21:span-1'],
    },
  };
}

function postRequest(requestOperationId = operationId, expectedVersion = 4) {
  return new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ operationId: requestOperationId, expectedVersion }),
  });
}

function scopedReadiness(project = 'Demo') {
  const pathResolution = {
    requestedCwd: scopedProjectRoot, canonicalCwd: scopedProjectRoot, rootPath: scopedProjectRoot,
    contained: true, identityMatches: true,
  };
  return {
    hostId: 'roomhacker-server-100', nativeUser: 'operator',
    projectReadinessContract: 'integrator-host-readiness-v1',
    projectReadiness: {
      state: 'ready', projectId: project, projectRoot: scopedProjectRoot,
      rootIdentity: 'exmanager-workspace-root-v1', policyRevision: 'scope-policy-7',
      observedAtMs: Date.now(), runtimeInstanceId: 'herder-runtime-12', hostId: 'roomhacker-server-100',
      harness: mocks.readiness.harness, harnessVersion: `${mocks.readiness.harness}-test-1`, model: mocks.readiness.model,
      requiredTools: ['web_search'], availableTools: ['web_search', 'shell_exec'],
      availableModels: [mocks.readiness.model], resourceReady: true, cwd: scopedProjectRoot, pathResolution,
    },
  };
}

function toolResult(tool: string, args: Record<string, unknown>) {
  if (tool === 'fleet_node_info') {
    const info = scopedReadiness(args.project as string);
    return { structuredContent: info, content: [{ type: 'text', text: JSON.stringify(info) }] };
  }
  if (tool === 'fleet_create_session') {
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
      ok: true, created: true, inputId: args.inputId, harness: args.harness, sessionId, cwd: args.cwd,
      ...(projectExecution ? { projectReadinessContract: args.projectReadinessContract, projectExecution } : {}),
    }, content: [] };
  }
  if (tool === 'fleet_session_view') {
    const binding = mocks.currentCard.value?.taskExecutionHistory?.at(-1)?.projectBinding;
    const receiptCwd = binding?.cwd ?? scopedProjectRoot;
    return { structuredContent: {
      hostId: 'roomhacker-server-100', details: {
        session: { id: sessionId, harness: binding?.harness ?? 'codex', cwd: receiptCwd, model: binding?.model ?? 'gpt-6-luna' },
        historyUnavailable: false, messages: [{ role: 'assistant', text: 'Found two candidates' }],
      },
    }, content: [] };
  }
  if (tool === 'send_message') {
    return { content: [{ type: 'text', text: `Native admission receipt: ${JSON.stringify({ admitted: true, inputId: args.inputId, turnId: 'turn-1' })}` }] };
  }
  throw new Error(`unexpected tool ${tool}`);
}

describe('task execution launch intent consumption', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readiness = { harness: 'codex', model: 'gpt-6-luna' };
    mocks.humanIdentity.value = undefined;
    mocks.boardHumanIdentityFromRequest.mockImplementation(async () =>
      mocks.humanIdentity.value === undefined ? mocks.identity.value : mocks.humanIdentity.value);
    mocks.currentCard.value = sourceCard(journalIntentId);
    mocks.findCardById.mockImplementation(() => mocks.currentCard.value);
    mocks.updateCard.mockImplementation((_id: string, patch: Partial<KanbanCard>, expectedVersion: number) => {
      const current = mocks.currentCard.value!;
      if (current.version !== expectedVersion) return { conflict: true, serverCard: current };
      mocks.currentCard.value = { ...current, ...patch, version: current.version + 1 };
      return mocks.currentCard.value;
    });
    mocks.identity.value = { username: 'nikita', scope: 'work' };
    mocks.callOwnerHerderTool.mockImplementation(toolResult);
    mocks.validateTransition.mockReturnValue({ kind: 'accepted', patch: { column: 'in-progress' } });
    mocks.taskExecutionSnapshot.mockImplementation((card: KanbanCard) => ({
      cardId: card.id,
      state: card.taskExecutionHistory?.at(-1)?.phase === 'running' ? 'running' : 'not-started',
    }));
    process.env.EXMANAGER_TASK_EXECUTION_CWD = scopedProjectRoot;
    process.env.AGENT_HERDER_HTTP_TOKEN = 'test-only-protected-ref';
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('spends the pending launch intent exactly once, right after the durable receipt', async () => {
    const dir = fixture();
    writeJournal(dir, 'PENDING');
    mocks.tasksDirForScope.mockReturnValue(dir);

    const response = await POST(postRequest(), { params: Promise.resolve({ id: 'task-1' }) });

    expect(response.status).toBe(201);
    expect(mocks.currentCard.value?.taskExecutionHistory?.at(-1)?.phase).toBe('running');
    expect(journalRecord(dir)).toMatchObject({ intentState: 'CONSUMED', state: 'COMMITTED', intentId: journalIntentId });
  });

  it('replays safely: no second launch and the journal stays byte-identical', async () => {
    const dir = fixture();
    const file = writeJournal(dir, 'PENDING');
    mocks.tasksDirForScope.mockReturnValue(dir);

    const first = await POST(postRequest(), { params: Promise.resolve({ id: 'task-1' }) });
    expect(first.status).toBe(201);
    const firstBody = await first.json();
    const firstReceipt = mocks.currentCard.value?.taskExecutionHistory?.at(-1);
    expect(firstBody.operationId).toBe(firstReceipt?.operationId);
    expect(firstReceipt?.nativeSessionId).toBe(sessionId);
    const journalBefore = fs.readFileSync(file, 'utf8');
    const toolCallsBefore = mocks.callOwnerHerderTool.mock.calls.length;

    const replay = await POST(postRequest(), { params: Promise.resolve({ id: 'task-1' }) });

    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ replay: true, operationId: firstBody.operationId });
    expect(mocks.callOwnerHerderTool.mock.calls.length).toBe(toolCallsBefore);
    expect(fs.readFileSync(file, 'utf8')).toBe(journalBefore);
    expect(journalRecord(dir)).toMatchObject({ intentState: 'CONSUMED' });
    expect(mocks.currentCard.value?.taskExecutionHistory).toHaveLength(1);
  });

  it('closes the launch intent when the dispatch outcome is unknown and never starts a second session', async () => {
    const dir = fixture();
    writeJournal(dir, 'PENDING');
    mocks.tasksDirForScope.mockReturnValue(dir);
    const base = mocks.callOwnerHerderTool.getMockImplementation()!;
    mocks.callOwnerHerderTool.mockImplementation(async (tool: string, args: Record<string, unknown>) => {
      if (tool === 'send_message') throw new Error('mcp transport lost after the session was created');
      return base(tool, args);
    });

    const response = await POST(postRequest(), { params: Promise.resolve({ id: 'task-1' }) });

    expect(response.status).toBe(202);
    const receipt = mocks.currentCard.value?.taskExecutionHistory?.at(-1);
    expect(receipt?.phase).toBe('dispatch-unknown');
    // The ambiguous outcome still carries the sign that the native session exists.
    expect(receipt?.nativeSessionId).toBe(sessionId);
    expect(journalRecord(dir)).toMatchObject({ intentState: 'CONSUMED', state: 'COMMITTED', intentId: journalIntentId });

    const createsBefore = mocks.callOwnerHerderTool.mock.calls.filter(call => call[0] === 'fleet_create_session').length;
    expect(createsBefore).toBe(1);
    const repeat = await POST(postRequest('ui-operation-1234567891', mocks.currentCard.value!.version), {
      params: Promise.resolve({ id: 'task-1' }),
    });
    expect(repeat.status).toBe(409);
    expect(mocks.callOwnerHerderTool.mock.calls.filter(call => call[0] === 'fleet_create_session').length).toBe(1);
  });

  it('keeps the launch intent open only where the receipt proves the launch did not happen', async () => {
    const dir = fixture();
    writeJournal(dir, 'PENDING');
    mocks.tasksDirForScope.mockReturnValue(dir);
    let refusedCreates = 0;
    mocks.callOwnerHerderTool.mockImplementation(async (tool: string, args: Record<string, unknown>) => {
      if (tool === 'fleet_create_session' && refusedCreates === 0) {
        refusedCreates += 1;
        const refused = { state: 'not_attempted', inputId: args.inputId };
        return { structuredContent: refused, content: [{ type: 'text', text: JSON.stringify(refused) }] };
      }
      return toolResult(tool, args);
    });

    const refused = await POST(postRequest(), { params: Promise.resolve({ id: 'task-1' }) });

    expect(refused.status).toBe(503);
    expect(mocks.currentCard.value?.taskExecutionHistory?.at(-1)?.phase).toBe('stopped');
    // Nothing was created, so the intent stays spendable and a repeat launch is allowed.
    expect(journalRecord(dir)).toMatchObject({ intentState: 'PENDING' });

    const repeat = await POST(postRequest('ui-operation-1234567891', mocks.currentCard.value!.version), {
      params: Promise.resolve({ id: 'task-1' }),
    });
    expect(repeat.status).toBe(201);
    expect(mocks.currentCard.value?.taskExecutionHistory?.at(-1)?.phase).toBe('running');
    expect(journalRecord(dir)).toMatchObject({ intentState: 'CONSUMED' });
  });

  it('keeps the ordinary successful launch unchanged', async () => {
    const dir = fixture();
    writeJournal(dir, 'PENDING');
    mocks.tasksDirForScope.mockReturnValue(dir);

    const response = await POST(postRequest(), { params: Promise.resolve({ id: 'task-1' }) });

    expect(response.status).toBe(201);
    const receipt = mocks.currentCard.value?.taskExecutionHistory?.at(-1);
    expect(receipt?.phase).toBe('running');
    expect(receipt?.lastProgress).toBe('Задание передано в нативную сессию; ожидается результат.');
    expect(receipt?.lastProgress).not.toContain('intent');
    expect(journalRecord(dir)).toMatchObject({ intentState: 'CONSUMED' });
  });

  it('creates and verifies an OpenCode session using the fresh project readiness binding', async () => {
    const dir = fixture();
    writeJournal(dir, 'PENDING');
    mocks.tasksDirForScope.mockReturnValue(dir);
    mocks.readiness = { harness: 'opencode', model: 'omniroute/minimax-combo-m3.1' };

    const response = await POST(postRequest(), { params: Promise.resolve({ id: 'task-1' }) });

    expect(response.status).toBe(201);
    const receipt = mocks.currentCard.value?.taskExecutionHistory?.at(-1);
    expect(receipt).toMatchObject({
      phase: 'running', harness: 'opencode',
      projectBinding: { harness: 'opencode', model: 'omniroute/minimax-combo-m3.1' },
    });
    expect(mocks.callOwnerHerderTool).toHaveBeenCalledWith('fleet_create_session', expect.objectContaining({
      harness: 'opencode', model: 'omniroute/minimax-combo-m3.1',
    }));
    expect(mocks.callOwnerHerderTool).toHaveBeenCalledWith('fleet_session_view', expect.objectContaining({ harness: 'opencode' }));
    expect(mocks.callOwnerHerderTool).toHaveBeenCalledWith('send_message', expect.objectContaining({ harness: 'opencode' }));

    const store = await vi.importActual<typeof import('../../../../../../lib/kanban/file-store')>('../../../../../../lib/kanban/file-store');
    const storageDir = fixture();
    const storedCard = store.createCard('OpenCode receipt', 'Research brief', 'todo', 'medium', [], 'Demo', [], storageDir);
    const storedReceipt = {
      ...receipt!, operationId: 'a'.repeat(64), requestHash: 'b'.repeat(64),
      createInputId: 'c'.repeat(64), messageInputId: 'd'.repeat(64),
      lastBoardVersion: storedCard.version + 1,
    };
    const saved = store.updateCard(storedCard.id, { taskExecutionHistory: [storedReceipt] }, storedCard.version, storageDir);
    if (!saved || 'conflict' in saved) throw new Error('OpenCode receipt persistence failed');
    const reopened = store.readCardFile(path.join(storageDir, storedCard.fileName), storageDir);
    expect(reopened?.taskExecutionHistory?.[0]).toMatchObject({
      harness: 'opencode', projectBinding: receipt?.projectBinding,
    });
  });

  it('replays a legacy Codex receipt without consulting or launching a session', async () => {
    const card = sourceCard(journalIntentId);
    const rawOperationId = 'legacy-codex-operation';
    const operationHash = (value: string) => createHash('sha256').update(value).digest('hex');
    const operationId = operationHash(`${card.id}\0${rawOperationId}`);
    const requestHash = operationHash(JSON.stringify({
      id: card.id, title: card.title, description: card.description, project: card.project,
      owner: card.owner ?? 'nikita', assignee: card.assignee ?? null, assignees: card.assignees,
      actor: 'nikita', hostId: 'legacy-host', harness: 'codex', cwd: scopedProjectRoot, model: 'gpt-6-luna',
    }));
    mocks.currentCard.value = {
      ...card,
      taskExecutionHistory: [{
        operationId, requestHash, lastBoardVersion: card.version, createInputId: 'legacy-create',
        messageInputId: 'legacy-dispatch', phase: 'result', hostId: 'legacy-host', harness: 'codex',
        startedBy: 'nikita', createdAt: '2026-10-20T10:00:00.000Z', updatedAt: '2026-10-20T10:05:00.000Z',
      }],
    };
    mocks.findCardById.mockImplementation(() => mocks.currentCard.value);

    const response = await POST(postRequest(rawOperationId, card.version), { params: Promise.resolve({ id: 'task-1' }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ replay: true, operationId });
    expect(mocks.callOwnerHerderTool).not.toHaveBeenCalled();
  });

  it('keeps the running session alive when the intent transition is refused', async () => {
    const dir = fixture();
    writeJournal(dir, 'PENDING');
    mocks.tasksDirForScope.mockReturnValue(dir);
    mocks.currentCard.value = sourceCard(foreignIntentId);

    const response = await POST(postRequest(), { params: Promise.resolve({ id: 'task-1' }) });

    expect(response.status).toBe(201);
    const receipt = mocks.currentCard.value?.taskExecutionHistory?.at(-1);
    expect(receipt?.phase).toBe('running');
    expect(receipt?.lastProgress).toContain('intent');
    expect(mocks.callOwnerHerderTool).toHaveBeenCalledWith('send_message', expect.objectContaining({ message: expect.any(String) }));
    expect(journalRecord(dir)).toMatchObject({ intentState: 'PENDING' });
  });
  it('closes the launch intent when the create outcome is unknown and never launches a second session', async () => {
    const dir = fixture();
    writeJournal(dir, 'PENDING');
    mocks.tasksDirForScope.mockReturnValue(dir);
    const base = mocks.callOwnerHerderTool.getMockImplementation()!;
    mocks.callOwnerHerderTool.mockImplementation(async (tool: string, args: Record<string, unknown>) => {
      if (tool === 'fleet_create_session') throw new Error('mcp transport lost before the create answer arrived');
      return base(tool, args);
    });

    const response = await POST(postRequest(), { params: Promise.resolve({ id: 'task-1' }) });

    expect(response.status).toBe(202);
    const receipt = mocks.currentCard.value?.taskExecutionHistory?.at(-1);
    expect(receipt?.phase).toBe('create-unknown');
    // Nothing proves that no session was created, so the intent is spent: the same
    // work is never issued a second time.
    expect(journalRecord(dir)).toMatchObject({ intentState: 'CONSUMED', state: 'COMMITTED', intentId: journalIntentId });

    const repeat = await POST(postRequest('ui-operation-1234567891', mocks.currentCard.value!.version), {
      params: Promise.resolve({ id: 'task-1' }),
    });
    expect(repeat.status).toBe(409);
    expect(mocks.callOwnerHerderTool.mock.calls.filter(call => call[0] === 'fleet_create_session').length).toBe(1);
  });

  it('closes the launch intent when the create receipt carries no sign of a session', async () => {
    const dir = fixture();
    writeJournal(dir, 'PENDING');
    mocks.tasksDirForScope.mockReturnValue(dir);
    mocks.callOwnerHerderTool.mockImplementation(async (tool: string, args: Record<string, unknown>) => {
      if (tool === 'fleet_create_session') {
        return { structuredContent: { ok: false, inputId: args.inputId }, content: [{ type: 'text', text: 'create receipt without a session id' }] };
      }
      return toolResult(tool, args);
    });

    const response = await POST(postRequest(), { params: Promise.resolve({ id: 'task-1' }) });

    expect(response.status).toBe(202);
    const receipt = mocks.currentCard.value?.taskExecutionHistory?.at(-1);
    expect(receipt?.phase).toBe('create-unknown');
    expect(receipt?.nativeSessionId).toBeUndefined();
    // The receipt carries no sign of a session, yet it does not prove that no
    // session was created, so the intent is spent (fail-closed, like B07b).
    expect(journalRecord(dir)).toMatchObject({ intentState: 'CONSUMED', state: 'COMMITTED', intentId: journalIntentId });
  });

  it('closes the launch intent when the session exists but the readback did not match', async () => {
    const dir = fixture();
    writeJournal(dir, 'PENDING');
    mocks.tasksDirForScope.mockReturnValue(dir);
    const base = mocks.callOwnerHerderTool.getMockImplementation()!;
    mocks.callOwnerHerderTool.mockImplementation(async (tool: string, args: Record<string, unknown>) => {
      if (tool === 'fleet_session_view') {
        return { structuredContent: { hostId: 'roomhacker-server-100', details: {
          session: { id: sessionId, harness: 'codex', cwd: '/other/project/path', model: 'gpt-6-luna' },
          historyUnavailable: false, messages: [],
        } }, content: [] };
      }
      return base(tool, args);
    });

    const response = await POST(postRequest(), { params: Promise.resolve({ id: 'task-1' }) });

    expect(response.status).toBe(409);
    const receipt = mocks.currentCard.value?.taskExecutionHistory?.at(-1);
    expect(receipt?.phase).toBe('stopped');
    // The receipt proves the native session exists, so the intent is spent even
    // though the task text was never sent.
    expect(receipt?.nativeSessionId).toBe(sessionId);
    expect(journalRecord(dir)).toMatchObject({ intentState: 'CONSUMED', state: 'COMMITTED', intentId: journalIntentId });
  });

});
