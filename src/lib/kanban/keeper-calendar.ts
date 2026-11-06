import type { CalendarEventBinding } from './keeper-bindings';

/**
 * Server-side Keeper.sh calendar adapter for the official REST contract:
 * POST /api/v1/events {calendarId,title,startTime,endTime}, PATCH/DELETE
 * /api/v1/events/{id}. The bearer is a strictly per-user credential resolved
 * by the caller (credential lookup); the adapter only ever holds it inside the
 * outgoing request and never returns it, logs it or stores it.
 */

export interface KeeperCredential {
  /** Per-user Keeper bearer token (kpr_...), server-side only. */
  bearer: string;
  /** The connected user's own calendar id from GET /api/v1/calendars. */
  calendarId: string;
}

export type KeeperCredentialLookup = (username: string) => Promise<KeeperCredential | null>;

/**
 * v1 credential source: no Keeper account is connected for anyone yet. The
 * real OAuth handoff replaces this lookup only — until then every bridge call
 * must answer `keeper_not_connected` instead of inventing a token.
 */
export const noKeeperCredentials: KeeperCredentialLookup = async () => null;

export class KeeperApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'KeeperApiError';
  }
}

export class KeeperNotConnectedError extends Error {
  constructor(readonly username: string) {
    super('keeper account is not connected');
    this.name = 'KeeperNotConnectedError';
  }
}

export interface KeeperEventInput {
  calendarId: string;
  title: string;
  startTime: string;
  endTime: string;
}

export interface KeeperEventResult {
  eventId: string;
  /** Public event link when the Keeper response exposes one. */
  eventUrl?: string;
}

const REQUEST_TIMEOUT_MS = 10_000;

function keeperHeaders(bearer: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` };
}

function eventUrlFrom(payload: Record<string, unknown>): string | undefined {
  const candidate = payload.url ?? payload.eventUrl ?? payload.htmlLink;
  return typeof candidate === 'string' && candidate.trim() ? candidate : undefined;
}

function eventIdFrom(payload: Record<string, unknown>): string {
  const candidate = payload.id ?? payload.eventId;
  if (typeof candidate !== 'string' || !candidate.trim() || candidate.length > 512) {
    throw new KeeperApiError(502, 'keeper event response has no usable event id');
  }
  return candidate;
}

async function keeperResponse(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) {
    throw new KeeperApiError(response.status, `keeper API returned ${response.status}`);
  }
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    const payload = JSON.parse(text) as unknown;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new KeeperApiError(502, 'keeper API returned a non-object response');
    }
    return payload as Record<string, unknown>;
  } catch (error) {
    if (error instanceof KeeperApiError) throw error;
    throw new KeeperApiError(502, 'keeper API returned invalid JSON');
  }
}

export async function keeperCreateEvent(baseUrl: string, bearer: string, input: KeeperEventInput): Promise<KeeperEventResult> {
  const response = await fetch(`${baseUrl}/api/v1/events`, {
    method: 'POST',
    headers: keeperHeaders(bearer),
    body: JSON.stringify({ calendarId: input.calendarId, title: input.title, startTime: input.startTime, endTime: input.endTime }),
    cache: 'no-store',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload = await keeperResponse(response);
  return { eventId: eventIdFrom(payload), ...(eventUrlFrom(payload) ? { eventUrl: eventUrlFrom(payload) } : {}) };
}

export async function keeperUpdateEvent(baseUrl: string, bearer: string, eventId: string, input: KeeperEventInput): Promise<KeeperEventResult> {
  const response = await fetch(`${baseUrl}/api/v1/events/${encodeURIComponent(eventId)}`, {
    method: 'PATCH',
    headers: keeperHeaders(bearer),
    body: JSON.stringify({ calendarId: input.calendarId, title: input.title, startTime: input.startTime, endTime: input.endTime }),
    cache: 'no-store',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload = await keeperResponse(response);
  // PATCH may answer with the event or an empty body; the board-side id wins.
  const candidate = payload.id ?? payload.eventId;
  const updatedId = typeof candidate === 'string' && candidate.trim() && candidate.length <= 512 ? candidate : eventId;
  return { eventId: updatedId, ...(eventUrlFrom(payload) ? { eventUrl: eventUrlFrom(payload) } : {}) };
}

export async function keeperDeleteEvent(baseUrl: string, bearer: string, eventId: string): Promise<void> {
  const response = await fetch(`${baseUrl}/api/v1/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
    headers: keeperHeaders(bearer),
    cache: 'no-store',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  await keeperResponse(response);
}

export interface CalendarSyncInput {
  title: string;
  /** sha256 hex of the exact event title. */
  titleHash: string;
  startTime: string;
  endTime: string;
}

export type CalendarSyncDecision =
  | { action: 'none'; binding: CalendarEventBinding }
  | { action: 'create' }
  | { action: 'patch'; binding: CalendarEventBinding };

/**
 * Duplicate-safe sync decision: an unchanged synced window and title are
 * answered from the stored receipt without touching Keeper, any change
 * patches the existing event, and only an unsynced card creates an event.
 */
export function calendarSyncDecision(existing: CalendarEventBinding | undefined, input: CalendarSyncInput): CalendarSyncDecision {
  if (!existing) return { action: 'create' };
  // Receipts written before title hashing carry no titleHash: window-only fallback.
  const titleMatches = existing.titleHash === undefined || existing.titleHash === input.titleHash;
  const sameWindow = existing.startTime === input.startTime
    && existing.endTime === input.endTime
    && titleMatches;
  return sameWindow ? { action: 'none', binding: existing } : { action: 'patch', binding: existing };
}
