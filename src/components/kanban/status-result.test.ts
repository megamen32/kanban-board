import { describe, expect, it } from 'vitest';
import { statusSaveError } from './status-result';

// Fast unit: prevent silent optimistic rollback; expected <1s, maximum 10s.
describe('notebook status save result', () => {
  it('accepts the actual saved status', () => {
    expect(statusSaveError({ column: 'done' }, 'done')).toBeNull();
    expect(statusSaveError({ column: 'todo' }, 'todo')).toBeNull();
  });
  it('shows redirected completion instead of treating a card as success', () => {
    expect(statusSaveError({ column: 'review' }, 'done')).toContain('не завершена');
  });
  it('explains why a task cannot move into the blocked lane without a reason', () => {
    expect(statusSaveError({ error: 'blocked_reason_required' }, 'blocked')).toContain('что мешает');
  });
  it('shows missing and conflicting results', () => {
    expect(statusSaveError(null, 'done')).toContain('не сохранён');
    expect(statusSaveError({ column: 'todo' }, 'done')).toContain('другой статус');
  });
});
