import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KanbanCard, KanbanCardUpdates } from '../../../../../../lib/kanban/types';

const mocks = vi.hoisted(() => ({
  human: vi.fn(), identity: vi.fn(), tasksDirForScope: vi.fn(), dispatchCardEvent: vi.fn(),
}));
vi.mock('@/lib/auth/board-human', () => ({ boardHumanIdentityFromRequest: mocks.human }));
vi.mock('@/lib/auth/request', () => ({ boardIdentityFromRequest: mocks.identity }));
vi.mock('@/lib/auth/data-scope', () => ({ tasksDirForScope: mocks.tasksDirForScope }));
vi.mock('@/lib/notifications/push', () => ({ dispatchCardEvent: mocks.dispatchCardEvent }));

import { POST } from './route';
import { createCard, findCardById, updateCard } from '../../../../../../lib/kanban/file-store';


const ORIGIN = 'https://board.example.test';
const AGENT_ORIGIN = 'https://todo-board.airlock.example.test';
const RELAY_URL = 'https://airlock.example.test/auth/relay';
const proof = (expectedVersion: number) => ({expectedVersion});

describe('POST /api/kanban/cards/[id]/close with real Markdown CAS', () => {
  let tasksDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-owner-close-'));
    mocks.tasksDirForScope.mockReturnValue(tasksDir);
    mocks.identity.mockReturnValue({ username: 'not-the-human-actor', scope: 'work' });
    mocks.human.mockResolvedValue({ username: 'fixture-owner', scope: 'work' });
    mocks.dispatchCardEvent.mockResolvedValue({ skipped: true });
    vi.stubEnv('KANBAN_PUBLIC_ORIGIN', ORIGIN);
    vi.stubEnv('KANBAN_AIRLOCK_RELAY_URL', '');
    vi.stubEnv('KANBAN_AIRLOCK_AGENT_ORIGIN', '');
    vi.stubEnv('KANBAN_AIRLOCK_RELAY_DOMAIN', 'example.test');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network access is forbidden in this fixture'); }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    fs.rmSync(tasksDir, { recursive: true, force: true });
  });

  function request(id: string, body: unknown, headers: Record<string, string> = {}, entrypoint = ORIGIN) {
    return new NextRequest(`${entrypoint}/api/kanban/cards/${id}/close`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: entrypoint, ...headers },
      body: JSON.stringify(body),
    });
  }

  function post(value: KanbanCard, body: unknown = proof(value.version), headers: Record<string, string> = {}, entrypoint = ORIGIN) {
    return POST(request(value.id, body, headers, entrypoint), { params: Promise.resolve({ id: value.id }) });
  }

  function enableRelay(agentOrigin = AGENT_ORIGIN) {
    vi.stubEnv('KANBAN_AIRLOCK_RELAY_URL', RELAY_URL);
    vi.stubEnv('KANBAN_AIRLOCK_AGENT_ORIGIN', agentOrigin);
  }

  function fixture(overrides: KanbanCardUpdates = {}): KanbanCard {
    const created = createCard('Synthetic verification fixture', 'Original unfinished goal is preserved.', 'todo', 'medium',
      ['fixture'], 'Kontur fixture project', ['fixture-assignee'], tasksDir);
    const saved = updateCard(created.id, {
      owner: 'fixture-owner', requiresApprovalFrom: [], nextAction: 'Старый следующий шаг',
      resultHistory: [{ summary: 'Исходный отчёт исполнителя', evidenceRefs: ['fixture:previous-result'],
        submittedAt: '2026-01-01T01:00:00Z', submittedBy: 'fixture-executor', runRef: 'fixture:existing-run' }],
      reviewHistory: [{ decision: 'rework', actor: 'fixture-reviewer', decidedAt: '2026-01-01T02:00:00Z', note: 'Историческое замечание' }],
      completionEvidence: [{ type: 'fixture-historical-proof', reference: 'fixture:old-proof' }],
      ...overrides,
    }, created.version, tasksDir);
    if ('conflict' in saved) throw new Error('unexpected fixture conflict');
    return saved;
  }

  function disk(value: KanbanCard): string {
    return fs.readFileSync(path.join(tasksDir, value.fileName), 'utf8');
  }


  it('owner closes without proof even when awaiting another reviewer or a question', async () => {
    const before = fixture({column: 'review', needsReview: true, requiresApprovalFrom: ['other-reviewer'],
      pendingQuestion: {id: 'fixture-q', text: 'Pending question', choices: [], attemptOperationId: 'fixture-operation', askedAt: '2026-01-01T00:00:00Z'} as KanbanCard['pendingQuestion']});
    const response = await post(before);
    expect(response.status).toBe(200);
    const saved = findCardById(before.id, tasksDir)!;
    expect(saved).toMatchObject({column: 'done', needsReview: false, completedBy: 'fixture-owner', version: before.version + 1});
    expect(saved.resultHistory).toEqual(before.resultHistory);
    expect(saved.reviewHistory).toEqual(before.reviewHistory);
    expect(saved.requiresApprovalFrom).toEqual(before.requiresApprovalFrom);
    expect(saved.pendingQuestion).toEqual(before.pendingQuestion);
    expect(saved.completionEvidence?.at(-1)).toMatchObject({type: 'owner_closed_without_verification', actor: 'fixture-owner', origin: 'human-ui'});
    expect(saved.completionEvidence?.slice(0, -1)).toEqual(before.completionEvidence);
    expect(saved.completionEvidence?.at(-1)).not.toHaveProperty('evidence');
    expect(mocks.dispatchCardEvent).toHaveBeenCalledTimes(1);
  });

  it('does not allow the assignee or reviewer to impersonate the owner', async () => {
    const before = fixture();
    for (const username of ['fixture-assignee', 'fixture-reviewer', 'stranger']) {
      mocks.human.mockResolvedValue({username, scope: 'work'});
      expect((await post(before)).status).toBe(403);
      expect(findCardById(before.id, tasksDir)?.version).toBe(before.version);
    }
  });

  it('rejects service/no human identity and cross-scope attempts', async () => {
    const before = fixture();
    mocks.human.mockResolvedValue(null);
    expect((await post(before)).status).toBe(401);
    mocks.human.mockResolvedValue({username: 'fixture-owner', scope: 'personal'});
    expect((await post(before)).status).toBe(403);
    expect(findCardById(before.id, tasksDir)?.version).toBe(before.version);
  });

  it('requires a configured same origin including a verified Airlock relay', async () => {
    const before = fixture();
    for (const origin of ['', 'https://evil.example.test', 'null']) {
      expect((await post(before, proof(before.version), {origin})).status).toBe(403);
    }
    enableRelay();
    expect((await post(before, proof(before.version), {}, AGENT_ORIGIN)).status).toBe(200);
  });

  it('rejects missing versions, completion flags and injected audit metadata', async () => {
    const before = fixture();
    for (const body of [{}, {expectedVersion: 0}, {expectedVersion: 1.5},
      {expectedVersion: before.version, completedBy: 'fixture-owner'},
      {expectedVersion: before.version, ownerCommandConfirmed: true},
      {expectedVersion: before.version, completionEvidence: []}]) {
      expect((await post(before, body)).status).toBe(400);
    }
    expect(findCardById(before.id, tasksDir)?.version).toBe(before.version);
  });

  it('rejects a future CAS version before producing an owner-authorized patch', async () => {
    const before = fixture();
    expect((await post(before, {expectedVersion: before.version + 1})).status).toBe(409);
    expect(findCardById(before.id, tasksDir)?.version).toBe(before.version);
    expect(mocks.dispatchCardEvent).not.toHaveBeenCalled();
  });

  it('preserves a concurrent edit and requires reopening after a stale request', async () => {
    const before = fixture();
    const changed = updateCard(before.id, {description: 'Concurrent edit'}, before.version, tasksDir);
    expect(changed).not.toHaveProperty('conflict');
    expect((await post(before)).status).toBe(409);
    expect(findCardById(before.id, tasksDir)).toMatchObject({description: 'Concurrent edit', column: 'todo'});
    expect(mocks.dispatchCardEvent).not.toHaveBeenCalled();
  });

  it('does not append audit twice on repeated clicks and does not unarchive', async () => {
    const before = fixture();
    expect((await post(before)).status).toBe(200);
    expect((await post(before)).status).toBe(409);
    expect(findCardById(before.id, tasksDir)?.completionEvidence?.filter(x => x.type === 'owner_closed_without_verification')).toHaveLength(1);
    const archived = fixture({column: 'archived'});
    expect((await post(archived)).status).toBe(409);
  });
});
