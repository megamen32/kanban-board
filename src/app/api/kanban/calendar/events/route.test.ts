import { NextRequest } from 'next/server';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  credentials: vi.fn(),
}));
vi.mock('@/lib/auth/board-human', () => ({ boardHumanIdentityFromRequest: mocks.identity }));
vi.mock('@/lib/kanban/keeper-credentials', () => ({ keeperCredentialForUser: mocks.credentials }));
import { GET } from './route';
const make = (query = '', headers?: Record<string, string>) => new NextRequest('http://localhost/api/kanban/calendar/events?from=2026-11-01&to=2026-12-01&timezone=Europe%2FMoscow' + query, { headers });
const event = { id: 'event', title: 'Only mine', calendarId: 'calendar-nikita', startTime: '2026-11-07T10:00:00Z', endTime: '2026-11-07T11:00:00Z', isAllDay: false, location: 'Never exposed', description: 'Never exposed', bearer: 'Never exposed' };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.identity.mockResolvedValue({ username: 'nikita', scope: 'work' });
  mocks.credentials.mockImplementation(async (name: string) => name === 'nikita' ? { bearer: 'synthetic-nikita', calendarId: 'calendar-nikita' } : null);
  process.env.KEEPER_API_URL = 'http://keeper.test';
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([event]), { status: 200 })));
});
afterEach(() => { vi.unstubAllGlobals(); delete process.env.KEEPER_API_URL; });
describe('private calendar read endpoint', () => {
  it('rejects unauthenticated and bearer requests without calling Keeper', async () => {
    mocks.identity.mockResolvedValue(null);
    expect((await GET(make())).status).toBe(401);
    mocks.identity.mockResolvedValue({ username: 'nikita', scope: 'work' });
    expect((await GET(make('', { authorization: 'Bearer service' }))).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('cannot select another user or calendar through query parameters', async () => {
    const response = await GET(make('&username=oleg&calendarId=foreign'));
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.credentials).toHaveBeenCalledWith('nikita');
    const url = new URL(vi.mocked(fetch).mock.calls[0][0] as string);
    expect(url.searchParams.get('calendarId')).toBe('calendar-nikita');
    expect(url.searchParams.get('timezone')).toBe('Europe/Moscow');
    expect(vi.mocked(fetch).mock.calls[0][1]?.cache).toBe('no-store');
    const text = await response.text();
    expect(text).toContain('Only mine');
    expect(text).not.toMatch(/Never exposed|synthetic-nikita|calendar-nikita/);
  });
  it('does not fall back to the owners credential for a second user', async () => {
    mocks.identity.mockResolvedValue({ username: 'oleg', scope: 'work' });
    const response = await GET(make('&username=nikita'));
    expect(await response.json()).toMatchObject({ state: 'not_connected', events: [] });
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.credentials).toHaveBeenCalledWith('oleg');
  });
  it('uses a connected second users own bearer and calendar', async () => {
    mocks.identity.mockResolvedValue({ username: 'oleg', scope: 'work' });
    mocks.credentials.mockResolvedValue({ bearer: 'synthetic-oleg', calendarId: 'calendar-oleg' });
    await GET(make());
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain('calendarId=calendar-oleg');
    expect(init?.headers).toEqual({ Authorization: 'Bearer synthetic-oleg' });
  });
  it('rejects invalid, backwards, unbounded date ranges and bad zones', async () => {
    for (const query of ['from=bad&to=2026-12-01&timezone=UTC', 'from=2026-12-02&to=2026-12-01&timezone=UTC', 'from=2026-01-01&to=2026-12-01&timezone=UTC', 'from=2026-11-01&to=2026-12-01&timezone=nope']) {
      expect((await GET(new NextRequest('http://localhost/api/kanban/calendar/events?' + query))).status).toBe(400);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it('fails closed for a corrupt credential store and upstream errors', async () => {
    mocks.credentials.mockRejectedValueOnce(new Error('secret internal detail'));
    expect(await (await GET(make())).json()).toEqual({ error: 'personal_calendar_unavailable' });
    vi.mocked(fetch).mockResolvedValueOnce(new Response('secret internal detail', { status: 401 }));
    expect((await GET(make())).status).toBe(502);
  });
  it('reports disabled integration and unknown accounts without calling Keeper', async () => {
    delete process.env.KEEPER_API_URL;
    expect(await (await GET(make())).json()).toEqual({ state: 'disabled', subject: 'nikita', events: [] });
    mocks.identity.mockResolvedValue({ username: 'stranger', scope: 'work' });
    expect((await GET(make())).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('accepts unnamed Keeper events without losing the rest of the feed', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify([{ ...event, id: 'unnamed', title: null }, event])));
    const response = await GET(make());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.events.map((item: { title: string }) => item.title)).toEqual(['', 'Only mine']);
  });
  it('rejects malformed upstream arrays instead of reporting a false empty calendar', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ events: [] })));
    expect((await GET(make())).status).toBe(502);
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify([{ ...event, startTime: 'bad' }])));
    expect((await GET(make())).status).toBe(502);
  });
});
