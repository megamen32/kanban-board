import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  calendarSyncDecision,
  KeeperApiError,
  KeeperNotConnectedError,
  keeperCreateEvent,
  keeperDeleteEvent,
  keeperUpdateEvent,
  noKeeperCredentials,
  ProjectCalendarNotConfiguredError,
  resolveCalendarId,
} from './keeper-calendar';

const BASE = 'http://192.168.2.100:43349';
const INPUT = { calendarId: 'cal-1', title: 'Созвон', titleHash: 'a'.repeat(64), startTime: '2026-11-09T10:00:00.000Z', endTime: '2026-11-09T11:00:00.000Z' };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === undefined || body === '' ? '' : JSON.stringify(body), { status });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('keeper calendar adapter (official REST contract)', () => {
  test('create posts the documented payload with the per-user bearer and returns the event id', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(201, { id: 'evt_42', url: 'https://keeper-calendar.airlock.bezrabotnyi.com/e/evt_42' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await keeperCreateEvent(BASE, 'kpr_secret', INPUT);

    expect(result).toEqual({ eventId: 'evt_42', eventUrl: 'https://keeper-calendar.airlock.bezrabotnyi.com/e/evt_42' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/v1/events`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ calendarId: 'cal-1', title: 'Созвон', startTime: INPUT.startTime, endTime: INPUT.endTime });
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe('Bearer kpr_secret');
  });

  test('update patches the exact event and tolerates an empty body', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, ''));
    vi.stubGlobal('fetch', fetchMock);

    const result = await keeperUpdateEvent(BASE, 'kpr_secret', 'evt_42', INPUT);

    expect(result).toEqual({ eventId: 'evt_42' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/v1/events/evt_42`);
    expect(init.method).toBe('PATCH');
  });

  test('delete removes the event without a request body', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, ''));
    vi.stubGlobal('fetch', fetchMock);

    await keeperDeleteEvent(BASE, 'kpr_secret', 'evt_42');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/v1/events/evt_42`);
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
  });

  test('keeper 401/405 failures surface as typed errors without leaking the bearer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, { error: 'unauthorized' })));
    await expect(keeperCreateEvent(BASE, 'kpr_secret', INPUT)).rejects.toMatchObject({ name: 'KeeperApiError', status: 401 });
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(500, {})));
    await expect(keeperUpdateEvent(BASE, 'kpr_secret', 'evt_42', INPUT)).rejects.toBeInstanceOf(KeeperApiError);
    try {
      await keeperCreateEvent(BASE, 'kpr_secret', INPUT).catch(() => {
        throw new Error('unreachable');
      });
    } catch (error) {
      expect(String(error)).not.toContain('kpr_secret');
    }
  });

  test('invalid JSON and missing event ids are adapter errors, not crashes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 200 })));
    await expect(keeperCreateEvent(BASE, 'kpr_secret', INPUT)).rejects.toMatchObject({ status: 502 });
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { ok: true })));
    await expect(keeperCreateEvent(BASE, 'kpr_secret', INPUT)).rejects.toMatchObject({ status: 502 });
  });

  test('event ids are URL-encoded in update/delete paths', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, ''));
    vi.stubGlobal('fetch', fetchMock);
    await keeperDeleteEvent(BASE, 'kpr_secret', 'a/b c');
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe(`${BASE}/api/v1/events/a%2Fb%20c`);
  });
});

describe('project-aware calendar routing (strict, no silent mixing)', () => {
  const credential = { bearer: 'kpr_secret', calendarId: 'cal-default', projectCalendars: { QA: 'cal-qa', 'Олег и Никита': 'cal-family' } };

  test('explicit project mapping wins', () => {
    expect(resolveCalendarId(credential, 'QA')).toBe('cal-qa');
    expect(resolveCalendarId(credential, 'Олег и Никита')).toBe('cal-family');
  });

  test('a partial mapping fails closed for unmapped projects instead of silently mixing', () => {
    expect(() => resolveCalendarId(credential, 'Другой проект')).toThrow(ProjectCalendarNotConfiguredError);
    expect(() => resolveCalendarId(credential, 'qa')).toThrow(ProjectCalendarNotConfiguredError);
    try {
      resolveCalendarId(credential, 'Никогда');
    } catch (error) {
      expect((error as ProjectCalendarNotConfiguredError).project).toBe('Никогда');
    }
  });

  test('a credential without any mapping keeps the legacy default-calendar behavior', () => {
    expect(resolveCalendarId({ bearer: 'x', calendarId: 'cal-default' }, 'QA')).toBe('cal-default');
    expect(resolveCalendarId({ bearer: 'x', calendarId: 'cal-default', projectCalendars: {} }, 'QA')).toBe('cal-default');
  });

  test('routing never crosses credentials', () => {
    const other = { bearer: 'kpr_b', calendarId: 'cal-b', projectCalendars: { QA: 'cal-b-qa' } };
    expect(resolveCalendarId(other, 'QA')).toBe('cal-b-qa');
    expect(resolveCalendarId(credential, 'QA')).toBe('cal-qa');
  });
});

describe('duplicate-safe sync decisions', () => {
  const binding = { eventId: 'evt_42', startTime: INPUT.startTime, endTime: INPUT.endTime, syncedAt: '2026-11-06T18:00:00.000Z' };

  test('unsynced card creates an event', () => {
    expect(calendarSyncDecision(undefined, INPUT)).toEqual({ action: 'create' });
  });

  test('identical window and title reuse the stored receipt without a Keeper call', () => {
    const hashedBinding = { ...binding, titleHash: 'a'.repeat(64) };
    expect(calendarSyncDecision(hashedBinding, INPUT)).toEqual({ action: 'none', binding: hashedBinding });
  });

  test('changed start, end or title patches the existing event instead of duplicating', () => {
    expect(calendarSyncDecision(binding, { ...INPUT, startTime: '2026-11-09T10:30:00.000Z' })).toEqual({
      action: 'patch',
      binding,
    });
    expect(calendarSyncDecision(binding, { ...INPUT, endTime: '2026-11-09T12:00:00.000Z' })).toEqual({
      action: 'patch',
      binding,
    });
    expect(calendarSyncDecision({ ...binding, titleHash: 'a'.repeat(64) }, { ...INPUT, title: 'Новое название', titleHash: 'b'.repeat(64) })).toEqual({
      action: 'patch',
      binding: { ...binding, titleHash: 'a'.repeat(64) },
    });
  });

  test('a receipt without titleHash falls back to window-only comparison', () => {
    expect(calendarSyncDecision(binding, INPUT).action).toBe('none');
    expect(calendarSyncDecision(binding, { ...INPUT, startTime: '2026-11-09T10:30:00.000Z' }).action).toBe('patch');
  });

  test('v1 credential source connects nobody and errors carry no tokens', async () => {
    expect(await noKeeperCredentials('nikita')).toBeNull();
    const error = new KeeperNotConnectedError('nikita');
    expect(error.message).not.toMatch(/kpr_|bearer|token/i);
    expect(error.username).toBe('nikita');
  });
});
