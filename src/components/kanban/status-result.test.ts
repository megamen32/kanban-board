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
  it('shows missing and conflicting results', () => {
    expect(statusSaveError(null, 'done')).toContain('не сохранён');
    expect(statusSaveError({ column: 'todo' }, 'done')).toContain('другой статус');
  });
});
