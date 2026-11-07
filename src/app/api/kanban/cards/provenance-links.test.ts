import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KanbanCard } from '@/lib/kanban/types';

const state = vi.hoisted(() => ({ dir: '' }));
vi.mock('@/lib/auth/request', () => ({
  boardIdentityFromRequest: () => ({ username: 'nikita', scope: 'work' }),
  managerRequestAuthorized: () => false,
  nativeProjectAccessContextFromRequest: async () => null,
}));
vi.mock('@/lib/auth/board-human', () => ({
  boardHumanIdentityFromRequest: async () => ({ username: 'nikita', scope: 'work' }),
}));
vi.mock('@/lib/auth/data-scope', () => ({ tasksDirForScope: () => state.dir }));
vi.mock('@/lib/notifications/push', () => ({ dispatchCardEvent: vi.fn(async () => ({ sent: 0 })) }));
vi.mock('@/lib/notifications/scheduler', () => ({ startDueReminderScheduler: vi.fn() }));

import { findCardById, getAllCards } from '@/lib/kanban/file-store';
import { POST } from './route';
import { PATCH } from './[id]/route';

const message = 'https://messages.example.test/opaque-message';
const session = 'https://sessions.example.test/opaque-session#turn';
function request(method: string, body: unknown, id?: string) {
  return new NextRequest('http://localhost/api/kanban/cards' + (id ? '/' + id : ''), {
    method, headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
    body: JSON.stringify(body),
  });
}

describe('HTTP source and session URL metadata', () => {
  beforeEach(() => { state.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-provenance-http-')); });
  afterEach(() => fs.rmSync(state.dir, { recursive: true, force: true }));

  it('creates and edits durable links, preserves omitted fields and clears null', async () => {
    const created = await POST(request('POST', {
      title: 'Synthetic HTTP task', project: 'Synthetic project', source: 'legacy:opaque',
      sourceMessageUrl: message, sourceSessionUrl: session,
    }));
    expect(created.status).toBe(201);
    const card = (await created.json()).card as KanbanCard;
    expect(card).toMatchObject({ sourceMessageUrl: message, sourceSessionUrl: session, source: 'legacy:opaque' });
    expect(findCardById(card.id, state.dir)).toMatchObject({ sourceMessageUrl: message, sourceSessionUrl: session });

    const edited = await PATCH(request('PATCH', { title: 'Synthetic renamed', expectedVersion: card.version }, card.id),
      { params: Promise.resolve({ id: card.id }) });
    expect(edited.status).toBe(200);
    const updated = (await edited.json()).card as KanbanCard;
    expect(updated).toMatchObject({ sourceMessageUrl: message, sourceSessionUrl: session });
    const cleared = await PATCH(request('PATCH', { sourceMessageUrl: null, expectedVersion: updated.version }, card.id),
      { params: Promise.resolve({ id: card.id }) });
    expect(cleared.status).toBe(200);
    const after = findCardById(card.id, state.dir)!;
    expect(after.sourceMessageUrl).toBeUndefined();
    expect(after).toMatchObject({ sourceSessionUrl: session, source: 'legacy:opaque' });
  });

  it('rejects invalid create metadata before any card is persisted', async () => {
    for (const bad of ['javascript:alert(1)', 'https://user:password@example.test/', 42]) {
      const response = await POST(request('POST', {
        title: 'Must not persist', project: 'Synthetic project', sourceMessageUrl: bad,
      }));
      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(/sourceMessageUrl/);
    }
    expect(getAllCards(state.dir)).toHaveLength(0);
  });

  it('rejects an invalid edit without a version bump and keeps stale edit conflicts', async () => {
    const created = await POST(request('POST', {
      title: 'Synthetic protected task', project: 'Synthetic project', sourceSessionUrl: session,
    }));
    const card = (await created.json()).card as KanbanCard;
    const bad = await PATCH(request('PATCH', { sourceSessionUrl: 'https://example.test/%0A', expectedVersion: card.version }, card.id),
      { params: Promise.resolve({ id: card.id }) });
    expect(bad.status).toBe(400);
    expect(findCardById(card.id, state.dir)).toMatchObject({ version: card.version, sourceSessionUrl: session });
    const conflict = await PATCH(request('PATCH', { sourceSessionUrl: null, expectedVersion: card.version + 1 }, card.id),
      { params: Promise.resolve({ id: card.id }) });
    expect(conflict.status).toBe(409);
    expect(findCardById(card.id, state.dir)?.sourceSessionUrl).toBe(session);
  });

  it('does not convert display URLs or unknown body fields into managed source/session authority', async () => {
    const result = await POST(request('POST', {
      title: 'Synthetic metadata only', project: 'Synthetic project',
      sourceMessageUrl: message, sourceSessionUrl: session,
      sourceAdmission: { operationKey: 'untrusted' }, taskExecutionHistory: [{ sessionUrl: session }],
    }));
    expect(result.status).toBe(201);
    const card = (await result.json()).card as KanbanCard;
    expect(card.sourceAdmission).toBeUndefined();
    expect(card.taskExecutionHistory).toBeUndefined();
    expect(card.column).toBe('inbox');
  });
});
