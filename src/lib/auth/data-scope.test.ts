import { describe, expect, it } from 'vitest';
import { tasksDirForScope } from './data-scope';

describe('scoped task roots', () => {
  it('resolves only named work/personal roots', () => {
    const previous = process.env.KANBAN_SCOPE_ROOT;
    process.env.KANBAN_SCOPE_ROOT = '/app/data/scopes';
    expect(tasksDirForScope('work')).toBe('/app/data/scopes/work');
    expect(tasksDirForScope('personal')).toBe('/app/data/scopes/personal');
    process.env.KANBAN_SCOPE_ROOT = previous;
  });

  it('fails closed when personal data is not mounted', () => {
    const previous = process.env.KANBAN_SCOPE_ROOT;
    delete process.env.KANBAN_SCOPE_ROOT;
    expect(() => tasksDirForScope('personal')).toThrow(/not configured/i);
    process.env.KANBAN_SCOPE_ROOT = previous;
  });
});
