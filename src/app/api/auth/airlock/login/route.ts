import { NextRequest, NextResponse } from 'next/server';
import {
  AIRLOCK_TODO_NATIVE_IDENTITY_HEADER,
  verifyAirlockTodoNativeIdentity,
} from '../../../../../lib/auth/airlock-native-identity';
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
  // The SDK has already admitted native users. Verify its request-bound
  // assertion before keeping the existing board handshake on this app origin.
  let nativeLogin = false;
  if (request.headers.has(AIRLOCK_TODO_NATIVE_IDENTITY_HEADER)) {
    const host = (request.headers.get('x-forwarded-host') || request.headers.get('host') || '').toLowerCase();
    if (host !== new URL(config.agentOrigin).host.toLowerCase()) {
      return NextResponse.json({ error: 'airlock login is bound to the agent origin' }, { status: 404 });
    }
    const publicKey = process.env.AIRLOCK_TODO_NATIVE_IDENTITY_PUBLIC_KEY?.trim();
    if (!publicKey) {
      return NextResponse.json({ error: 'airlock native identity verifier is not configured' }, { status: 503 });
    }
    try {
      const identity = await verifyAirlockTodoNativeIdentity(request, publicKey);
      if (!identity || identity.project !== '') throw new Error('native_identity_invalid');
    } catch {
      return NextResponse.json({ error: 'airlock caller identity could not be verified' }, { status: 403 });
    }
    nativeLogin = true;
  }
  const requestedPath = request.nextUrl.searchParams.get('next') || '/';
  // Only same-origin relative paths are honored as the post-login target.
  const nextPath = requestedPath.startsWith('/') && !requestedPath.startsWith('//') ? requestedPath : '/';
  const handshake = createRelayHandshake(config, nextPath);
  const response = NextResponse.redirect(nativeLogin
    ? new URL('/api/auth/airlock/callback', config.agentOrigin)
    : airlockRelayLoginUrl(config, handshake));
  response.cookies.set(AIRLOCK_RELAY_COOKIE, relayHandshakeCookie(handshake), {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
    maxAge: 10 * 60,
  });
  return response;
}
