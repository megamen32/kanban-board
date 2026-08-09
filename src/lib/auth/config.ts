import type { BoardScope } from './scopes';

export function oauthClientId(): string {
  return process.env.KANBAN_OAUTH_CLIENT_ID || 'chatgpt-kanban';
}

export function oauthRedirectUris(): string[] {
  return (process.env.KANBAN_OAUTH_REDIRECT_URIS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

export function isAllowedRedirectUri(value: string): boolean {
  return oauthRedirectUris().includes(value);
}

export function oauthClientSecret(): string | null {
  return process.env.KANBAN_OAUTH_CLIENT_SECRET || null;
}

export function uiScope(): BoardScope {
  return process.env.KANBAN_UI_SCOPE === 'personal' ? 'personal' : 'work';
}
