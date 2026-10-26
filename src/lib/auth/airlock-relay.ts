import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Official Airlock nonce-bound login relay for the board.
 *
 * The flow mirrors the Airlock platform's own relay contract
 * (frontend AuthRelayView -> POST /auth/relay-code -> /__air/callback):
 *
 * 1. `GET /api/auth/airlock/login` mints a fresh 32-byte nonce, records its
 *    SHA-256 hash in short-lived server state plus a host-only cookie, and
 *    redirects the browser to the official Airlock relay page with
 *    `return` + `nonce`.
 * 2. The relay page (on the Airlock main domain) exchanges the nonce for a
 *    one-time relay code bound to the authenticated Airlock user; the
 *    platform consumes the code at `/__air/callback` on the agent origin,
 *    verifies its own nonce cookie, issues the agent-bound `__air_session`,
 *    and redirects back to `GET /api/auth/airlock/callback`.
 * 3. The callback route accepts identity ONLY from the platform-set
 *    `X-Airlock-Caller` header on the configured agent origin, and only
 *    after the app handshake cookie proves this browser started the login
 *    here. Client usernames, `X-User-*` headers and body flags are never
 *    consulted. The verified platform user is mapped through an explicit
 *    allow-list to an existing board account; nothing is created and no
 *    owner roles are inherited.
 *
 * The handshake state is in-memory and single-process by design: it is
 * short-lived (minutes), restarting the app simply cancels pending logins,
 * and a multi-replica deployment must move it to shared storage first.
 */

export const AIRLOCK_RELAY_COOKIE = 'kanban_airlock_nonce';
const RELAY_HANDSHAKE_TTL_MS = 10 * 60_000;
const DEFAULT_RELAY_DOMAIN = 'bezrabotnyi.com';

export interface AirlockRelayConfig {
  enabled: boolean;
  relayUrl: string;
  agentOrigin: string;
  accountMap: Record<string, string>;
}

type Env = Record<string, string | undefined>;

export function airlockRelayConfig(env: Env = process.env): AirlockRelayConfig {
  const relayUrl = (env.KANBAN_AIRLOCK_RELAY_URL || '').trim();
  const agentOrigin = (env.KANBAN_AIRLOCK_AGENT_ORIGIN || '').trim().replace(/\/+$/, '');
  const relayDomain = (env.KANBAN_AIRLOCK_RELAY_DOMAIN || DEFAULT_RELAY_DOMAIN).trim().replace(/^\.+/, '');
  const config: AirlockRelayConfig = {
    enabled: false,
    relayUrl,
    agentOrigin,
    accountMap: parseAccountMap(env.KANBAN_AIRLOCK_ACCOUNT_MAP),
  };
  if (!relayUrl || !agentOrigin || !relayDomain) return config;
  try {
    const parsed = new URL(relayUrl);
    if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith(`.${relayDomain}`)) return config;
  } catch {
    return config;
  }
  try {
    const origin = new URL(agentOrigin);
    if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash) return config;
  } catch {
    return config;
  }
  config.enabled = true;
  return config;
}

function parseAccountMap(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const map: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== 'string') continue;
      const username = value.trim();
      if (!username || username.length > 64 || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(username)) continue;
      map[key.trim().toLowerCase()] = username;
    }
    return map;
  } catch {
    return {};
  }
}

export interface RelayHandshake {
  readonly nonceRaw: string;
  readonly nonceHash: string;
  readonly createdAtMs: number;
}

interface PendingHandshake {
  createdAtMs: number;
}

const pendingHandshakes = new Map<string, PendingHandshake>();

function pruneHandshakes(nowMs: number): void {
  for (const [hash, pending] of pendingHandshakes) {
    if (nowMs - pending.createdAtMs > RELAY_HANDSHAKE_TTL_MS || nowMs < pending.createdAtMs) pendingHandshakes.delete(hash);
  }
}

function relayNonceHash(nonceRaw: string): string {
  return createHash('sha256').update(`kanban-airlock-relay-v1\n${nonceRaw}`, 'utf8').digest('hex');
}

