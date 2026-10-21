import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ tasksDirForScope: vi.fn(), dispatchCardEvent: vi.fn() }));
vi.mock('@/lib/auth/request', async () => import('../../../../../../lib/auth/request'));
vi.mock('@/lib/auth/data-scope', () => ({ tasksDirForScope: mocks.tasksDirForScope }));
vi.mock('@/lib/notifications/push', () => ({ dispatchCardEvent: mocks.dispatchCardEvent }));
vi.mock('@/lib/auth/board-human', async () => import('../../../../../../lib/auth/board-human'));
vi.mock('@/lib/kanban/file-store', async () => import('../../../../../../lib/kanban/file-store'));

import { POST } from './route';
import { createCard, findCardById, updateCard } from '../../../../../../lib/kanban/file-store';

describe('owner result-correction route', () => {
  let tasksDir: string;
  const authFetch = vi.fn();

  beforeEach(() => {
    tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-result-correction-'));
    mocks.tasksDirForScope.mockReturnValue(tasksDir);
    mocks.dispatchCardEvent.mockResolvedValue({ skipped: true });
    authFetch.mockReset().mockResolvedValue(new Response(null, { status: 204, headers: { 'X-GPTAdmin-User': 'roomhacker' } }));
    vi.stubGlobal('fetch', authFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(tasksDir, { recursive: true, force: true });
  });

  function request(id: string, body: unknown) {
    return new NextRequest(`https://todo.bezrabotnyi.com/api/kanban/cards/${id}/result-correction`, {
      method: 'POST', headers: { cookie: 'gptadmin_auth=verified-existing-session', 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
  }

  function waitingCard() {
    const created = createCard('Research result', '', 'review', 'medium', [], 'Oleg and Nikita', ['executor'], tasksDir);
    const saved = updateCard(created.id, { owner: 'nikita', needsReview: true, requiresApprovalFrom: ['nikita'], resultHistory: [
      { summary: 'Old shortlist', evidenceRefs: ['https://old.example'], submittedBy: 'native-executor', submittedAt: '2026-10-20T10:00:00.000Z', runRef: 'native-turn:existing' },
    ], reviewHistory: [{ decision: 'rework', actor: 'nikita', decidedAt: '2026-10-20T11:00:00.000Z', note: 'Update evidence.' }] }, created.version, tasksDir);
    if ('conflict' in saved) throw new Error('fixture conflict');
    return saved;
  }

  const body = (expectedVersion: number) => ({ expectedVersion, summary: 'Lead4Sell and АМОПАРТНЕР; previous Freshcube result retained in history.',
    evidenceRefs: ['https://lead4sell.ru/', 'https://www.amopartner.ru/'], nextAction: 'Human review; no outreach.' });

  it('appends current owner correction by CAS, preserves history and does not mark it as a native turn', async () => {
    const before = waitingCard();
    const response = await POST(request(before.id, body(before.version)), { params: Promise.resolve({ id: before.id }) });
    expect(response.status).toBe(200);
    const { card } = await response.json();
    expect(authFetch).toHaveBeenCalledWith('https://auth.bezrabotnyi.com/check', expect.objectContaining({
      headers: { Cookie: 'gptadmin_auth=verified-existing-session' }, redirect: 'error', cache: 'no-store',
    }));
    expect(card.resultHistory).toHaveLength(2);
    expect(card.resultHistory[0]).toEqual(before.resultHistory?.[0]);
    expect(card.resultHistory[1]).toMatchObject({ submittedBy: 'owner-correction:nikita', evidenceRefs: ['https://lead4sell.ru/', 'https://www.amopartner.ru/'] });
    expect(card.resultHistory[1]).not.toHaveProperty('runRef');
    expect(card).toMatchObject({ column: 'review', needsReview: true, reviewHistory: before.reviewHistory, version: before.version + 1 });
    expect(findCardById(before.id, tasksDir)?.resultHistory).toEqual(card.resultHistory);
  });

  it('rejects anonymous, non-owner and stale corrections without writing', async () => {
    const before = waitingCard();
    authFetch.mockResolvedValueOnce(new Response(null, { status: 401 }));
    const anonymous = await POST(request(before.id, body(before.version)), { params: Promise.resolve({ id: before.id }) });
    expect(anonymous.status).toBe(401);
    authFetch.mockResolvedValueOnce(new Response(null, { status: 204, headers: { 'X-GPTAdmin-User': 'other' } }));
    const other = await POST(request(before.id, body(before.version)), { params: Promise.resolve({ id: before.id }) });
    expect(other.status).toBe(403);
    const stale = await POST(request(before.id, body(before.version - 1)), { params: Promise.resolve({ id: before.id }) });
    expect(stale.status).toBe(409);
    expect(findCardById(before.id, tasksDir)).toEqual(before);
  });
});
