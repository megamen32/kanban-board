import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const mocks = vi.hoisted(() => ({ callOwnerHerderTool: vi.fn() }));

// The runner resolves no `@/` alias, so the execution route keeps its own alias
// specifiers and receives the real Board modules through these bridges. The
// identity module is bridged to the REAL one on purpose: the server-side
// access token must be validated by the same code that accepts a browser
// session, not by a mocked identity.
vi.mock('@/lib/auth/request', async () => await import('../auth/request'));
vi.mock('@/lib/auth/data-scope', async () => await import('../auth/data-scope'));
vi.mock('@/lib/kanban/file-store', async () => await import('./file-store'));
vi.mock('@/lib/kanban/task-execution', async () => await import('./task-execution'));
vi.mock('@/lib/kanban/transition-policy', async () => await import('./transition-policy'));
vi.mock('@/lib/kanban/task-execution-client', () => ({ callOwnerHerderTool: mocks.callOwnerHerderTool }));
// The shared browser login is a cookie of a human; the server tick has none.
vi.mock('../auth/board-human', () => ({ boardHumanIdentityFromRequest: vi.fn(async () => null) }));

import { AuthStore } from '../auth/store';
import { admitSourceTask, listPendingSourceIntents, type SourceAdmissionRequest } from './source-operation';
import { createAdmittedCard, createCard, findCardById } from './file-store';
import { consumeSourceIntentLaunchOnce } from './source-launch';
import {
  launchSourceIntentThroughExecutionRoute,
  sourceIntentOperationId,
} from '../../app/api/kanban/cards/[id]/execution/source-intent';

const sessionId = 'native-session-1';
const scopedProjectRoot = '/workspace/exmanager-task-workspace';
const roots: string[] = [];

function fixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-source-launch-'));
  roots.push(dir);
  return dir;
}

