import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { KanbanCard, TaskExecutionReceipt } from '../../lib/kanban/types';
import { CardExecutionOverview } from './card-execution-overview';

const base = (): KanbanCard => ({
  id: 'synthetic-1', title: 'Synthetic card', project: 'Synthetic QA',
  owner: 'testlogin', description: '', column: 'in-progress', priority: 'medium',
  tags: [], order: 0, created: '2026-10-31T00:00:00Z', updated: '2026-10-31T00:00:00Z',
  fileName: 'synthetic-1.md', version: 1, assignees: [],
});
const attempt = (): TaskExecutionReceipt => ({
  operationId: 'qa-op', requestHash: 'sha256', lastBoardVersion: 1,
  createInputId: 'create', messageInputId: 'message', phase: 'running',
  hostId: 'qa-host', harness: 'opencode', startedBy: 'testlogin',
  createdAt: '2026-10-31T00:00:00Z', updatedAt: '2026-10-31T01:00:00Z',
  lastProgress: 'Подготовил файл и собираю отчет', lastProgressAt: '2026-10-31T01:00:00Z',
});

describe('task execution visible in opened card', () => {
  it('shows an exact Agent Herder deep link for the attached native session', () => {
    const card = {
      ...base(),
      taskExecutionHistory: [{ ...attempt(), hostId: 'roomhacker-server-100', nativeSessionId: 'ses_fixture-123' }],
    };
    const html = renderToStaticMarkup(<CardExecutionOverview card={card} />);
    expect(html).toContain('Agent Herder · OpenCode');
    expect(html).toContain('https://agent.bezrabotnyi.com/#/session/opencode%3Ases_fixture-123');
    expect(html).toContain('Открыть сессию');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('does not invent a session link before Herder confirms a native session ID', () => {
    const card = { ...base(), taskExecutionHistory: [{ ...attempt(), phase: 'create-unknown' as const }] };
    const html = renderToStaticMarkup(<CardExecutionOverview card={card} />);
    expect(html).toContain('Сессия пока не подтверждена');
    expect(html).not.toContain('Открыть сессию');
  });

  it('does not pollute ordinary personal tasks', () => {
    expect(renderToStaticMarkup(<CardExecutionOverview card={base()} />)).toBe('');
  });

  it('shows the saved work progress and a functioning refresh affordance, no internal receipt noise', () => {
    const card = { ...base(), taskExecutionHistory: [attempt()] };
    const html = renderToStaticMarkup(<CardExecutionOverview card={card} onRefresh={() => {}} />);
    expect(html).toContain('Работа ИИ');
    expect(html).toContain('ИИ работает');
    expect(html).toContain('Подготовил файл и собираю отчет');
    expect(html).toContain('Обновить ход работы ИИ');
    expect(html).not.toContain('qa-op');
    expect(html).not.toContain('msg_');
  });

  it('shows the saved Markdown result even outside the review column', () => {
    const card: KanbanCard = {
      ...base(), taskExecutionHistory: [{ ...attempt(), phase: 'result' }],
      resultHistory: [{
        summary: '**Подготовлен отчёт**: 3 задачи выполнены',
        submittedAt: '2026-10-31T02:00:00Z', submittedBy: 'qa-agent',
        evidenceRefs: [],
      }],
    };
    const html = renderToStaticMarkup(<CardExecutionOverview card={card} />);
    expect(html).toContain('Результат получен');
    expect(html).toContain('Подготовлен отчёт');
    expect(html).toMatch(/<strong[ >]/);
    expect(html).toContain('qa-agent');
  });
});
