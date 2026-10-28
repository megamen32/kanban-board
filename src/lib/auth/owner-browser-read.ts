import type { NextRequest } from 'next/server';
import { airlockRelayConfig } from './airlock-relay';
import { AIRLOCK_TODO_NATIVE_IDENTITY_HEADER, verifyAirlockTodoNativeIdentity } from './airlock-native-identity';
import { boardHumanIdentityFromRequest } from './board-human';

/**
 * Use the Board owner's already granted browser read access only when a
 * signed native caller and the verified human browser session identify that
 * same configured owner. All other native calls use the regular project
 * resolver, which remains fail-closed.
 */
export async function ownerBrowserReadAllowed(request: NextRequest): Promise<boolean> {
  if (!request.headers.has(AIRLOCK_TODO_NATIVE_IDENTITY_HEADER)) return false;

  const publicKey = process.env.AIRLOCK_TODO_NATIVE_IDENTITY_PUBLIC_KEY?.trim();
  if (!publicKey) throw new Error('native_identity_unconfigured');

  // Verify a present assertion before consulting any browser identity. A bad
  // or stale assertion must never fall through to a valid owner cookie.
  const assertion = await verifyAirlockTodoNativeIdentity(request, publicKey);
  if (!assertion) return false;

  const configuredOwner = airlockRelayConfig().accountMap[assertion.userId.toLowerCase()] === 'nikita';
  const human = await boardHumanIdentityFromRequest(request);
  // A native-only caller without a Board human session stays on the existing
  // native project resolver path; it never inherits this browser grant.
  if (!human) return false;
  const verifiedOwner = human?.scope === 'work' && human.username === 'nikita';

  if (configuredOwner !== verifiedOwner && (configuredOwner || verifiedOwner)) {
    throw new Error('native_owner_read_mismatch');
  }
  return configuredOwner && verifiedOwner;
}
