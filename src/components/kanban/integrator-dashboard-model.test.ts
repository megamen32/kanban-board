import { describe, expect, it } from 'vitest';
import {
  executionOperationStorageKey,
  canRetrySameOperation,
  canContinueTask,
  executionSignalLabel,
  executionStartRequest,
  executionSyncRequest,
  getCatalogLinkDisplay,
  getDashboardCounts,
  getLatestResult,
  isVerifiedSessionUrl,
  parseExecutionSnapshot,
  parseStoredStartOperation,
  taskFollowUpRequest,
  taskFollowUpSyncRequest,
} from './integrator-dashboard-model';
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

  it('uses server readiness and keeps the start request limited to version plus operation ID', () => {
    expect(parseExecutionSnapshot({ cardId: 'task-1', state: 'not-started', startAvailable: true }, 'task-1')?.startAvailable).toBe(true);
    expect(parseExecutionSnapshot({ cardId: 'task-1', state: 'not-started', startAvailable: false, unavailableReason: 'Not configured' }, 'task-1'))
      .toMatchObject({ startAvailable: false, unavailableReason: 'Not configured' });
    expect(executionStartRequest(7, 'a'.repeat(32))).toEqual({ expectedVersion: 7, operationId: 'a'.repeat(32) });
    expect(Object.keys(executionStartRequest(7, 'a'.repeat(32))).sort()).toEqual(['expectedVersion', 'operationId']);
    expect(executionSyncRequest('a'.repeat(32), 8)).toEqual({ action: 'sync-result', operationId: 'a'.repeat(32), expectedVersion: 8 });
  });

  it('offers one generic task continuation only for the unchanged result awaiting review', () => {
    const receipt = {
      operationId: 'a'.repeat(64), requestHash: 'b'.repeat(64), lastBoardVersion: 8,
      createInputId: 'c'.repeat(64), messageInputId: 'd'.repeat(64), phase: 'result' as const,
      hostId: 'roomhacker-server-100', harness: 'codex' as const, nativeSessionId: 'session-1', nativeTurnId: 'turn-1',
      startedBy: 'nikita', createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z',
    };
    const reviewCard = card({ column: 'review', needsReview: true, version: 8, taskExecutionHistory: [receipt] });
    expect(canContinueTask(reviewCard)).toBe(true);
    expect(taskFollowUpRequest(receipt.operationId, 8, 'find public sources')).toEqual({
      action: 'continue-task', operationId: receipt.operationId, expectedVersion: 8, continuationText: 'find public sources',
    });
    expect(taskFollowUpSyncRequest(receipt.operationId, 'e'.repeat(64), 9)).toEqual({
      action: 'sync-task-continuation', operationId: receipt.operationId,
      continuationId: 'e'.repeat(64), expectedVersion: 9,
    });
    expect(canContinueTask(card({ ...reviewCard, version: 9 }))).toBe(false);
    expect(canContinueTask(card({ ...reviewCard, column: 'todo' }))).toBe(false);
    expect(canContinueTask(card({ ...reviewCard, needsReview: false }))).toBe(false);
    expect(canContinueTask(card({ ...reviewCard, taskExecutionHistory: [{
      ...receipt, continuations: [{ id: 'e'.repeat(64), kind: 'task-follow-up-v1', instruction: 'follow up', inputId: 'f'.repeat(64),
        requestHash: '1'.repeat(64), phase: 'unknown' as const, createdAt: receipt.createdAt, updatedAt: receipt.updatedAt }],
    }] }))).toBe(false);
  });

  it('persists a valid per-card operation identity and rejects malformed stored data', () => {
    const saved = { operationId: 'a'.repeat(32), status: 'unknown' as const };
    expect(executionOperationStorageKey('task/one')).toBe('kanban:task-execution:task%2Fone');
    expect(parseStoredStartOperation(JSON.stringify(saved))).toEqual(saved);
    expect(parseStoredStartOperation(null)).toBeNull();
    expect(parseStoredStartOperation('{broken')).toBe('invalid');
    expect(parseStoredStartOperation(JSON.stringify({ operationId: 'short', status: 'pending' }))).toBe('invalid');
  });

  it('allows an explicit same-key retry only after a current not-started readiness read', () => {
    const saved = { operationId: 'c5419ca2-62c3-4183-86bc-7bff0343a194', status: 'unknown' as const };
    const ready = parseExecutionSnapshot({ cardId: 'task-1', state: 'not-started', startAvailable: true }, 'task-1');
    expect(canRetrySameOperation(saved, ready)).toBe(true);
    expect(executionStartRequest(4, saved.operationId)).toEqual({
      expectedVersion: 4,
      operationId: 'c5419ca2-62c3-4183-86bc-7bff0343a194',
    });
    expect(canRetrySameOperation(saved, parseExecutionSnapshot({ cardId: 'task-1', state: 'running', startAvailable: true }, 'task-1'))).toBe(false);
    expect(canRetrySameOperation(saved, parseExecutionSnapshot({ cardId: 'task-1', state: 'not-started', startAvailable: false }, 'task-1'))).toBe(false);
    expect(canRetrySameOperation({ ...saved, status: 'admitted' }, ready)).toBe(false);
    expect(canRetrySameOperation('invalid', ready)).toBe(false);
  });

  it('projects only the stored immutable catalog references, never live relationship state', () => {
    const catalogLink = {
      version: 1 as const,
      taskId: 'task-1',
      operationRef: 'catalog-operation-1',
      boardVersion: 4,
      sourceRef: 'source-event-2',
      sourceRevision: 'source-rev-3',
      projectId: 'catalog-project-7',
      planIds: ['plan-1'],
      gateIds: ['gate-2'],
      contactIds: ['contact-3'],
      catalogRevision: 'catalog-rev-9',
    };
    const display = getCatalogLinkDisplay(card({ catalogLink }));
    expect(display).toEqual({
      projectId: 'catalog-project-7', planIds: ['plan-1'], gateIds: ['gate-2'], contactIds: ['contact-3'],
      sourceRef: 'source-event-2', sourceRevision: 'source-rev-3', catalogRevision: 'catalog-rev-9', boardVersion: 4,
    });
    expect(Object.keys(display ?? {}).sort()).toEqual([
      'boardVersion', 'catalogRevision', 'contactIds', 'gateIds', 'planIds', 'projectId', 'sourceRef', 'sourceRevision',
    ]);
    expect(getCatalogLinkDisplay(card())).toBeNull();
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
