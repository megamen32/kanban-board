import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const mocks = vi.hoisted(() => ({
  tasksDirForScope: vi.fn(),
  identity: { value: { username: 'nikita', scope: 'work' as const } as { username: string; scope: 'work' } | null },
  humanIdentity: { value: undefined as { username: string; scope: 'work' } | null | undefined },
  boardHumanIdentityFromRequest: vi.fn(),
  callOwnerHerderTool: vi.fn(),
}));

vi.mock('@/lib/auth/request', () => ({
  boardIdentityFromRequest: () => mocks.identity.value ?? { username: 'anonymous', scope: 'work' },
  identityFromRequest: () => mocks.identity.value,
  nativeProjectAccessContextFromRequest: vi.fn(async () => null),
}));
vi.mock('../../../../../../lib/auth/board-human', () => ({
  boardHumanIdentityFromRequest: mocks.boardHumanIdentityFromRequest,
}));
vi.mock('@/lib/auth/data-scope', () => ({ tasksDirForScope: mocks.tasksDirForScope }));
vi.mock('@/lib/kanban/task-execution-client', () => ({ callOwnerHerderTool: mocks.callOwnerHerderTool }));
// The runner resolves no `@/` alias, so the route keeps its own alias specifiers
// and receives the real Board modules through these bridges.
vi.mock('@/lib/kanban/file-store', async () => await import('../../../../../../lib/kanban/file-store'));
vi.mock('@/lib/kanban/task-execution', async () => await import('../../../../../../lib/kanban/task-execution'));
vi.mock('@/lib/kanban/transition-policy', async () => await import('../../../../../../lib/kanban/transition-policy'));

// The real journal, the real card store and the real execution route are used on
// purpose: this sheet proves that one pending intent produces exactly one launch
// with a stored receipt, not a mocked transition.
import { admitSourceTask, type SourceAdmissionRequest } from '../../../../../../lib/kanban/source-operation';
import { createAdmittedCard, findCardById } from '../../../../../../lib/kanban/file-store';
import { consumeNextSourceIntentLaunch, launchSourceIntentThroughExecutionRoute, sourceIntentOperationId } from './source-intent';

const sessionId = 'native-session-1';
const scopedProjectRoot = '/workspace/exmanager-task-workspace';
const roots: string[] = [];

function fixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-source-intent-'));
  roots.push(dir);
  return dir;
}

function admissionRequest(): SourceAdmissionRequest {
  return {
    tenant: 'fixture-tenant', sourceOwner: 'fixture-owner', sourceEvent: 'event-17', primaryItem: 'primary',
    sourceRevision: 'rev-1', project: 'Demo', title: 'Research candidates', description: 'Find two SMB integrators',
    priority: 'medium', assignees: [], classification: 'explicit-task', evidenceRefs: ['fixture:event-17:span-1'],
  };
}

function admit(dir: string) {
  return admitSourceTask(admissionRequest(), dir, id => findCardById(id, dir), card => createAdmittedCard(card, dir));
}

function journalRecord(dir: string): Record<string, unknown> {
  const file = path.join(dir, '.source-operations', 'source-operations.json');
  const journal = JSON.parse(fs.readFileSync(file, 'utf8')) as { operations: Record<string, Record<string, unknown>> };
  return Object.values(journal.operations)[0]!;
}

function scopedReadiness(project = 'Demo') {
  const pathResolution = {
    requestedCwd: scopedProjectRoot, canonicalCwd: scopedProjectRoot, rootPath: scopedProjectRoot,
    contained: true, identityMatches: true,
  };
  return {
    hostId: 'roomhacker-server-100', nativeUser: 'operator',
    projectReadinessContract: 'integrator-host-readiness-v1',
    projectRoute: { state: 'ready', harness: 'codex', model: 'gpt-6-luna' },
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
      hostId: readiness.hostId, harness: 'codex', model: 'gpt-6-luna',
      requiredTools, address: { hostId: readiness.hostId, harness: 'codex', nativeSessionId: sessionId },
      launchCwd: readiness.cwd,
    } : undefined;
    return { structuredContent: {
      ok: true, created: true, inputId: args.inputId, harness: 'codex', sessionId, cwd: args.cwd,
      ...(projectExecution ? { projectReadinessContract: args.projectReadinessContract, projectExecution } : {}),
    }, content: [] };
  }
  if (tool === 'fleet_session_view') {
    return { structuredContent: {
      hostId: 'roomhacker-server-100', details: {
        session: { id: sessionId, harness: 'codex', cwd: scopedProjectRoot, model: 'gpt-6-luna' },
        historyUnavailable: false, messages: [{ role: 'assistant', text: 'Found two candidates' }],
      },
    }, content: [] };
  }
  if (tool === 'send_message') {
    return { content: [{ type: 'text', text: `Native admission receipt: ${JSON.stringify({ admitted: true, inputId: args.inputId, turnId: 'turn-1' })}` }] };
  }
  throw new Error(`unexpected tool ${tool}`);
}

