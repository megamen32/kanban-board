import { describe, expect, it } from 'vitest';
import { initialPlanningMetadata } from './initial-planning';
import { toDateTimeLocalValue } from '../../lib/kanban/date-input';
import type { KanbanCard } from '@/lib/kanban/types';

// Fast unit: stored ISO planning date must render in datetime-local; <1s/max5s.
describe('planning editor initial values', () => {
  it('converts the stored date to a valid local input value', () => {
    const date = '2026-10-12T12:00:00.000Z';
    const form = initialPlanningMetadata({ scheduledAt: date, todayRank: 1 } as KanbanCard);
    expect(form.scheduledAt).toBe(toDateTimeLocalValue(date));
    expect(form.scheduledAt).not.toContain('Z');
    expect(form.todayRank).toBe('1');
  });
  it('uses explicit empty editable optional fields without fabricating dates', () => {
    expect(initialPlanningMetadata({} as KanbanCard)).toMatchObject({ scheduledAt: '', waitingFor: '', role: '' });
  });
});
