import { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KanbanCard } from '@/lib/kanban/types';

const { findCardById, identity, credential, fetchMock } = vi.hoisted(() => ({
  findCardById: vi.fn(),
  identity: { current: null as { username: string; scope: 'work' | 'personal' } | null },
  credential: { current: null as null | { bearer: string; calendarId: string; projectCalendars?: Record<string, string> } },
  fetchMock: vi.fn(),
}));

vi.mock('@/lib/kanban/file-store', () => ({ findCardById, updateCard: vi.fn(), deleteCard: vi.fn() }));
vi.mock('@/lib/auth/board-human', () => ({
  boardHumanIdentityFromRequest: vi.fn(async () => identity.current),
}));
vi.mock('@/lib/auth/data-scope', () => ({ tasksDirForScope: vi.fn(() => '/tmp/keeper-route-tasks') }));
vi.mock('@/lib/kanban/keeper-credentials', () => ({
  keeperCredentialForUser: vi.fn(async () => credential.current),
}));

import { DELETE, GET, POST } from './route';
import { calendarSyncKey, keeperBindingStore } from '@/lib/kanban/keeper-bindings';

const BASE = 'http://keeper-calendar-internal';
const PUBLIC = 'https://keeper-calendar.airlock.bezrabotnyi.com';
const DUE_AT = '2026-11-09T10:00:00.000Z';
const TITLE_HASH = createHash('sha256').update('Созвон с клиентом').digest('hex');

let authDir: string;

function baseCard(overrides: Partial<KanbanCard> = {}): KanbanCard {
  return {
    id: 'card-1',
    title: 'Созвон с клиентом',
    description: '',
    column: 'todo',
    priority: 'medium',
    tags: [],
    order: 0,
    created: '2026-11-01T00:00:00.000Z',
    updated: '2026-11-01T00:00:00.000Z',
    dueAt: DUE_AT,
    fileName: 'card-1.md',
    version: 7,
    project: 'QA',
    assignees: [],
    ...overrides,
  } as KanbanCard;
}

function boundRecord(eventId = 'evt_1', overrides: Record<string, unknown> = {}) {
  return {
    state: 'bound' as const,
    eventId,
    startTime: DUE_AT,
    endTime: '2026-11-09T11:00:00.000Z',
    titleHash: TITLE_HASH,
    project: 'QA',
    calendarId: 'cal-1',
    syncedAt: '2026-11-06T18:00:00.000Z',
    ...overrides,
  };
}

