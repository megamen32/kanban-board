import { NextRequest, NextResponse } from 'next/server';
import {
  AIRLOCK_RELAY_COOKIE,
  airlockRelayConfig,
  boardAccountForCaller,
  readRelayHandshake,
  relayCallerIdentity,
} from '../../../../../lib/auth/airlock-relay';
import { authStore, SESSION_COOKIE } from '../../../../../lib/auth/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Land after the official Airlock relay: the platform has consumed the
 * one-time relay code against its own nonce cookie, issued the agent-bound
 * `__air_session`, and redirected here with the platform-set
 * `X-Airlock-Caller` header. This route re-checks every link itself:
 *
 * - runs only on the configured agent origin (the Airlock subdomain proxy
 *   is the only writer of that header; any other host is a forged path),
 * - requires the app's own one-time handshake cookie minted by the login
 *   route in this browser (state-bound, single-use, short-lived),
 * - accepts identity only from a platform-attributed `user` caller with
 *   platform membership; client usernames and headers are never identity,
 * - maps through an explicit allow-list to an existing board account and
 *   mints an ordinary work-board session. Nothing is created, no owner
 *   role is inherited, and no card or task is touched.
 */
export async function GET(request: NextRequest) {
  const config = airlockRelayConfig();
  if (!config.enabled) {
    return NextResponse.json({ error: 'airlock relay login is not configured' }, { status: 404 });
  }
  const host = (request.headers.get('x-forwarded-host') || request.headers.get('host') || '').toLowerCase();
  if (host !== new URL(config.agentOrigin).host.toLowerCase()) {
    return NextResponse.json({ error: 'airlock relay callback is bound to the agent origin' }, { status: 404 });
  }

  const handshake = request.cookies.get(AIRLOCK_RELAY_COOKIE)?.value;
  const verified = readRelayHandshake(handshake);
  if (!verified.ok) {
    return NextResponse.json({ error: 'airlock login handshake is missing or expired' }, { status: 403 });
  }

  const identity = relayCallerIdentity(request.headers.get('x-airlock-caller'));
  if (!identity) {
    return NextResponse.json({ error: 'airlock caller identity could not be verified' }, { status: 403 });
  }

  const account = boardAccountForCaller(identity);
  if (!account) {
    return NextResponse.json({ error: 'this airlock account is not enrolled on the board' }, { status: 403 });
  }

  let session: string;
  try {
    session = authStore().createRelaySession(account.username);
  } catch {
    return NextResponse.json({ error: 'board session could not be created' }, { status: 503 });
  }

  const response = NextResponse.redirect(new URL('/', config.agentOrigin), { status: 307 });
  response.cookies.set(SESSION_COOKIE, session, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 8 * 60 * 60,
  });
  response.cookies.set(AIRLOCK_RELAY_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
    maxAge: 0,
  });
  return response;
}
