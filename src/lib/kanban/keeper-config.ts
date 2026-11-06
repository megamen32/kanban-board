/**
 * Keeper calendar configuration. Only non-secret endpoints live here: the
 * private LAN upstream and the optional public base URL for event links.
 * Bearer credentials are never configured through environment variables —
 * they belong to a per-user credential source (future OAuth), resolved
 * server-side at request time and never persisted in code, config, Markdown
 * or the browser.
 */
export function keeperCalendarApiUrl(): string | null {
  const value = (process.env.KEEPER_API_URL || '').trim().replace(/\/+$/, '');
  if (!value) return null;
  if (!/^https?:\/\/.+/i.test(value)) return null;
  return value;
}

export function keeperCalendarPublicUrl(): string | null {
  const value = (process.env.KEEPER_PUBLIC_URL || '').trim().replace(/\/+$/, '');
  if (!value) return null;
  if (!/^https?:\/\/.+/i.test(value)) return null;
  return value;
}

export function keeperCalendarEnabled(): boolean {
  return keeperCalendarApiUrl() !== null;
}

export interface BridgeIdentity {
  username: string;
  scope: 'work' | 'personal';
}

/**
 * The calendar bridge is for the board's human owners only. Service bearers
 * never reach this layer (rejected earlier), and other verified accounts get
 * a clear refusal instead of access to a calendar they do not own.
 */
export function calendarBridgeUsername(identity: BridgeIdentity | null): string | null {
  if (!identity || identity.scope !== 'work') return null;
  return ['nikita', 'oleg'].includes(identity.username) ? identity.username : null;
}