function creates(): number {
  return mocks.callOwnerHerderTool.mock.calls.filter(call => call[0] === 'fleet_create_session').length;
}

describe('the one source-intent consumer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.humanIdentity.value = undefined;
    mocks.boardHumanIdentityFromRequest.mockImplementation(async () =>
      mocks.humanIdentity.value === undefined ? mocks.identity.value : mocks.humanIdentity.value);
    mocks.identity.value = { username: 'nikita', scope: 'work' };
    mocks.callOwnerHerderTool.mockImplementation(toolResult);
    process.env.EXMANAGER_TASK_EXECUTION_CWD = scopedProjectRoot;
    process.env.AGENT_HERDER_HTTP_TOKEN = 'test-only-protected-ref';
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reads one pending intent, launches that card once and stores the receipt', async () => {
    const dir = fixture();
    const admitted = admit(dir);
    expect(admitted.status).toBe('committed');
    mocks.tasksDirForScope.mockReturnValue(dir);
    const operationKey = String(journalRecord(dir).operationKey);

    const result = await consumeNextSourceIntentLaunch({ tasksDir: dir, findCard: id => findCardById(id, dir) });

    expect(result.status).toBe('launched');
    if (result.status !== 'launched') throw new Error(`expected a launch, got ${result.status}`);
    expect(result.operationKey).toBe(operationKey);
    expect(result.intentId).toBe(admitted.intentId);
    const card = findCardById(admitted.cardId, dir)!;
    expect(card.taskExecutionHistory).toHaveLength(1);
    expect(card.taskExecutionHistory![0]).toMatchObject({
      phase: 'running',
      operationId: sourceIntentOperationId(admitted.cardId, operationKey),
    });
    expect(result.receipt?.phase).toBe('running');
    expect(journalRecord(dir)).toMatchObject({ intentState: 'CONSUMED', state: 'COMMITTED' });
    expect(creates()).toBe(1);
  });

  it('spends the intent once: a repeated consumption starts no second launch', async () => {
    const dir = fixture();
    const admitted = admit(dir);
    mocks.tasksDirForScope.mockReturnValue(dir);

    const first = await consumeNextSourceIntentLaunch({ tasksDir: dir, findCard: id => findCardById(id, dir) });
    expect(first.status).toBe('launched');
    expect(creates()).toBe(1);

    const second = await consumeNextSourceIntentLaunch({ tasksDir: dir, findCard: id => findCardById(id, dir) });

    expect(second.status).toBe('idle');
    expect(creates()).toBe(1);
    expect(findCardById(admitted.cardId, dir)!.taskExecutionHistory).toHaveLength(1);
  });

  it('reuses the stored receipt when the same operation is issued again', async () => {
    const dir = fixture();
    const admitted = admit(dir);
    mocks.tasksDirForScope.mockReturnValue(dir);
    const operationKey = String(journalRecord(dir).operationKey);

    const first = await consumeNextSourceIntentLaunch({ tasksDir: dir, findCard: id => findCardById(id, dir) });
    expect(first.status).toBe('launched');
    const card = findCardById(admitted.cardId, dir)!;

    const replay = await launchSourceIntentThroughExecutionRoute({
      cardId: admitted.cardId, operationKey, intentId: String(admitted.intentId),
      operationId: sourceIntentOperationId(admitted.cardId, operationKey),
      expectedVersion: card.version, card,
    }, {}, id => findCardById(id, dir));

    expect(replay.status).toBe('replayed');
    if (replay.status !== 'replayed') throw new Error(`expected a replay, got ${replay.status}`);
    expect(replay.receipt?.phase).toBe('running');
    expect(creates()).toBe(1);
    expect(findCardById(admitted.cardId, dir)!.taskExecutionHistory).toHaveLength(1);
  });

  it('never starts a second launch when the dispatch outcome stays unknown', async () => {
    const dir = fixture();
    const admitted = admit(dir);
    mocks.tasksDirForScope.mockReturnValue(dir);
    const base = mocks.callOwnerHerderTool.getMockImplementation()!;
    mocks.callOwnerHerderTool.mockImplementation(async (tool: string, args: Record<string, unknown>) => {
      if (tool === 'send_message') throw new Error('mcp transport lost after the session was created');
      return base(tool, args);
    });

    const result = await consumeNextSourceIntentLaunch({ tasksDir: dir, findCard: id => findCardById(id, dir) });

    expect(result.status).toBe('unknown');
    expect(journalRecord(dir)).toMatchObject({ intentState: 'CONSUMED', state: 'COMMITTED' });
    expect(creates()).toBe(1);

    const repeat = await consumeNextSourceIntentLaunch({ tasksDir: dir, findCard: id => findCardById(id, dir) });

    expect(repeat.status).toBe('idle');
    expect(creates()).toBe(1);
  });
});
