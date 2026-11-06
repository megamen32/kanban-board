import type { PersonalCalendarEvent } from './board-calendar';
import { KeeperApiError } from './keeper-calendar';

/** Read contract verified against Keeper standalone 2.29.3 GET /api/v1/events. */
export async function keeperReadEvents(baseUrl: string, bearer: string, calendarId: string, from: string, to: string, timeZone: string): Promise<PersonalCalendarEvent[]> {
  const query = new URLSearchParams({ from, to, timezone: timeZone, calendarId });
  const response = await fetch(`${baseUrl}/api/v1/events?${query}`, {
    headers: { Authorization: `Bearer ${bearer}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new KeeperApiError(response.status, 'keeper event read failed');
  const payload: unknown = await response.json();
  if (!Array.isArray(payload) || payload.length > 5000) throw new KeeperApiError(502, 'invalid keeper event list');
  return payload.map(item => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string'
      || (item.title !== null && typeof item.title !== 'string') || typeof item.startTime !== 'string' || typeof item.endTime !== 'string'
      || !Number.isFinite(Date.parse(item.startTime)) || !Number.isFinite(Date.parse(item.endTime))
      || Date.parse(item.endTime) < Date.parse(item.startTime)) throw new KeeperApiError(502, 'invalid keeper event');
    // Deliberate allowlist: no calendar account, location, description, URL or credentials leave the server.
    return { id: item.id.slice(0, 512), title: (item.title ?? '').slice(0, 1000), startTime: new Date(item.startTime).toISOString(), endTime: new Date(item.endTime).toISOString(), isAllDay: item.isAllDay === true };
  });
}
