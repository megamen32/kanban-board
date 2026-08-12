import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCard, findCardById, getAllCards } from '../kanban/file-store';
import { createKanbanMcpServer } from './kanban-server';

function textFromResult(result: unknown): string {
  if (!result || typeof result !== 'object' || !('content' in result)) {
    throw new Error('Expected an MCP content result');
  }
  const content = (result as { content: unknown }).content as Array<{ type?: string; text?: string }>;
  const text = content[0]?.type === 'text' ? content[0].text : undefined;
  if (text === undefined) throw new Error('Expected a text MCP result');
  return text;
}

describe('kanban.change MCP transition policy', () => {
  let tasksDir: string;
  let client: Client;
  let server: ReturnType<typeof createKanbanMcpServer>;

  beforeEach(async () => {
    tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-mcp-policy-'));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    vi.stubEnv('TASKS_DIR', tasksDir);
    server = createKanbanMcpServer('work');
    client = new Client({ name: 'kanban-policy-test', version: '1.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
    vi.unstubAllEnvs();
    fs.rmSync(tasksDir, { recursive: true, force: true });
  });

  it('redirects MCP DONE and persists review evidence instead of trusting caller evidence', async () => {
    const card = createCard('MCP completion', '', 'in-progress', 'medium', [], 'alpha', [], tasksDir);

    const result = await client.callTool({
      name: 'kanban.change',
      arguments: {
        mode: 'edit',
        cardId: card.id,
        column: 'done',
        completionEvidence: [{ type: 'machine-verifiable', check: 'caller-claimed' }],
      },
    });

    expect(result.isError).not.toBe(true);
    expect(JSON.parse(textFromResult(result))).toMatchObject({
      transition: { kind: 'redirected', reason: 'automation_done_requires_review' },
      card: { column: 'review', needsReview: true, requiresApprovalFrom: ['nikita'] },
    });
    expect(findCardById(card.id, tasksDir)).toMatchObject({
      column: 'review',
      needsReview: true,
      requiresApprovalFrom: ['nikita'],
      completionEvidence: [],
    });
  });

  it.each([
    ['assignee', { assignees: ['marina'] }],
    ['deadline', { dueAt: '2026-08-13T10:00:00+03:00' }],
  ])('rejects unauthorized MCP %s changes without persistence', async (_label, patch) => {
    const card = createCard('Protected MCP card', '', 'todo', 'medium', [], 'alpha', ['nikita'], tasksDir);

    const result = await client.callTool({
      name: 'kanban.change',
      arguments: { mode: 'edit', cardId: card.id, ...patch },
    });

    expect(result.isError).toBe(true);
    expect(textFromResult(result)).toMatch(
      /requires_owner_authorization|deadline_change_requires_human_ui/,
    );
    expect(findCardById(card.id, tasksDir)).toMatchObject({
      column: 'todo',
      assignees: ['nikita'],
      dueAt: undefined,
    });
  });

  it('rejects invalid planning metadata before creating a new Markdown card', async () => {
    const result = await client.callTool({
      name: 'kanban.change',
      arguments: {
        mode: 'new',
        title: 'Invalid role card',
        project: 'alpha',
        role: 'not-a-stable-role',
      },
    });

    expect(result.isError).toBe(true);
    expect(textFromResult(result)).toMatch(/role|invalid/i);
    expect(getAllCards(tasksDir)).toEqual([]);
    expect(fs.readdirSync(tasksDir)).toEqual([]);
  });
});
