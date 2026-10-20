import { describe, expect, it } from 'vitest';
import { executionSignalLabel, getDashboardCounts, getLatestResult, isVerifiedSessionUrl, parseExecutionSnapshot } from './integrator-dashboard-model';
import type { KanbanCard } from '@/lib/kanban/types';

const card = (overrides: Partial<KanbanCard> = {}): KanbanCard => ({
  id: 'task-1', title: 'Task', description: 'Expected result', column: 'todo', priority: 'medium',
  tags: [], order: 0, created: '2026-10-20T00:00:00Z', updated: '2026-10-20T00:00:00Z',
  fileName: 'task.md', version: 1, project: 'Project', assignees: [], ...overrides,
});

describe('integrator dashboard model', () => {
  it('accepts only a matching execution snapshot and known state', () => {
    expect(parseExecutionSnapshot({ cardId: 'task-1', state: 'running' }, 'task-1')?.state).toBe('running');
    expect(parseExecutionSnapshot({ cardId: 'task-2', state: 'running' }, 'task-1')).toBeNull();
    expect(parseExecutionSnapshot({ cardId: 'task-1', state: 'done' }, 'task-1')).toBeNull();
  });

  it('counts persisted business/review/result state without inferring executor activity', () => {
    const cards = [
      card({ column: 'review', needsReview: true, resultHistory: [{ summary: 'result', evidenceRefs: [], submittedBy: 'opaque', submittedAt: '2026-10-20T01:00:00Z' }] }),
      card({ id: 'blocked', column: 'blocked' }),
      card({ id: 'done', column: 'done' }),
    ];
    expect(getDashboardCounts(cards)).toEqual({ active: 2, review: 1, blocked: 1, withResults: 1 });
    expect(getLatestResult(cards[0])?.summary).toBe('result');
  });

  it('allows only secure links on the verified native session host', () => {
    expect(isVerifiedSessionUrl('https://agent.bezrabotnyi.com/session/abc')).toBe(true);
    expect(isVerifiedSessionUrl('javascript:alert(1)')).toBe(false);
    expect(isVerifiedSessionUrl('https://example.com/session/abc')).toBe(false);
  });

  it('does not present a Board in-progress marker as a live worker heartbeat', () => {
    expect(executionSignalLabel('running')).toContain('активная сессия не подтверждена');
  });
});
