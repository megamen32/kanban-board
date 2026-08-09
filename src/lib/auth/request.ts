import type { NextRequest } from 'next/server';
import { AuthStore, type OAuthAccess } from './store';
import { uiScope } from './config';
import type { BoardScope } from './scopes';

export const SESSION_COOKIE = 'kanban_session';

export interface RequestIdentity {
  username: string;
  scope: BoardScope;
  accessToken?: OAuthAccess;
}

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
