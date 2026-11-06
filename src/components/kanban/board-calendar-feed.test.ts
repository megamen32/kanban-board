import { describe, expect, it, vi } from 'vitest';
import { watchPersonalCalendar, type CalendarFeedResult } from './board-calendar-feed';
const flush = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
const json = (body: unknown) => ({ ok: true, json: async () => body }) as Response;
function setup(fetcher: typeof fetch) {
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const values: CalendarFeedResult[] = [];
  const dispose = watchPersonalCalendar({ from: '2026-11-01', to: '2026-12-01', timeZone: 'UTC', fetcher,
    windowTarget: win as unknown as Window, documentTarget: doc as unknown as Document, onChange: value => values.push(value) });
  return { win, doc, values, dispose };
}
describe('private calendar lifecycle', () => {
  it('clears data on blur and loads the actual new account on focus', async () => {
    let account = 'nikita';
    const fetcher = vi.fn(async (url: string | URL | Request) => json(String(url).includes('/auth/session')
      ? { username: account } : { subject: account, state: 'connected', events: [{ id: account }] }));
    const test = setup(fetcher);
    await flush();
    expect(test.values.at(-1)?.account).toBe('nikita');
    test.win.dispatchEvent(new Event('blur'));
    expect(test.values.at(-1)).toBeNull();
    account = 'oleg';
    test.win.dispatchEvent(new Event('focus'));
    await flush();
    expect(test.values.at(-1)?.account).toBe('oleg');
    expect(test.values.at(-1)?.feed.events[0].id).toBe('oleg');
    test.dispose();
  });
  it('ignores an older response arriving after focus has authenticated a new account', async () => {
    let account = 'nikita';
    let oldResolve!: (response: Response) => void;
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('/auth/session')) return json({ username: account });
      if (account === 'nikita') return new Promise<Response>(resolve => { oldResolve = resolve; });
      return json({ subject: account, state: 'connected', events: [{ id: 'new' }] });
    });
    const test = setup(fetcher);
    await flush();
    test.win.dispatchEvent(new Event('blur'));
    account = 'oleg';
    test.win.dispatchEvent(new Event('focus'));
    await flush();
    oldResolve(json({ subject: 'nikita', state: 'connected', events: [{ id: 'private-old' }] }));
    await flush();
    expect(test.values.at(-1)?.account).toBe('oleg');
    expect(test.values.some(value => value?.feed.events.some(event => event.id === 'private-old'))).toBe(false);
    test.dispose();
  });
  it('fails closed when the cookie account changes between session and feed reads', async () => {
    const test = setup(vi.fn(async (url: string | URL | Request) => json(String(url).includes('/auth/session')
      ? { username: 'nikita' } : { subject: 'oleg', state: 'connected', events: [{ id: 'foreign' }] })));
    await flush();
    expect(test.values.at(-1)?.feed).toEqual({ state: 'error', events: [] });
    test.dispose();
  });
  it('clears hidden-page data, does not refetch while hidden, and removes listeners at unmount', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => json(String(url).includes('/auth/session')
      ? { username: 'nikita' } : { subject: 'nikita', state: 'not_connected', events: [] }));
    const test = setup(fetcher);
    await flush();
    test.doc.visibilityState = 'hidden';
    test.doc.dispatchEvent(new Event('visibilitychange'));
    test.win.dispatchEvent(new Event('focus'));
    expect(test.values.at(-1)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
    test.dispose();
    test.doc.visibilityState = 'visible';
    test.win.dispatchEvent(new Event('pageshow'));
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
