export const DEFAULT_SCOPE = 'work' as const;
export const BOARD_SCOPES = ['work', 'personal'] as const;

export type BoardScope = (typeof BOARD_SCOPES)[number];

/** Parse OAuth scope text and require at most one board data boundary. */
export function parseScope(scopeText: string | null | undefined): BoardScope {
  const scopes = (scopeText ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter((scope) => scope !== 'openid');

  if (scopes.length === 0) return DEFAULT_SCOPE;
  const boardScopes = scopes.map((scope) => {
    if (scope === 'kanban:work') return 'work' as const;
    if (scope === 'kanban:personal') return 'personal' as const;
    throw new Error(`unsupported scope: ${scope}`);
  });
  if (new Set(boardScopes).size !== 1) throw new Error('one board scope is required');
  return boardScopes[0];
}

export function scopePermission(tokenScope: BoardScope, requestedScope: BoardScope): boolean {
  return tokenScope === requestedScope;
}

export function oauthScope(scope: BoardScope): string {
  return scope === 'work' ? 'kanban:work' : 'kanban:personal';
}
