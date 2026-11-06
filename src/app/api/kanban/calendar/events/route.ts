import { NextRequest, NextResponse } from 'next/server';
import { boardHumanIdentityFromRequest } from '@/lib/auth/board-human';
import { calendarBridgeUsername, keeperCalendarApiUrl, keeperCalendarPublicUrl, type BridgeIdentity } from '@/lib/kanban/keeper-config';
import { keeperCredentialForUser } from '@/lib/kanban/keeper-credentials';
import { keeperReadEvents } from '@/lib/kanban/keeper-events';
import { validCalendarDay, validTimeZone, shiftDay } from '@/lib/kanban/board-calendar';

export const dynamic = 'force-dynamic';
function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization' } });
}
export async function GET(req: NextRequest) {
  if (req.headers.has('authorization')) return reply({ error: 'service_bearer_forbidden' }, 403);
  const identity = await boardHumanIdentityFromRequest(req);
  const username = calendarBridgeUsername(identity as BridgeIdentity | null);
  if (!username) return reply({ error: identity ? 'calendar_bridge_not_available_for_account' : 'authentication required' }, identity ? 403 : 401);
  const from = req.nextUrl.searchParams.get('from') ?? '';
  const to = req.nextUrl.searchParams.get('to') ?? '';
  const timeZone = req.nextUrl.searchParams.get('timezone') ?? '';
  if (!validCalendarDay(from) || !validCalendarDay(to) || !validTimeZone(timeZone)
    || to <= from || Date.parse(to) - Date.parse(from) > 43 * 86400000) return reply({ error: 'invalid_calendar_range' }, 400);
  const baseUrl = keeperCalendarApiUrl();
  if (!baseUrl) return reply({ state: 'disabled', subject: username, events: [] });
  try {
    const credential = await keeperCredentialForUser(username);
    if (!credential) return reply({ state: 'not_connected', subject: username, events: [], publicUrl: keeperCalendarPublicUrl() });
    // Pad the UTC fetch window for every IANA zone. The UI filters the requested civil days.
    const events = await keeperReadEvents(baseUrl, credential.bearer, credential.calendarId,
      shiftDay(from, -1) + 'T00:00:00.000Z', shiftDay(to, 1) + 'T00:00:00.000Z', timeZone);
    return reply({ state: 'connected', subject: username, events });
  } catch {
    // Never return an upstream error body, token, calendar ID or credential-store detail.
    return reply({ error: 'personal_calendar_unavailable' }, 502);
  }
}
