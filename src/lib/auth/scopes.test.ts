import { describe, expect, it } from 'vitest';
import { DEFAULT_SCOPE, parseScope, scopePermission, type BoardScope } from './scopes';

describe('kanban auth scopes', () => {
  it('defaults OAuth consent to work', () => {
    expect(DEFAULT_SCOPE).toBe('work');
    expect(parseScope(undefined)).toBe('work');
    expect(parseScope('')).toBe('work');
  });

  it('accepts only one explicit board scope', () => {
    expect(parseScope('kanban:work')).toBe('work');
    expect(parseScope('kanban:personal')).toBe('personal');
    expect(() => parseScope('kanban:work kanban:personal')).toThrow(/one board scope/i);
    expect(() => parseScope('admin')).toThrow(/unsupported scope/i);
  });

  it('does not allow a token to access another board scope', () => {
    const tokenScope: BoardScope = 'work';
    expect(scopePermission(tokenScope, 'work')).toBe(true);
    expect(scopePermission(tokenScope, 'personal')).toBe(false);
  });
});
