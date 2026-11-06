import { NextRequest, NextResponse } from 'next/server';
import { boardHumanIdentityFromRequest } from '@/lib/auth/board-human';
import { BridgeIdentity, calendarBridgeUsername, keeperCalendarEnabled, keeperCalendarPublicUrl } from '@/lib/kanban/keeper-config';
import { KeeperCredentialStoreError, keeperCredentialForUser } from '@/lib/kanban/keeper-credentials';

/**
 * Connection status for the calendar UI: whether the bridge is enabled, and
 * whether the CALLING user has connected their own Keeper account. The answer
 * is strictly per user; no tokens or calendar ids ever appear here.
 */
export async function GET(req: NextRequest) {
  // Bearer requests are service requests even when a cookie rides along.
  if (req.headers.has('authorization')) {
    return NextResponse.json({ error: 'service_bearer_forbidden' }, { status: 403 });
  }
  const identity = await boardHumanIdentityFromRequest(req);
  const username = calendarBridgeUsername(identity as BridgeIdentity | null);
  if (!username) {
    return NextResponse.json(
      { error: identity ? 'calendar_bridge_not_available_for_account' : 'authentication required' },
      { status: identity ? 403 : 401 },
    );
  }

  let connected = false;
  let storeUnavailable = false;
  try {
    connected = (await keeperCredentialForUser(username)) !== null;
  } catch (error) {
    // Fail closed honestly: the UI must show "unavailable", not a fake state.
    if (error instanceof KeeperCredentialStoreError) storeUnavailable = true;
    else throw error;
  }

  return NextResponse.json({
    enabled: keeperCalendarEnabled(),
    connected,
    publicUrl: keeperCalendarPublicUrl(),
    ...(storeUnavailable ? { storeUnavailable: true } : {}),
  });
}