export function createRelayHandshake(_config: AirlockRelayConfig, _returnPath: string, nowMs = Date.now()): RelayHandshake {
  const nonceRaw = randomBytes(32).toString('base64url');
  const nonceHash = relayNonceHash(nonceRaw);
  pendingHandshakes.set(nonceHash, { createdAtMs: nowMs });
  pruneHandshakes(nowMs);
  return { nonceRaw, nonceHash, createdAtMs: nowMs };
}

export function airlockRelayLoginUrl(config: AirlockRelayConfig, handshake: RelayHandshake): string {
  const url = new URL(config.relayUrl);
  url.searchParams.set('return', `${config.agentOrigin}/api/auth/airlock/callback`);
  url.searchParams.set('nonce', handshake.nonceRaw);
  return url.toString();
}

export function relayHandshakeCookie(handshake: RelayHandshake): string {
  return `${handshake.nonceHash}.${handshake.createdAtMs}`;
}

export type RelayHandshakeRead =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'expired' | 'state-mismatch' };

/** Verify the browser-held handshake cookie against server state. One-time: the pending handshake is consumed on success. */
export function readRelayHandshake(cookieValue: string | undefined, nowMs = Date.now()): RelayHandshakeRead {
  if (!cookieValue) return { ok: false, reason: 'missing' };
  const dot = cookieValue.lastIndexOf('.');
  if (dot !== cookieValue.indexOf('.') || dot <= 0) return { ok: false, reason: 'state-mismatch' };
  const hash = cookieValue.slice(0, dot);
  const createdAtMs = Number(cookieValue.slice(dot + 1));
  if (!/^[a-f0-9]{64}$/.test(hash) || !Number.isFinite(createdAtMs) || createdAtMs <= 0) {
    return { ok: false, reason: 'state-mismatch' };
  }
  const pending = pendingHandshakes.get(hash);
  if (!pending) return { ok: false, reason: 'state-mismatch' };
  if (nowMs - pending.createdAtMs > RELAY_HANDSHAKE_TTL_MS || nowMs < pending.createdAtMs) {
    pendingHandshakes.delete(hash);
    return { ok: false, reason: 'expired' };
  }
  if (pending.createdAtMs !== createdAtMs) return { ok: false, reason: 'state-mismatch' };
  pendingHandshakes.delete(hash);
  return { ok: true };
}

export function relayNonceEquals(expectedHash: string, nonceRaw: string): boolean {
  const expected = Buffer.from(expectedHash, 'hex');
  const actual = Buffer.from(relayNonceHash(nonceRaw), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export interface RelayCallerIdentity {
  kind: 'user';
  userId: string;
  email: string;
  displayName: string;
  platformMember: boolean;
}

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord => !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * Decode the platform-set X-Airlock-Caller header. The Airlock subdomain
 * proxy deletes any client-supplied copy before setting its own, so on the
 * configured agent origin this is host-attributed by the platform. Every
 * deviation from the verified `user` shape returns null.
 */
export function relayCallerIdentity(headerValue: string | undefined | null): RelayCallerIdentity | null {
  if (!headerValue || headerValue.length > 16 * 1024) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(headerValue, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.kind !== 'user' || parsed.access !== 'user') return null;
  const user = isRecord(parsed.user) ? parsed.user : null;
  const initiator = isRecord(parsed.initiator) ? parsed.initiator : null;
  if (!user || !initiator) return null;
  const userId = typeof user.id === 'string' ? user.id.trim() : '';
  const email = typeof user.email === 'string' ? user.email.trim() : '';
  if (!userId || !email) return null;
  if (user.id !== initiator.id || user.platformMember !== true) return null;
  return {
    kind: 'user',
    userId,
    email,
    displayName: typeof user.displayName === 'string' ? user.displayName.trim() : '',
    platformMember: true,
  };
}

export interface RelayBoardAccount {
  username: string;
  scope: 'work' | 'personal';
}

/** Allow-listed mapping only: an unmapped platform user never becomes an account and never inherits owner roles. */
export function boardAccountForCaller(identity: RelayCallerIdentity, env: Env = process.env): RelayBoardAccount | null {
  const config = airlockRelayConfig(env);
  if (!config.enabled || identity.kind !== 'user' || !identity.platformMember) return null;
  const username = config.accountMap[identity.userId] ?? config.accountMap[identity.email.toLowerCase()];
  if (!username) return null;
  return { username, scope: 'work' };
}
