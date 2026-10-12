import { describe, expect, it } from 'vitest';
import type { KanbanCard } from './types';
import { getRoleBalance } from './planning-views';

// Fast unit: saved personal roles drive balance; <1s/max5s.
describe('personal role balance', () => {
  it('shows configured custom roles and counts their actual tasks', () => {
    const card = { id: 'qa', role: 'own-custom', column: 'todo', type: 'action', week: '2026-W42', bigRock: true } as KanbanCard;
    const result = getRoleBalance([card], '2026-10-12T12:00:00+03:00', [{ id: 'own-custom', label: 'Own QA role', order: 0 }]);
    expect(result['own-custom']).toEqual({ activeActions: ['qa'], acceptedBigRocks: ['qa'], warning: false });
  });
  it('retains legacy tasks under the configured default-role identity without rewriting data', () => {
    const card = { id: 'qa', role: 'product-builder', column: 'todo', type: 'action' } as KanbanCard;
    expect(getRoleBalance([card], '2026-10-12', [{ id: 'nikita-1', label: 'Default role', order: 0 }])['nikita-1'].activeActions).toEqual(['qa']);
  });
});
