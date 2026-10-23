import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const mocks = vi.hoisted(() => ({
  tasksDirForScope: vi.fn(),
  callOwnerHerderTool: vi.fn(),
}));

// The execution route accepts a browser session, an owner bearer token or a
// signed native assertion. This sheet pins what happens when the consumer is
// called without any of them: no launch, and the intent stays spendable.
vi.mock('@/lib/auth/request', () => ({
  boardIdentityFromRequest: () => ({ username: 'anonymous', scope: 'work' }),
  identityFromRequest: () => null,
  nativeProjectAccessContextFromRequest: vi.fn(async () => null),
}));
vi.mock('../../../../../../lib/auth/board-human', () => ({
  boardHumanIdentityFromRequest: vi.fn(async () => null),
}));
vi.mock('@/lib/auth/data-scope', () => ({ tasksDirForScope: mocks.tasksDirForScope }));
vi.mock('@/lib/kanban/task-execution-client', () => ({ callOwnerHerderTool: mocks.callOwnerHerderTool }));
vi.mock('@/lib/kanban/file-store', async () => await import('../../../../../../lib/kanban/file-store'));
vi.mock('@/lib/kanban/task-execution', async () => await import('../../../../../../lib/kanban/task-execution'));
vi.mock('@/lib/kanban/transition-policy', async () => await import('../../../../../../lib/kanban/transition-policy'));

import { admitSourceTask, listPendingSourceIntents, type SourceAdmissionRequest } from '../../../../../../lib/kanban/source-operation';
import { createAdmittedCard, findCardById } from '../../../../../../lib/kanban/file-store';
import { consumeNextSourceIntentLaunch } from './source-intent';

const roots: string[] = [];

function fixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-source-intent-identity-'));
  roots.push(dir);
  return dir;
}

function admissionRequest(): SourceAdmissionRequest {
  return {
    tenant: 'fixture-tenant', sourceOwner: 'fixture-owner', sourceEvent: 'event-31', primaryItem: 'primary',
    sourceRevision: 'rev-1', project: 'Demo', title: 'Research candidates', description: 'Find two SMB integrators',
    priority: 'medium', assignees: [], classification: 'explicit-task', evidenceRefs: ['fixture:event-31:span-1'],
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

describe('source intent consumer identity boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AGENT_HERDER_HTTP_TOKEN = 'test-only-protected-ref';
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('refuses to launch without an owner identity and keeps the intent spendable', async () => {
    const dir = fixture();
    mocks.tasksDirForScope.mockReturnValue(dir);
    const admitted = admit(dir);
    expect(admitted.status).toBe('committed');

    const result = await consumeNextSourceIntentLaunch({
      tasksDir: dir,
      findCard: id => findCardById(id, dir),
    });

    expect(result.status).toBe('refused');
    expect((result as { reason: string }).reason).toContain('authenticated operator required');
    expect(mocks.callOwnerHerderTool).not.toHaveBeenCalled();
    expect(findCardById(admitted.cardId, dir)!.taskExecutionHistory ?? []).toHaveLength(0);
    expect(journalRecord(dir)).toMatchObject({ intentState: 'PENDING', state: 'COMMITTED' });
    expect(listPendingSourceIntents(dir, id => findCardById(id, dir))).toHaveLength(1);
  });
});