function admissionRequest(): SourceAdmissionRequest {
  return {
    tenant: 'fixture-tenant', sourceOwner: 'fixture-owner', sourceEvent: 'event-77', primaryItem: 'primary',
    sourceRevision: 'rev-1', project: 'Demo', title: 'Research candidates', description: 'Find two SMB integrators',
    priority: 'medium', assignees: [], classification: 'explicit-task', evidenceRefs: ['fixture:event-77:span-1'],
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

/** The dedicated owner access token of the launch path, minted by the real store. */
function ownerAccessToken(authDir: string): string {
  const store = new AuthStore({ rootDir: authDir });
  const clientId = 'chatgpt-kanban';
  const redirectUri = 'https://board.local/callback';
  const code = store.createAuthorizationCode('nikita', clientId, redirectUri, 'kanban:work');
  const issued = store.exchangeAuthorizationCode(code, clientId, redirectUri);
  if (!issued) throw new Error('the launch access token was not issued');
  expect(issued.scope).toBe('work');
  return issued.accessToken;
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

describe('the server-side source-intent launch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.callOwnerHerderTool.mockImplementation(toolResult);
    process.env.EXMANAGER_TASK_EXECUTION_CWD = scopedProjectRoot;
    process.env.AGENT_HERDER_HTTP_TOKEN = 'test-only-protected-ref';
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.KANBAN_SOURCE_LAUNCH_ACCESS_TOKEN;
    delete process.env.KANBAN_AUTH_DIR;
    delete process.env.TASKS_DIR;
    for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('launches one pending intent with the dedicated owner access token', async () => {
    const dir = fixture();
    const authDir = fixture();
    process.env.TASKS_DIR = dir;
    process.env.KANBAN_AUTH_DIR = authDir;
    process.env.KANBAN_SOURCE_LAUNCH_ACCESS_TOKEN = ownerAccessToken(authDir);
    const admitted = admit(dir);
    expect(admitted.status).toBe('committed');

    const result = await consumeSourceIntentLaunchOnce('work', { tasksDir: dir });

    expect(result.status).toBe('launched');
    expect(result.cardId).toBe(admitted.cardId);
    expect(creates()).toBe(1);
    const card = findCardById(admitted.cardId, dir)!;
    expect(card.taskExecutionHistory).toHaveLength(1);
    expect(card.taskExecutionHistory![0]).toMatchObject({
      phase: 'running',
      operationId: sourceIntentOperationId(admitted.cardId, String(journalRecord(dir).operationKey)),
    });
    expect(journalRecord(dir)).toMatchObject({ intentState: 'CONSUMED', state: 'COMMITTED' });
  });

  it('refuses without an authorized identity and keeps the intent spendable', async () => {
    const dir = fixture();
    const authDir = fixture();
    process.env.TASKS_DIR = dir;
    process.env.KANBAN_AUTH_DIR = authDir;
    const admitted = admit(dir);
    expect(admitted.status).toBe('committed');

    const unconfigured = await consumeSourceIntentLaunchOnce('work', { tasksDir: dir });
    expect(unconfigured.status).toBe('refused');
    expect(unconfigured.reason).toContain('access token is not configured');

    process.env.KANBAN_SOURCE_LAUNCH_ACCESS_TOKEN = 'not-a-real-access-token';
    const unauthorized = await consumeSourceIntentLaunchOnce('work', { tasksDir: dir });

    expect(unauthorized.status).toBe('refused');
    expect(unauthorized.reason).toContain('authenticated operator required');
    expect(creates()).toBe(0);
    expect(findCardById(admitted.cardId, dir)!.taskExecutionHistory ?? []).toHaveLength(0);
    expect(journalRecord(dir)).toMatchObject({ intentState: 'PENDING', state: 'COMMITTED' });
    expect(listPendingSourceIntents(dir, id => findCardById(id, dir))).toHaveLength(1);
  });

  it('refuses a card that never passed source admission', async () => {
    const dir = fixture();
    const authDir = fixture();
    process.env.TASKS_DIR = dir;
    process.env.KANBAN_AUTH_DIR = authDir;
    process.env.KANBAN_SOURCE_LAUNCH_ACCESS_TOKEN = ownerAccessToken(authDir);
    const admitted = admit(dir);
    expect(admitted.status).toBe('committed');
    const foreign = createCard('Foreign card', 'Not source-admitted', 'inbox', 'medium', ['manual'], 'Demo', [], dir);

    const result = await consumeSourceIntentLaunchOnce('work', { tasksDir: dir, cardId: foreign.id });

    expect(result.status).toBe('refused');
    expect(result.reason).toContain('no pending source intent');
    expect(creates()).toBe(0);
    expect(findCardById(foreign.id, dir)!.taskExecutionHistory ?? []).toHaveLength(0);
    expect(findCardById(admitted.cardId, dir)!.taskExecutionHistory ?? []).toHaveLength(0);
    expect(journalRecord(dir)).toMatchObject({ intentState: 'PENDING', state: 'COMMITTED' });
  });

  it('reuses the stored receipt and never starts a second launch', async () => {
    const dir = fixture();
    const authDir = fixture();
    process.env.TASKS_DIR = dir;
    process.env.KANBAN_AUTH_DIR = authDir;
    const accessToken = ownerAccessToken(authDir);
    process.env.KANBAN_SOURCE_LAUNCH_ACCESS_TOKEN = accessToken;
    const admitted = admit(dir);
    expect(admitted.status).toBe('committed');
    const operationKey = String(journalRecord(dir).operationKey);

    const first = await consumeSourceIntentLaunchOnce('work', { tasksDir: dir });
    expect(first.status).toBe('launched');
    expect(creates()).toBe(1);

    const second = await consumeSourceIntentLaunchOnce('work', { tasksDir: dir });
    expect(second.status).toBe('idle');
    expect(creates()).toBe(1);

    const card = findCardById(admitted.cardId, dir)!;
    const replay = await launchSourceIntentThroughExecutionRoute({
      cardId: admitted.cardId, operationKey, intentId: String(admitted.intentId),
      operationId: sourceIntentOperationId(admitted.cardId, operationKey),
      expectedVersion: card.version, card,
    }, { authorization: `Bearer ${accessToken}` }, id => findCardById(id, dir));

    expect(replay.status).toBe('replayed');
    if (replay.status !== 'replayed') throw new Error(`expected a replay, got ${replay.status}`);
    expect(replay.receipt?.phase).toBe('running');
    expect(creates()).toBe(1);
    expect(findCardById(admitted.cardId, dir)!.taskExecutionHistory).toHaveLength(1);
  });
});
