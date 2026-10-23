import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    projectRoute: { harness: 'codex', model: 'gpt-6-luna', state: 'ready' },
    projectReadiness: {
      state: 'ready', projectId: project, projectRoot: scopedProjectRoot,
      rootIdentity: 'exmanager-workspace-root-v1', policyRevision: 'scope-policy-7',
      observedAtMs: Date.now(), runtimeInstanceId: 'herder-runtime-12', hostId: 'roomhacker-server-100',
      harness: 'codex', harnessVersion: 'codex-test-1', model: 'gpt-6-luna',
      requiredTools: ['web_search'], availableTools: ['web_search', 'shell_exec'],
      availableModels: ['gpt-6-luna'], resourceReady: true, cwd: scopedProjectRoot, pathResolution,
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
      ok: true, created: true, inputId: args.inputId, harness: 'codex', sessionId, cwd: args.cwd,
      ...(projectExecution ? { projectReadinessContract: args.projectReadinessContract, projectExecution } : {}),
    }, content: [] };
  }
  if (tool === 'fleet_session_view') {
    const receiptCwd = mocks.currentCard.value?.taskExecutionHistory?.at(-1)?.projectBinding?.cwd ?? scopedProjectRoot;
    return { structuredContent: {
      hostId: 'roomhacker-server-100', details: {
        session: { id: sessionId, harness: 'codex', cwd: receiptCwd, model: 'gpt-6-luna' },
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
    const journalBefore = fs.readFileSync(file, 'utf8');
    const toolCallsBefore = mocks.callOwnerHerderTool.mock.calls.length;

    const replay = await POST(postRequest(), { params: Promise.resolve({ id: 'task-1' }) });

    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ replay: true });
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
});
