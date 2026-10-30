import type { NextRequest } from 'next/server';
import { createHash, timingSafeEqual } from 'node:crypto';
import { AuthStore, type OAuthAccess } from './store';
import { uiScope } from './config';
import type { BoardScope } from './scopes';
import { AIRLOCK_TODO_NATIVE_IDENTITY_HEADER } from './airlock-native-identity';
import { nativeProjectAccessForRequest, type NativeProjectAccessContext } from '../kanban/native-project-access';

export const SESSION_COOKIE = 'kanban_session';

export interface RequestIdentity {
  username: string;
  scope: BoardScope;
  accessToken?: OAuthAccess;
}

const ANONYMOUS_USERNAME = 'anonymous';

export function authStore(): AuthStore {
  return new AuthStore();
}

export function identityFromRequest(request: NextRequest): RequestIdentity | null {
  const authorization = request.headers.get('authorization') || '';
  if (authorization.startsWith('Bearer ')) {
    const accessToken = authStore().validateAccessToken(authorization.slice('Bearer '.length).trim());
    if (accessToken) return { username: accessToken.username, scope: accessToken.scope, accessToken };
  }
  const session = request.cookies.get(SESSION_COOKIE)?.value;
  if (!session) return null;
  const username = authStore().validateSession(session);
  return username ? { username, scope: uiScope() } : null;
}

/**
 * Resolve the identity used by the human-facing board. OAuth endpoints must
 * continue using identityFromRequest so ChatGPT authorization remains gated.
 */
export function boardIdentityFromRequest(request: NextRequest): RequestIdentity {
  return identityFromRequest(request) ?? { username: ANONYMOUS_USERNAME, scope: uiScope() };
}

/** Authenticate the narrow service-to-service manager capability. */
export function managerRequestAuthorized(request: NextRequest): boolean {
  const expected = process.env.KANBAN_MANAGER_TOKEN?.trim();
  const provided = request.headers.get('x-kanban-manager-token')?.trim();
  if (!expected || !provided) return false;
  const expectedHash = createHash('sha256').update(expected).digest();
  const providedHash = createHash('sha256').update(provided).digest();
  return timingSafeEqual(expectedHash, providedHash);
}

/** Authenticate the separate automation capability; an unset or empty token disables it. */
export function automationTokenValid(request: Request): boolean {
  const expected = process.env.KANBAN_AUTOMATION_TOKEN?.trim();
  const provided = request.headers.get('x-kanban-automation-token')?.trim();
  if (!expected || !provided) return false;
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  if (expectedBytes.length !== providedBytes.length) return false;
  return timingSafeEqual(expectedBytes, providedBytes);
}

/**
 * Resolve only the signed native caller on this exact request. With no
 * assertion this preserves the existing Board identity path; a present bad
 * assertion or missing trusted server configuration never falls back.
 */
export async function nativeProjectAccessContextFromRequest(request: Request): Promise<NativeProjectAccessContext | null> {
  if (!request.headers.has(AIRLOCK_TODO_NATIVE_IDENTITY_HEADER)) return null;
  const publicKey = process.env.AIRLOCK_TODO_NATIVE_IDENTITY_PUBLIC_KEY?.trim();
  const endpoint = process.env.EXMANAGER_TODO_PROJECT_SCOPE_URL?.trim();
  if (!publicKey || !endpoint) throw new Error('native_identity_unconfigured');
  return nativeProjectAccessForRequest(request, { endpoint, publicKey });
}
