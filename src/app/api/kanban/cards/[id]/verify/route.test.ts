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
import { taskFacts } from '../../../../../../components/kontur/kontur-model';

const ORIGIN = 'https://board.example.test';
const AGENT_ORIGIN = 'https://todo-board.airlock.example.test';
const RELAY_URL = 'https://airlock.example.test/auth/relay';
const proof = (expectedVersion: number) => ({
  expectedVersion, confirmed: true,
  result: 'Результат синтетического сценария проверен после повторного открытия',
  evidence: 'https://example.test/fixture-verification',
});

describe('POST /api/kanban/cards/[id]/verify with real Markdown CAS', () => {
  let tasksDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-manual-verification-'));
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
    return new NextRequest(`${entrypoint}/api/kanban/cards/${id}/verify`, {
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

  it('persists proof, human actor and acceptance in one version while retaining the task and prior histories', async () => {
    const before = fixture();
    const response = await post(before);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = await response.json();
    const saved = findCardById(before.id, tasksDir)!;
    expect(body).toMatchObject({ decision: 'verified', card: { id: before.id, version: before.version + 1, column: 'done' } });
    expect(saved).toMatchObject({
      id: before.id, fileName: before.fileName, title: before.title, description: before.description,
      project: before.project, assignees: before.assignees, owner: before.owner, resultHistory: before.resultHistory,
      version: before.version + 1, column: 'done', completedBy: 'fixture-owner', nextAction: null,
    });
    expect(saved.completionEvidence?.slice(0, before.completionEvidence!.length)).toEqual(before.completionEvidence);
    expect(saved.reviewHistory?.slice(0, before.reviewHistory!.length)).toEqual(before.reviewHistory);
    const verified = saved.completionEvidence?.filter(item => item.type === 'manual_result_verification');
    expect(verified).toEqual([{
      type: 'manual_result_verification', actor: 'fixture-owner', origin: 'human-ui', checkedAt: saved.completedAt,
      result: proof(before.version).result, evidence: proof(before.version).evidence,
    }]);
    expect(saved.reviewHistory?.at(-1)).toMatchObject({ decision: 'accepted', actor: 'fixture-owner', decidedAt: saved.completedAt });
    expect(taskFacts(saved)).toMatchObject({ done: proof(before.version).result, evidence: [proof(before.version).evidence], nextStep: 'неизвестно' });
    expect(mocks.tasksDirForScope).toHaveBeenCalledWith('work');
    expect(mocks.dispatchCardEvent).toHaveBeenCalledTimes(1);
    expect(mocks.dispatchCardEvent).toHaveBeenCalledWith('work', 'moved', expect.objectContaining({ id: before.id, column: 'done' }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('lets an assigned verified human complete an ordinary card, retaining that exact actor', async () => {
    const before = fixture();
    mocks.human.mockResolvedValue({ username: 'fixture-assignee', scope: 'work' });
    const response = await post(before);
    expect(response.status).toBe(200);
    const saved = findCardById(before.id, tasksDir)!;
    expect(saved.completedBy).toBe('fixture-assignee');
    expect(saved.completionEvidence?.at(-1)?.actor).toBe('fixture-assignee');
  });

  it('requires the designated reviewer for a review card even when another human owns it', async () => {
    const before = fixture({ column: 'review', needsReview: true, requiresApprovalFrom: ['fixture-reviewer'] });
    const original = disk(before);
    expect((await post(before)).status).toBe(403);
    expect(disk(before)).toBe(original);
    mocks.human.mockResolvedValue({ username: 'fixture-reviewer', scope: 'work' });
    expect((await post(before)).status).toBe(200);
    expect(findCardById(before.id, tasksDir)).toMatchObject({ completedBy: 'fixture-reviewer', column: 'done', needsReview: false });
  });

  it('refuses an unauthenticated/service caller without looking up or changing task data', async () => {
    const before = fixture();
    const original = disk(before);
    mocks.human.mockResolvedValue(null);
    const response = await post(before, { ...proof(before.version), actor: 'fixture-owner' }, { authorization: 'Bearer fixture-service-token' });
    expect(response.status).toBe(401);
    expect(mocks.tasksDirForScope).not.toHaveBeenCalled();
    expect(disk(before)).toBe(original);
    expect(mocks.dispatchCardEvent).not.toHaveBeenCalled();
  });

  it('rejects body identity, client identity headers and foreign ownership without a write', async () => {
    const before = fixture();
    const original = disk(before);
    expect((await post(before, { ...proof(before.version), actor: 'fixture-owner' })).status).toBe(400);
    mocks.human.mockResolvedValue({ username: 'fixture-other', scope: 'work' });
    expect((await post(before, proof(before.version), { 'x-gptadmin-user': 'fixture-owner', 'x-user': 'fixture-owner' })).status).toBe(403);
    expect(disk(before)).toBe(original);
    expect(mocks.dispatchCardEvent).not.toHaveBeenCalled();
  });

  it('requires matching scope and origin before touching the canonical task', async () => {
    const before = fixture();
    const original = disk(before);
    mocks.identity.mockReturnValue({ username: 'fixture-owner', scope: 'personal' });
    expect((await post(before)).status).toBe(403);
    mocks.identity.mockReturnValue({ username: 'fixture-owner', scope: 'work' });
    expect((await post(before, proof(before.version), { origin: 'https://other.example.test' })).status).toBe(403);
    expect(mocks.tasksDirForScope).not.toHaveBeenCalled();
    expect(disk(before)).toBe(original);
  });

  it.each([ORIGIN, AGENT_ORIGIN])('accepts the exact configured browser entrypoint %s with the same human and CAS', async entrypoint => {
    enableRelay();
    const before = fixture();
    const response = await post(before, proof(before.version), {}, entrypoint);

    expect(response.status).toBe(200);
    expect(findCardById(before.id, tasksDir)).toMatchObject({
      id: before.id, version: before.version + 1, column: 'done', completedBy: 'fixture-owner',
    });
    expect(mocks.dispatchCardEvent).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects missing, opaque, malformed and foreign origins even when the relay is enabled', async () => {
    enableRelay();
    const before = fixture();
    const original = disk(before);
    const origins = [null, '', 'null', 'not-an-origin', `${ORIGIN}/`, `${AGENT_ORIGIN}/path`,
      `${ORIGIN}, ${AGENT_ORIGIN}`, 'https://other.example.test', `${AGENT_ORIGIN}.other.example.test`,
      'https://different.airlock.example.test', 'http://todo-board.airlock.example.test', `${AGENT_ORIGIN}:8443`];
    for (const origin of origins) {
      const incoming = request(before.id, proof(before.version));
      if (origin === null) incoming.headers.delete('origin');
      else incoming.headers.set('origin', origin);
      expect((await POST(incoming, { params: Promise.resolve({ id: before.id }) })).status).toBe(403);
    }

    expect(mocks.tasksDirForScope).not.toHaveBeenCalled();
    expect(mocks.dispatchCardEvent).not.toHaveBeenCalled();
    expect(disk(before)).toBe(original);
  });

  it('does not trust the configured agent origin while the relay is disabled', async () => {
    vi.stubEnv('KANBAN_AIRLOCK_AGENT_ORIGIN', AGENT_ORIGIN);
    const before = fixture();
    const original = disk(before);
    for (const relayUrl of ['', 'not-a-url', 'http://airlock.example.test/auth/relay', 'https://foreign.test/auth/relay']) {
      vi.stubEnv('KANBAN_AIRLOCK_RELAY_URL', relayUrl);
      expect((await post(before, proof(before.version), {}, AGENT_ORIGIN)).status).toBe(403);
    }
    expect(mocks.tasksDirForScope).not.toHaveBeenCalled();
    expect(disk(before)).toBe(original);
    // A disabled optional entrypoint does not disable the configured public UI.
    expect((await post(before)).status).toBe(200);
  });

  it('rejects missing and invalid agent origins, including credentials and wildcard hosts', async () => {
    const before = fixture();
    const original = disk(before);
    for (const agentOrigin of ['', 'null', 'not-a-url', 'http://todo-board.airlock.example.test',
      `${AGENT_ORIGIN}/path`, `${AGENT_ORIGIN}?query=1`, 'https://user:pass@todo-board.airlock.example.test',
      'https://*.airlock.example.test']) {
      enableRelay(agentOrigin);
      expect((await post(before, proof(before.version), {}, AGENT_ORIGIN)).status).toBe(403);
    }
    expect(mocks.tasksDirForScope).not.toHaveBeenCalled();
    expect(mocks.dispatchCardEvent).not.toHaveBeenCalled();
    expect(disk(before)).toBe(original);
  });

  it('does not derive an allowed origin from request or forwarding headers when public config is missing or invalid', async () => {
    const before = fixture();
    const original = disk(before);
    for (const configured of ['', '/', 'null', 'not-a-url', `${ORIGIN}/path`]) {
      vi.stubEnv('KANBAN_PUBLIC_ORIGIN', configured);
      expect((await post(before, proof(before.version), {
        origin: 'https://foreign.example.test', host: 'foreign.example.test',
        'x-forwarded-host': 'foreign.example.test', 'x-forwarded-proto': 'https',
      }, 'https://foreign.example.test')).status).toBe(403);
      expect((await post(before)).status).toBe(403);
    }
    expect(mocks.tasksDirForScope).not.toHaveBeenCalled();
    expect(disk(before)).toBe(original);
    enableRelay();
    expect((await post(before, proof(before.version), {}, AGENT_ORIGIN)).status).toBe(200);
  });

  it('refuses incomplete proof and incorrect media type without losing the saved goal', async () => {
    const before = fixture();
    const original = disk(before);
    expect((await post(before, { ...proof(before.version), confirmed: false })).status).toBe(400);
    expect((await post(before, { ...proof(before.version), evidence: 'неизвестно' })).status).toBe(400);
    expect((await post(before, proof(before.version), { 'content-type': 'text/plain' })).status).toBe(415);
    expect(disk(before)).toBe(original);
    expect(mocks.dispatchCardEvent).not.toHaveBeenCalled();
  });

  it('refuses an unresolved question and already closed cards without appending proof', async () => {
    const pending = fixture({ pendingQuestion: {
      id: 'fixture-question', text: 'Что требуется сделать?', choices: [], askedAt: '2026-01-01T01:00:00Z', attemptOperationId: 'a'.repeat(64),
    } });
    const pendingBytes = disk(pending);
    expect((await post(pending)).status).toBe(409);
    expect(disk(pending)).toBe(pendingBytes);
    for (const column of ['done', 'archived'] as const) {
      const closed = fixture({ column });
      const original = disk(closed);
      expect((await post(closed)).status).toBe(409);
      expect(disk(closed)).toBe(original);
    }
    expect(mocks.dispatchCardEvent).not.toHaveBeenCalled();
  });

  it('returns a real CAS conflict and preserves a concurrent writer byte-for-byte', async () => {
    const before = fixture();
    const concurrent = updateCard(before.id, { description: 'Concurrent writer kept this unfinished goal.', nextAction: 'Продолжить чужую сохранённую правку' }, before.version, tasksDir);
    if ('conflict' in concurrent) throw new Error('unexpected fixture conflict');
    const original = disk(concurrent);
    const response = await post(before);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ conflict: true, serverCard: {
      id: before.id, version: concurrent.version, description: concurrent.description, nextAction: concurrent.nextAction,
    } });
    expect(disk(concurrent)).toBe(original);
    expect(findCardById(before.id, tasksDir)).toEqual(concurrent);
    expect(mocks.dispatchCardEvent).not.toHaveBeenCalled();
  });

  it('does not duplicate verification or acceptance on concurrent clicks and later retries', async () => {
    const before = fixture();
    const responses = await Promise.all([post(before), post(before)]);
    expect(responses.map(value => value.status).sort()).toEqual([200, 409]);
    const saved = findCardById(before.id, tasksDir)!;
    const original = disk(saved);
    expect(saved.version).toBe(before.version + 1);
    expect(saved.completionEvidence?.filter(item => item.type === 'manual_result_verification')).toHaveLength(1);
    expect(saved.reviewHistory?.filter(item => item.decision === 'accepted')).toHaveLength(1);
    expect((await post(saved)).status).toBe(409);
    expect(disk(saved)).toBe(original);
    expect(mocks.dispatchCardEvent).toHaveBeenCalledTimes(1);
  });

  it('keeps a successfully saved verification successful when optional notifications fail', async () => {
    const before = fixture();
    mocks.dispatchCardEvent.mockRejectedValueOnce(new Error('synthetic notification outage'));
    expect((await post(before)).status).toBe(200);
    expect(findCardById(before.id, tasksDir)?.column).toBe('done');
  });
});
