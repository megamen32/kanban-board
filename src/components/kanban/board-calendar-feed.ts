export type CalendarFeed = {
  subject?: string;
  state: 'connected' | 'not_connected' | 'disabled' | 'loading' | 'error';
  events: import('@/lib/kanban/board-calendar').PersonalCalendarEvent[];
};
export type CalendarFeedResult = { account: string; feed: CalendarFeed } | null;

/** Private responses live only in this view and are discarded when it loses focus. */
export function watchPersonalCalendar({ from, to, timeZone, onChange, windowTarget = window, documentTarget = document, fetcher = fetch }: {
  from: string; to: string; timeZone: string; onChange: (result: CalendarFeedResult) => void;
  windowTarget?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  documentTarget?: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>;
  fetcher?: typeof fetch;
}): () => void {
  let controller: AbortController | undefined;
  let generation = 0;
  const clear = () => { generation += 1; controller?.abort(); onChange(null); };
  const load = async () => {
    clear();
    const requestGeneration = generation;
    controller = new AbortController();
    const signal = controller.signal;
    let account = '';
    try {
      const session = await fetcher('/api/auth/session', { signal, cache: 'no-store' });
      if (!session.ok) throw new Error('session unavailable');
      const identity = await session.json() as { username?: string };
      if (!identity.username) throw new Error('session unavailable');
      account = identity.username;
      if (signal.aborted || generation !== requestGeneration) return;
      const params = new URLSearchParams({ from, to, timezone: timeZone });
      const result = await fetcher('/api/kanban/calendar/events?' + params, { signal, cache: 'no-store' });
      if (!result.ok) throw new Error('calendar unavailable');
      const feed = await result.json() as CalendarFeed;
      if (feed.subject !== account || !['connected', 'not_connected', 'disabled'].includes(feed.state) || !Array.isArray(feed.events)) throw new Error('calendar session changed');
      if (!signal.aborted && generation === requestGeneration) onChange({ account, feed });
    } catch {
      if (!signal.aborted && generation === requestGeneration) onChange({ account, feed: { state: 'error', events: [] } });
    }
  };
  const show = () => { if (documentTarget.visibilityState !== 'hidden') void load(); };
  const visibility = () => { if (documentTarget.visibilityState === 'hidden') clear(); else show(); };
  show();
  windowTarget.addEventListener('focus', show);
  windowTarget.addEventListener('pageshow', show);
  windowTarget.addEventListener('blur', clear);
  documentTarget.addEventListener('visibilitychange', visibility);
  return () => {
    generation += 1; controller?.abort();
    windowTarget.removeEventListener('focus', show);
    windowTarget.removeEventListener('pageshow', show);
    windowTarget.removeEventListener('blur', clear);
    documentTarget.removeEventListener('visibilitychange', visibility);
  };
}
