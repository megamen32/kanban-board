import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const mocks = vi.hoisted(() => ({
  tasksDirForScope: vi.fn(),
  nativeContext: { value: undefined as unknown },
  nativeError: { value: undefined as unknown },
  callOwnerHerderTool: vi.fn(),
  nativeIdentity: {
    boardIdentityFromRequest: () => ({ username: 'nikita', scope: 'work' }),
    identityFromRequest: () => ({ username: 'nikita', scope: 'work' }),
    nativeProjectAccessContextFromRequest: vi.fn(async (): Promise<unknown> => null),
  },
}));

vi.mock('@/lib/auth/request', () => mocks.nativeIdentity);
vi.mock('../../../../../lib/auth/request', () => mocks.nativeIdentity);
vi.mock('../../../../../lib/auth/board-human', () => ({ boardHumanIdentityFromRequest: vi.fn(async () => null) }));
vi.mock('@/lib/kanban/board-human', () => ({ boardHumanIdentityFromRequest: vi.fn(async () => null) }));
vi.mock('@/lib/auth/data-scope', () => ({ tasksDirForScope: mocks.tasksDirForScope }));
vi.mock('../../../../../lib/auth/data-scope', () => ({ tasksDirForScope: mocks.tasksDirForScope }));
vi.mock('@/lib/kanban/task-execution-client', () => ({ callOwnerHerderTool: mocks.callOwnerHerderTool }));
vi.mock('@/lib/kanban/file-store', async () => await import('../../../../../lib/kanban/file-store'));
vi.mock('@/lib/kanban/task-execution', async () => await import('../../../../../lib/kanban/task-execution'));
vi.mock('@/lib/kanban/transition-policy', async () => await import('../../../../../lib/kanban/transition-policy'));

import { admitSourceTask, type SourceAdmissionRequest } from '../../../../../lib/kanban/source-operation';
import { createAdmittedCard, findCardById } from '../../../../../lib/kanban/file-store';
import { POST } from './route';

const sessionId = 'native-session-1';
const scopedProjectRoot = '/workspace/exmanager-task-workspace';
const roots: string[] = [];

function fixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-source-intent-entry-'));
  roots.push(dir);
  return dir;
}

function admissionRequest(): SourceAdmissionRequest {
  return {
    tenant: 'fixture-tenant', sourceOwner: 'fixture-owner', sourceEvent: 'event-41', primaryItem: 'primary',
    sourceRevision: 'rev-1', project: 'Demo', title: 'Research candidates', description: 'Find two SMB integrators',
    priority: 'medium', assignees: [], classification: 'explicit-task', evidenceRefs: ['fixture:event-41:span-1'],
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

function nativeContext() {
  return {
    userId: 'exmanager-service',
    forProject: async (project: string) => ({ project, team: 'team-demo', readAllowed: true as const, writeAllowed: true }),
  };
}

describe('the native source-intent dispatch entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.nativeContext.value = undefined;
    mocks.nativeError.value = undefined;
    mocks.nativeIdentity.nativeProjectAccessContextFromRequest.mockImplementation(async () => {
      if (mocks.nativeError.value) throw mocks.nativeError.value;
      return mocks.nativeContext.value ?? null;
    });
    mocks.callOwnerHerderTool.mockImplementation(toolResult);
    process.env.EXMANAGER_TASK_EXECUTION_CWD = scopedProjectRoot;
    process.env.AGENT_HERDER_HTTP_TOKEN = 'test-only-protected-ref';
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('launches exactly one pending intent for a verified native caller', async () => {
    const dir = fixture();
    const admitted = admit(dir);
    expect(admitted.status).toBe('committed');
    mocks.tasksDirForScope.mockReturnValue(dir);
    mocks.nativeContext.value = nativeContext();

    const response = await POST(new Request('https://board.local/api/kanban/source-intent/execution', { method: 'POST' }) as never);

    expect(response.status).toBe(200);
    const payload = await response.json() as { status: string; intentId?: string };
    expect(payload.status).toBe('launched');
    expect(payload.intentId).toBe(admitted.intentId);
    expect(creates()).toBe(1);
    expect(journalRecord(dir)).toMatchObject({ intentState: 'CONSUMED', state: 'COMMITTED' });
    const card = findCardById(admitted.cardId, dir)!;
    expect(card.taskExecutionHistory).toHaveLength(1);
  });

  it('launches nothing without a verified native identity and keeps the intent spendable', async () => {
    const dir = fixture();
    admit(dir);
    mocks.tasksDirForScope.mockReturnValue(dir);
    mocks.nativeContext.value = null;

    const response = await POST(new Request('https://board.local/api/kanban/source-intent/execution', { method: 'POST' }) as never);

    expect(response.status).toBe(401);
    expect(creates()).toBe(0);
    expect(journalRecord(dir)).toMatchObject({ intentState: 'PENDING', state: 'COMMITTED' });
  });

  it('refuses a native identity that could not be verified', async () => {
    const dir = fixture();
    admit(dir);
    mocks.tasksDirForScope.mockReturnValue(dir);
    mocks.nativeError.value = new Error('native_identity_invalid');

    const response = await POST(new Request('https://board.local/api/kanban/source-intent/execution', { method: 'POST' }) as never);

    expect(response.status).toBe(403);
    expect(creates()).toBe(0);
    expect(journalRecord(dir)).toMatchObject({ intentState: 'PENDING', state: 'COMMITTED' });
  });
});
