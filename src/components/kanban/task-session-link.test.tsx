import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { KanbanCard, TaskExecutionReceipt } from '../../lib/kanban/types';
import { taskSessionEmbedUrl, taskSessionUrl } from '../../lib/kanban/task-execution';
import { linkedTaskSessions, TaskSessionLink } from './task-session-link';

const receipt = (nativeSessionId?: string, phase: TaskExecutionReceipt['phase'] = nativeSessionId ? 'result' : 'intent'): TaskExecutionReceipt => ({
  operationId: 'qa-' + (nativeSessionId ?? 'pending'),
  requestHash: 'a'.repeat(64),
  lastBoardVersion: 1,
  createInputId: 'c'.repeat(64),
  messageInputId: 'd'.repeat(64),
  phase,
  hostId: 'roomhacker-server-100',
  harness: 'opencode',
  ...(nativeSessionId ? { nativeSessionId } : {}),
  startedBy: 'qa_exmanager_a',
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:01:00Z',
});

const card = (history: TaskExecutionReceipt[]): KanbanCard => ({
  id: 'qa-task', title: 'QA task', project: 'Synthetic QA',
  owner: 'qa_exmanager_a', column: 'review',
  taskExecutionHistory: history,
} as KanbanCard);

describe('Agent Herder task links matching LHC', () => {
  it('reuses LHC embedded chat URL for an exact native session', () => {
    const href = taskSessionUrl('roomhacker-server-100', 'opencode', 'ses_qa123');
    const embed = taskSessionEmbedUrl('roomhacker-server-100', 'opencode', 'ses_qa123');
    expect(href).toBe('https://agent.bezrabotnyi.com/#/session/opencode%3Ases_qa123');
    expect(embed).toBe('https://agent.bezrabotnyi.com/?from=lhc#/session/opencode%3Ases_qa123');
  });

  it('keeps old session links if a newer task attempt has not created a session', () => {
    const sessions = linkedTaskSessions(card([receipt('ses_first'), receipt('ses_latest'), receipt()]));
    expect(sessions.map(session => session.sessionId)).toEqual(['ses_latest', 'ses_first']);
    const html = renderToStaticMarkup(<TaskSessionLink card={card([receipt('ses_first'), receipt('ses_latest'), receipt()])} />);
    expect(html).toContain('Показать рядом');
    expect(html).toContain('Сессии задачи (2)');
    expect(html).toContain('ses_latest');
    expect(html).toContain('ses_first');
    expect(html).toContain('результат готов');
  });

  it('counts distinct sessions and shows the latest saved stage for each session', () => {
    const history = [
      receipt('ses_a', 'running'), receipt('ses_b', 'waiting'),
      receipt('ses_a', 'stopped'), receipt('ses_c', 'dispatch-unknown'),
    ];
    const sessions = linkedTaskSessions(card(history));
    expect(sessions.map(session => [session.sessionId, session.phase])).toEqual([
      ['ses_c', 'dispatch-unknown'], ['ses_a', 'stopped'], ['ses_b', 'waiting'],
    ]);
    const html = renderToStaticMarkup(<TaskSessionLink card={card(history)} />);
    expect(html).toContain('Сессии задачи (3)');
    expect(html).toContain('доставка не подтверждена');
    expect(html).toContain('остановлена');
    expect(html).toContain('ждёт ответа');
  });

  it('describes pending attempts without claiming that a session exists', () => {
    const html = renderToStaticMarkup(<TaskSessionLink card={card([receipt(undefined, 'create-unknown')])} />);
    expect(html).toContain('создание не подтверждено');
    expect(html).toContain('Сессия пока не подтверждена');
    expect(html).not.toContain('Сессии задачи (');
  });

  it('shows a direct Herder link in a compact task card', () => {
    const html = renderToStaticMarkup(<TaskSessionLink compact card={card([receipt('ses_qa123')])} />);
    expect(html).toContain('Открыть сессию');
    expect(html).toContain('https://agent.bezrabotnyi.com/#/session/opencode%3Ases_qa123');
    expect(html).not.toContain('Показать рядом');
  });

  it('does not invent session links for a task without an attached session', () => {
    const html = renderToStaticMarkup(<TaskSessionLink card={card([receipt()])} />);
    expect(html).toContain('Сессия пока не подтверждена');
    expect(html).not.toContain('Показать рядом');
    expect(linkedTaskSessions(card([]))).toHaveLength(0);
  });
});