function calendarRequest(method: string, body?: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost/api/kanban/cards/card-1/calendar`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers,
  });
}

const post = (body?: unknown, headers: Record<string, string> = {}) => POST(calendarRequest('POST', body, headers), { params: Promise.resolve({ id: 'card-1' }) });
const get = (headers: Record<string, string> = {}) => GET(calendarRequest('GET', undefined, headers), { params: Promise.resolve({ id: 'card-1' }) });
const remove = (body?: unknown, headers: Record<string, string> = {}) => DELETE(calendarRequest('DELETE', body, headers), { params: Promise.resolve({ id: 'card-1' }) });

async function payload(promise: Promise<Response>, status: number): Promise<Record<string, unknown>> {
  const response = await promise;
  expect(response.status).toBe(status);
  return await response.json().catch(() => ({}));
}

function okKeeper(status: number, body: unknown): void {
  fetchMock.mockImplementation(async () => new Response(body === '' ? '' : JSON.stringify(body), { status }));
}

beforeEach(() => {
  vi.clearAllMocks();
  authDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-route-auth-'));
  process.env.KANBAN_AUTH_DIR = authDir;
  process.env.KEEPER_API_URL = BASE;
  process.env.KEEPER_PUBLIC_URL = PUBLIC;
  identity.current = { username: 'nikita', scope: 'work' };
  credential.current = null;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  findCardById.mockImplementation(() => baseCard());
});

afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(authDir, { recursive: true, force: true });
  delete process.env.KANBAN_AUTH_DIR;
});

describe('auth: human owners only, service bearers rejected', () => {
  it('answers 401 without identity on POST/GET/DELETE and never calls Keeper', async () => {
    identity.current = null;
    expect((await payload(post({}), 401)).error).toBe('authentication required');
    await payload(get(), 401);
    await payload(remove(), 401);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(keeperBindingStore.get('nikita', 'card-1')).toBeNull();
  });

  it('answers 403 to service bearers even with a valid login', async () => {
    const bearer = { Authorization: 'Bearer kanban_service_token' };
    expect((await payload(post({}, bearer), 403)).error).toBe('service_bearer_forbidden');
    await payload(get(bearer), 403);
    await payload(remove(undefined, bearer), 403);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(keeperBindingStore.get('nikita', 'card-1')).toBeNull();
  });

  it('answers 403 to verified humans outside the board owners', async () => {
    identity.current = { username: 'random_sso_user', scope: 'work' };
    expect((await payload(post({}), 403)).error).toBe('calendar_bridge_not_available_for_account');
    await payload(get(), 403);
    await payload(remove(), 403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('guards: feature, card, duration, connection', () => {
  it('answers 503 keeper_disabled without KEEPER_API_URL', async () => {
    delete process.env.KEEPER_API_URL;
    expect((await payload(post({}), 503)).error).toBe('keeper_disabled');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown card', async () => {
    findCardById.mockImplementation(() => null);
    await payload(post({}), 404);
    await payload(get(), 404);
    await payload(remove(), 404);
  });

  it('answers 400 card_has_no_due_at and does not touch Keeper or the store', async () => {
    findCardById.mockImplementation(() => baseCard({ dueAt: undefined }));
    expect((await payload(post({}), 400)).error).toBe('card_has_no_due_at');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(keeperBindingStore.get('nikita', 'card-1')).toBeNull();
  });

  it('answers 400 invalid_duration', async () => {
    expect((await payload(post({ durationMinutes: 0 }), 400)).error).toBe('invalid_duration');
    expect((await payload(post({ durationMinutes: 24 * 61 }), 400)).error).toBe('invalid_duration');
    expect((await payload(post({ durationMinutes: 12.5 }), 400)).error).toBe('invalid_duration');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers 409 keeper_not_connected without a credential, leaving no record', async () => {
    expect((await payload(post({}), 409)).error).toBe('keeper_not_connected');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(keeperBindingStore.get('nikita', 'card-1')).toBeNull();
  });

  it('answers 502 keeper_upstream on Keeper credential rejection and keeps no bound record', async () => {
    credential.current = { bearer: 'kpr_secret', calendarId: 'cal-1' };
    okKeeper(401, { error: 'unauthorized' });
    const body = await payload(post({}), 502);
    expect(body.error).toBe('keeper_upstream');
    expect(body.upstreamStatus).toBe(401);
    expect(JSON.stringify(body)).not.toContain('kpr_secret');
    const record = keeperBindingStore.get('nikita', 'card-1');
    expect(record?.state).toBe('pending');
  });
});

describe('create, idempotent repeat, patch, race and foreign users', () => {
  beforeEach(() => {
    credential.current = { bearer: 'kpr_secret', calendarId: 'cal-1' };
  });

  it('creates exactly one event and stores a per-user bound record', async () => {
    okKeeper(201, { id: 'evt_1' });
    const body = await payload(post({ durationMinutes: 60 }), 200);

    expect(body.reused).toBe(false);
    expect(body.event).toMatchObject({ eventId: 'evt_1', startTime: DUE_AT, endTime: '2026-11-09T11:00:00.000Z', titleHash: TITLE_HASH });
    expect(JSON.stringify(body)).not.toContain('kpr_secret');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/v1/events`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ calendarId: 'cal-1', title: 'Созвон с клиентом', startTime: DUE_AT, endTime: '2026-11-09T11:00:00.000Z' });
    expect(keeperBindingStore.get('nikita', 'card-1')).toMatchObject({ state: 'bound', eventId: 'evt_1' });
  });

  it('answers an identical repeat from the store without another Keeper call (no duplicate)', async () => {
    keeperBindingStore.set('nikita', 'card-1', boundRecord());
    okKeeper(201, { id: 'evt_WOULD_BE_DUPLICATE' });

    const body = await payload(post({ durationMinutes: 60 }), 200);
    expect(body.reused).toBe(true);
    expect((body.event as { eventId: string }).eventId).toBe('evt_1');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('patches the same event when the time changes instead of creating a duplicate', async () => {
    keeperBindingStore.set('nikita', 'card-1', boundRecord());
    findCardById.mockImplementation(() => baseCard({ dueAt: '2026-11-10T09:00:00.000Z' }));
    okKeeper(200, { id: 'evt_1' });

    const body = await payload(post({ durationMinutes: 30 }), 200);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/v1/events/evt_1`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body)).startTime).toBe('2026-11-10T09:00:00.000Z');
    expect(JSON.parse(String(init.body)).endTime).toBe('2026-11-10T09:30:00.000Z');
    expect(body.event).toMatchObject({ eventId: 'evt_1', startTime: '2026-11-10T09:00:00.000Z' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('patches when only the title changed', async () => {
    keeperBindingStore.set('nikita', 'card-1', boundRecord());
    findCardById.mockImplementation(() => baseCard({ title: 'Новое название' }));
    okKeeper(200, { id: 'evt_1' });
    await payload(post({}), 200);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('PATCH');
  });

  it('serializes two concurrent POSTs into exactly one upstream create', async () => {
    let releaseUpstream!: () => void;
    const upstreamGate = new Promise<void>(resolve => {
      releaseUpstream = resolve;
    });
    fetchMock.mockImplementation(async () => {
      await upstreamGate;
      return new Response(JSON.stringify({ id: 'evt_1' }), { status: 201 });
    });

    const first = post({ durationMinutes: 60 });
    const second = post({ durationMinutes: 60 });
    // Both requests are in flight; the lock must keep the second from creating.
    await new Promise(resolve => setTimeout(resolve, 20));
    releaseUpstream();

    const [firstBody, secondBody] = await Promise.all([
      payload(first, 200),
      payload(second, 200),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const reused = [firstBody, secondBody].filter(body => body.reused === true);
    expect(reused).toHaveLength(1);
    expect(keeperBindingStore.get('nikita', 'card-1')).toMatchObject({ state: 'bound', eventId: 'evt_1' });
  });

  it('never retries a create after an uncertain outcome: pending refuses further creates', async () => {
    fetchMock.mockImplementation(async () => {
      throw new Error('connection reset after send');
    });
    await payload(post({}), 502);
    expect(keeperBindingStore.get('nikita', 'card-1')).toMatchObject({ state: 'pending', phase: 'create' });

    // A retry must NOT create a second upstream event.
    const body = await payload(post({}), 409);
    expect(body.error).toBe('calendar_sync_pending');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses to clear a pending create without explicit manual reconciliation (no duplicate path)', async () => {
    keeperBindingStore.set('nikita', 'card-1', { state: 'pending', phase: 'create', startedAt: '2026-11-06T18:00:00.000Z' });
    const refusal = await payload(remove(), 409);
    expect(refusal.error).toBe('calendar_sync_pending_manual_required');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(keeperBindingStore.get('nikita', 'card-1')).toMatchObject({ state: 'pending', phase: 'create' });

    // Even a plain retry POST stays refused while the marker is pending.
    await payload(post({}), 409);

    // After the human reconciled events in Keeper, explicit confirmation clears it.
    const body = await payload(remove({ confirmManualReconcile: true }), 200);
    expect(body).toEqual({ removed: true, recovered: true, manualReconcile: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(keeperBindingStore.get('nikita', 'card-1')).toBeNull();
  });

  it('DELETE recovers a pending patch by deleting the event it may have touched', async () => {
    keeperBindingStore.set('nikita', 'card-1', { state: 'pending', phase: 'patch', eventId: 'evt_old', startedAt: '2026-11-06T18:00:00.000Z' });
    okKeeper(200, '');
    const body = await payload(remove(), 200);
    expect(body).toEqual({ removed: true, recovered: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/v1/events/evt_old`);
    expect(init.method).toBe('DELETE');
    expect(keeperBindingStore.get('nikita', 'card-1')).toBeNull();
  });

  it('keeps a pending patch retryable when its recovery delete fails upstream', async () => {
    keeperBindingStore.set('nikita', 'card-1', { state: 'pending', phase: 'patch', eventId: 'evt_old', startedAt: '2026-11-06T18:00:00.000Z' });
    okKeeper(500, {});
    const body = await payload(remove(), 502);
    expect(body.error).toBe('keeper_upstream');
    expect(keeperBindingStore.get('nikita', 'card-1')).toMatchObject({ state: 'pending', phase: 'patch', eventId: 'evt_old' });
  });

  it('routes mapped projects to their own calendars and refuses unmapped ones (strict split)', async () => {
    credential.current = { bearer: 'kpr_secret', calendarId: 'cal-default', projectCalendars: { QA: 'cal-qa', 'Олег и Никита': 'cal-family' } };

    // Mapped project -> its own calendar.
    findCardById.mockImplementation(() => baseCard({ project: 'QA' }));
    okKeeper(201, { id: 'evt_qa' });
    await payload(post({}), 200);
    let [url, init] = fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).calendarId).toBe('cal-qa');
    expect(keeperBindingStore.get('nikita', 'card-1')).toMatchObject({ state: 'bound', eventId: 'evt_qa', project: 'QA', calendarId: 'cal-qa' });

    // Second mapped project -> a different calendar of the same account.
    findCardById.mockImplementation(() => baseCard({ id: 'card-2', project: 'Олег и Никита' }));
    okKeeper(201, { id: 'evt_family' });
    await payload(POST(calendarRequest('POST', {}), { params: Promise.resolve({ id: 'card-2' }) }), 200);
    [url, init] = fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).calendarId).toBe('cal-family');

    // Unmapped project under a partial mapping refuses WITHOUT any pending
    // record or extra upstream call: projects must never silently mix.
    findCardById.mockImplementation(() => baseCard({ id: 'card-3', project: 'Другой проект' }));
    const refused = await payload(POST(calendarRequest('POST', {}), { params: Promise.resolve({ id: 'card-3' }) }), 409);
    expect(refused.error).toBe('project_calendar_not_configured');
    expect(refused.project).toBe('Другой проект');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(keeperBindingStore.get('nikita', 'card-3')).toBeNull();
  });

  it('never patches an event into another calendar: project change needs explicit rebind', async () => {
    credential.current = { bearer: 'kpr_secret', calendarId: 'cal-default', projectCalendars: { QA: 'cal-qa', 'Олег и Никита': 'cal-family' } };
    // Event was created for QA; the card has since moved to another project.
    keeperBindingStore.set('nikita', 'card-1', boundRecord('evt_qa', { calendarId: 'cal-qa' }));
    findCardById.mockImplementation(() => baseCard({ project: 'Олег и Никита' }));
    const body = await payload(post({}), 409);
    expect(body.error).toBe('calendar_rebind_manual_required');
    expect(body.storedProject).toBe('QA');
    expect(body.storedCalendarId).toBe('cal-qa');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(keeperBindingStore.get('nikita', 'card-1')).toMatchObject({ state: 'bound', eventId: 'evt_qa', project: 'QA' });

    // The proven upstream delete rebinds: next sync creates it in the new calendar.
    okKeeper(200, '');
    await payload(remove(), 200);
    expect(keeperBindingStore.get('nikita', 'card-1')).toBeNull();
    okKeeper(201, { id: 'evt_family' });
    const created = await payload(post({}), 200);
    expect((created.event as { eventId: string }).eventId).toBe('evt_family');
    const [, createInit] = fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit];
    expect(JSON.parse(String(createInit.body)).calendarId).toBe('cal-family');
  });

  it('a receipt without a stored project/calendar cannot be silently reused or patched', async () => {
    const { calendarId: _drop, project: _drop2, ...legacy } = boundRecord('evt_legacy');
    keeperBindingStore.set('nikita', 'card-1', legacy);
    const body = await payload(post({}), 409);
    expect(body.error).toBe('calendar_rebind_manual_required');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(keeperBindingStore.get('nikita', 'card-1')).toMatchObject({ state: 'bound', eventId: 'evt_legacy' });
  });

  it('reuse requires a live credential even when the card window is unchanged', async () => {
    keeperBindingStore.set('nikita', 'card-1', boundRecord());
    credential.current = null;
    const body = await payload(post({}), 409);
    expect(body.error).toBe('keeper_not_connected');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(body.reused).toBeUndefined();
  });

  it('unchanged card with a valid credential and matching calendar reuses without upstream', async () => {
    const titleHash = createHash('sha256').update('Созвон с клиентом').digest('hex');
    keeperBindingStore.set('nikita', 'card-1', { ...boundRecord(), titleHash });
    okKeeper(201, { id: 'evt_WOULD_DUPLICATE' });
    const body = await payload(post({}), 200);
    expect(body.reused).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('another user never sees, reuses or removes the first user event', async () => {
    keeperBindingStore.set('nikita', 'card-1', boundRecord('evt_nikita'));

    // Oleg has his own empty binding space.
    identity.current = { username: 'oleg', scope: 'work' };
    const ownView = await payload(get(), 200);
    expect(ownView.event).toBeNull();

    okKeeper(201, { id: 'evt_oleg' });
    const created = await payload(post({}), 200);
    expect(created.reused).toBe(false);
    const [, createInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(createInit.method).toBe('POST');
    expect(keeperBindingStore.get('oleg', 'card-1')).toMatchObject({ state: 'bound', eventId: 'evt_oleg' });

    // Oleg's delete removes only his own record.
    fetchMock.mockReset();
    okKeeper(200, '');
    await payload(remove(), 200);
    expect(keeperBindingStore.get('oleg', 'card-1')).toBeNull();
    expect(keeperBindingStore.get('nikita', 'card-1')).toMatchObject({ state: 'bound', eventId: 'evt_nikita' });
  });

  it('a non-owner with a seeded foreign binding still cannot reach it', async () => {
    keeperBindingStore.set('nikita', 'card-1', boundRecord('evt_nikita'));
    identity.current = { username: 'random_sso_user', scope: 'work' };
    await payload(get(), 403);
    await payload(post({}), 403);
    await payload(remove(), 403);
    expect(keeperBindingStore.get('nikita', 'card-1')).toMatchObject({ state: 'bound', eventId: 'evt_nikita' });
  });
});

describe('delete semantics', () => {
  beforeEach(() => {
    credential.current = { bearer: 'kpr_secret', calendarId: 'cal-1' };
  });

  it('deletes the upstream event and clears the receipt exactly once', async () => {
    keeperBindingStore.set('nikita', 'card-1', boundRecord());
    okKeeper(200, '');
    const body = await payload(remove(), 200);
    expect(body).toEqual({ removed: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/v1/events/evt_1`);
    expect(init.method).toBe('DELETE');
    expect(keeperBindingStore.get('nikita', 'card-1')).toBeNull();
  });

  it('is an idempotent no-op without a receipt and without any Keeper call', async () => {
    const body = await payload(remove(), 200);
    expect(body).toEqual({ removed: true, alreadyClear: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the receipt retryable when the upstream delete fails', async () => {
    keeperBindingStore.set('nikita', 'card-1', boundRecord());
    okKeeper(500, {});
    const body = await payload(remove(), 502);
    expect(body.error).toBe('keeper_upstream');
    expect(keeperBindingStore.get('nikita', 'card-1')).toMatchObject({ state: 'bound', eventId: 'evt_1' });
  });

  it('treats an upstream 404 on delete as already-gone and clears the receipt', async () => {
    keeperBindingStore.set('nikita', 'card-1', boundRecord());
    okKeeper(404, {});
    const body = await payload(remove(), 200);
    expect(body).toEqual({ removed: true });
    expect(keeperBindingStore.get('nikita', 'card-1')).toBeNull();
  });

  it('fails closed without a credential: keeps the bound receipt so the next POST cannot duplicate', async () => {
    keeperBindingStore.set('nikita', 'card-1', boundRecord());
    credential.current = null;
    const body = await payload(remove(), 409);
    expect(body.error).toBe('keeper_not_connected');
    expect(fetchMock).not.toHaveBeenCalled();
    // The receipt stays: a later sync patches evt_1 instead of creating a duplicate.
    expect(keeperBindingStore.get('nikita', 'card-1')).toMatchObject({ state: 'bound', eventId: 'evt_1' });
  });

  it('fails closed when the bridge is disabled: keeps the bound receipt', async () => {
    keeperBindingStore.set('nikita', 'card-1', boundRecord());
    delete process.env.KEEPER_API_URL;
    const body = await payload(remove(), 503);
    expect(body.error).toBe('keeper_disabled');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(keeperBindingStore.get('nikita', 'card-1')).toMatchObject({ state: 'bound', eventId: 'evt_1' });
  });

  it('fails closed for a pending patch without a credential', async () => {
    keeperBindingStore.set('nikita', 'card-1', { state: 'pending', phase: 'patch', eventId: 'evt_old', startedAt: '2026-11-06T18:00:00.000Z' });
    credential.current = null;
    const body = await payload(remove(), 409);
    expect(body.error).toBe('keeper_not_connected');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(keeperBindingStore.get('nikita', 'card-1')).toMatchObject({ state: 'pending', phase: 'patch', eventId: 'evt_old' });
  });

  it('pending create still clears after explicit manual reconciliation, even without a credential', async () => {
    keeperBindingStore.set('nikita', 'card-1', { state: 'pending', phase: 'create', startedAt: '2026-11-06T18:00:00.000Z' });
    credential.current = null;
    const body = await payload(remove({ confirmManualReconcile: true }), 200);
    expect(body).toEqual({ removed: true, recovered: true, manualReconcile: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(keeperBindingStore.get('nikita', 'card-1')).toBeNull();
  });
});

describe('get returns the caller-own state', () => {
  it('exposes the bound event, pending state and public link, never tokens', async () => {
    expect((await payload(get(), 200))).toEqual({ event: null, pending: null, publicUrl: PUBLIC });
    keeperBindingStore.set('nikita', 'card-1', { state: 'pending', phase: 'create', startedAt: '2026-11-06T18:00:00.000Z' });
    const pendingBody = await payload(get(), 200);
    expect(pendingBody.event).toBeNull();
    expect(pendingBody.pending).toEqual({ phase: 'create', startedAt: '2026-11-06T18:00:00.000Z' });
    keeperBindingStore.set('nikita', 'card-1', boundRecord());
    const boundBody = await payload(get(), 200);
    expect(boundBody.event).toMatchObject({ eventId: 'evt_1' });
    expect(JSON.stringify(boundBody)).not.toContain('kpr_');
  });

  it('store keys cannot collide across usernames containing the separator', () => {
    expect(calendarSyncKey('a::b', 'c')).not.toBe(calendarSyncKey('a', 'b::c'));
  });
});
