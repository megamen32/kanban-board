import { NextRequest, NextResponse } from 'next/server';
import { boardHumanIdentityFromRequest } from '@/lib/auth/board-human';
import { AIRLOCK_TODO_NATIVE_IDENTITY_HEADER, verifyAirlockTodoNativeIdentity } from '@/lib/auth/airlock-native-identity';
import { airlockRelayConfig } from '@/lib/auth/airlock-relay';

export async function GET(request: NextRequest) {
  let nativeAccount: string | undefined;
  if (request.headers.has(AIRLOCK_TODO_NATIVE_IDENTITY_HEADER)) {
    const config = airlockRelayConfig();
    const host = (request.headers.get('x-forwarded-host') || request.headers.get('host') || '').toLowerCase();
    if (!config.enabled || host !== new URL(config.agentOrigin).host.toLowerCase()) {
      return NextResponse.json({ authenticated: false }, { status: 404 });
    }
    const publicKey = process.env.AIRLOCK_TODO_NATIVE_IDENTITY_PUBLIC_KEY?.trim();
    if (!publicKey) return NextResponse.json({ authenticated: false }, { status: 503 });
    try {
      const assertion = await verifyAirlockTodoNativeIdentity(request, publicKey);
      if (!assertion || assertion.project !== '') {
        return NextResponse.json({ authenticated: false }, { status: 403 });
      }
      nativeAccount = config.accountMap[assertion.userId.toLowerCase()];
      if (!nativeAccount) return NextResponse.json({ authenticated: false }, { status: 403 });
    } catch {
      return NextResponse.json({ authenticated: false }, { status: 403 });
    }
  }
  const identity = await boardHumanIdentityFromRequest(request);
  // A stale Board cookie must enter the existing native handshake, never
  // make AuthGate admit a different user than the signed native caller.
  if (!identity || (nativeAccount && (identity.username !== nativeAccount || identity.scope !== 'work'))) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
  return NextResponse.json({ authenticated: true, username: identity.username, scope: identity.scope });
}
