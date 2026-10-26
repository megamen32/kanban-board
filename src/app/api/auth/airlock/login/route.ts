import { NextRequest, NextResponse } from 'next/server';
import {
  airlockRelayConfig,
  airlockRelayLoginUrl,
  AIRLOCK_RELAY_COOKIE,
  createRelayHandshake,
  relayHandshakeCookie,
} from '../../../../../lib/auth/airlock-relay';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Start the official Airlock nonce-bound login relay. Enabled only when the
 * deployment configures the Airlock relay URL and this board's agent origin;
 * every other deployment returns 404 so the route cannot be probed into a
 * redirect oracle.
 */
export async function GET(request: NextRequest) {
  const config = airlockRelayConfig();
  if (!config.enabled) return NextResponse.json({ error: 'airlock relay login is not configured' }, { status: 404 });
  const requestedPath = request.nextUrl.searchParams.get('next') || '/';
  // Only same-origin relative paths are honored as the post-login target.
  const nextPath = requestedPath.startsWith('/') && !requestedPath.startsWith('//') ? requestedPath : '/';
  const handshake = createRelayHandshake(config, nextPath);
  const response = NextResponse.redirect(airlockRelayLoginUrl(config, handshake));
  response.cookies.set(AIRLOCK_RELAY_COOKIE, relayHandshakeCookie(handshake), {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
    maxAge: 10 * 60,
  });
  return response;
}
