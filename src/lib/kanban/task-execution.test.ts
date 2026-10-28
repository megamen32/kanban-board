import { describe, expect, it } from 'vitest';
import { taskExecutionSnapshot, taskSessionUrl } from './task-execution';
import { confirmedTaskRequests } from '../../components/kanban/integrator-dashboard-model';
import type { KanbanCard } from './types';

function card(overrides: Partial<KanbanCard> = {}): KanbanCard {
  return {
    id: 'task-1', title: 'Test task', description: '', column: 'todo', priority: 'medium', tags: [], order: 1,
    created: '2026-10-20T10:00:00.000Z', updated: '2026-10-20T10:00:00.000Z', fileName: 'task.md', version: 1,
    project: 'Demo', assignees: [], ...overrides,
  };
}

describe('taskExecutionSnapshot', () => {
  it('returns a not-started snapshot for a card with no execution result', () => {
    expect(taskExecutionSnapshot(card())).toEqual({ cardId: 'task-1', state: 'not-started' });
  });

  it('uses the existing review state and latest persisted result as progress', () => {
    expect(taskExecutionSnapshot(card({
      column: 'review', needsReview: true, nextAction: 'Check sources',
      resultHistory: [{ summary: 'Found two candidates', evidenceRefs: ['https://example.test'], submittedBy: 'worker', submittedAt: '2026-10-20T10:05:00.000Z' }],
    }))).toEqual({
      cardId: 'task-1', state: 'waiting',
      lastProgress: { summary: 'Found two candidates', at: '2026-10-20T10:05:00.000Z' },
      nextAction: 'Check sources', waitReason: 'Ожидает решения человека',
    });
  });

  it('does not resurrect an executor next action after a human explicitly clears it', () => {
    const snapshot = taskExecutionSnapshot(card({
      column: 'done',
      nextAction: null,
      resultHistory: [{
        summary: 'v2 accepted in QA', evidenceRefs: [], nextAction: 'Old rework prompt',
        submittedBy: 'executor', submittedAt: '2026-10-28T00:00:00.000Z',
      }],
    }));

    expect(snapshot).not.toHaveProperty('nextAction');
  });

  it('reports active, blocked and terminal Board states without inventing a session URL', () => {
    expect(taskExecutionSnapshot(card({ column: 'in-progress' })).state).toBe('running');
    expect(taskExecutionSnapshot(card({ column: 'blocked', waitingFor: ['Owner input'] }))).toMatchObject({ state: 'waiting', waitReason: 'Owner input' });
    expect(taskExecutionSnapshot(card({ column: 'done' })).state).toBe('stopped');
    expect(taskExecutionSnapshot(card({ column: 'in-progress' }))).not.toHaveProperty('sessionUrl');
  });

  it('preserves unknown admission as unknown and projects a durable native run receipt', () => {
    const operation = {
      operationId: 'a'.repeat(64), requestHash: 'b'.repeat(64), lastBoardVersion: 2, createInputId: 'c'.repeat(64),
      messageInputId: 'd'.repeat(64), phase: 'create-unknown' as const, hostId: 'server-100', harness: 'codex' as const,
      startedBy: 'nikita', createdAt: '2026-10-20T10:00:00.000Z', updatedAt: '2026-10-20T10:01:00.000Z',
    };
    expect(taskExecutionSnapshot(card({ taskExecutionHistory: [operation] })).state).toBe('unknown');
    expect(taskExecutionSnapshot(card({ taskExecutionHistory: [{ ...operation, phase: 'running', nativeSessionId: 'native-1', nativeTurnId: 'native-turn-1' }] })).state)
      .toBe('running');
    expect(taskSessionUrl('roomhacker-server-100', 'codex', 'native-1'))
      .toBe('https://agent.bezrabotnyi.com/#/session/codex%3Anative-1');
    expect(taskSessionUrl('roomhacker-server-100', 'codex', 'native-1', 'turn/one'))
      .toBe('https://agent.bezrabotnyi.com/#/session/codex%3Anative-1?turn=turn%2Fone');
    expect(taskSessionUrl('unregistered-host', 'codex', 'native-1')).toBeUndefined();
  });

  it('projects only durable signed authors with exact unique input and turn receipts', () => {
    const parent = {
      operationId:'a'.repeat(64), requestHash:'b'.repeat(64), lastBoardVersion:2,
      createInputId:'c'.repeat(64), messageInputId:'d'.repeat(64), phase:'result' as const,
      hostId:'roomhacker-server-100', harness:'codex' as const, nativeSessionId:'thread-1', nativeTurnId:'turn-parent',
      requestedBy:'native-user-a', startedBy:'legacy-or-native', createdAt:'2026-10-20T10:00:00Z', updatedAt:'2026-10-20T10:01:00Z',
      continuations:[{id:'follow',kind:'task-follow-up-v1' as const,instruction:'Check two sources',inputId:'e'.repeat(64),requestHash:'f'.repeat(64),requestedBy:'native-user-b',phase:'result' as const,nativeTurnId:'turn-child',createdAt:'2026-10-20T10:02:00Z',updatedAt:'2026-10-20T10:03:00Z'}],
    };
    const linked = confirmedTaskRequests(card({title:'SMB research',taskExecutionHistory:[parent]}));
    expect(linked).toEqual([
      expect.objectContaining({actor:'native-user-a',inputId:'d'.repeat(64),turnId:'turn-parent',instruction:'Запуск задачи «SMB research»',sessionUrl:expect.stringContaining('?turn=turn-parent')}),
      expect.objectContaining({actor:'native-user-b',inputId:'e'.repeat(64),turnId:'turn-child',instruction:'Check two sources',sessionUrl:expect.stringContaining('?turn=turn-child')}),
    ]);
    expect(confirmedTaskRequests(card({taskExecutionHistory:[{...parent,requestedBy:undefined}]}))).toHaveLength(1);
    expect(confirmedTaskRequests(card({taskExecutionHistory:[parent,{...parent,operationId:'9'.repeat(64),messageInputId:'8'.repeat(64)}]}))).toEqual([]);
  });
});
