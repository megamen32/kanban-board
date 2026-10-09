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

  it('requires the service authority and exact confirmation for assignments and deadlines', async () => {
    const args = { mode: 'new', title: 'Confirmed owner task', project: 'alpha',
      assignees: ['nikita'], dueAt: '2026-11-01T12:00:00Z', ownerCommandConfirmed: true };
    const ordinary = await client.callTool({ name: 'kanban.change', arguments: args });
    expect(ordinary.isError).toBe(true);
    expect(getAllCards(tasksDir)).toEqual([]);
    await client.close(); await server.close();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    server = createKanbanMcpServer('work', { allowConfirmedOwnerCommands: true });
    client = new Client({ name: 'authorized-exmanager', version: '1' });
    await server.connect(serverTransport); await client.connect(clientTransport);
    const unconfirmed = await client.callTool({ name: 'kanban.change', arguments: { ...args, ownerCommandConfirmed: false } });
    expect(unconfirmed.isError).toBe(true);
    const confirmed = await client.callTool({ name: 'kanban.change', arguments: args });
    expect(confirmed.isError).not.toBe(true);
    const { card } = JSON.parse(textFromResult(confirmed));
    expect(card.assignees).toEqual(['nikita']);
    expect(card.dueAt).toBe('2026-11-01T12:00:00.000Z');
    const completed = await client.callTool({ name: 'kanban.change', arguments: {
      mode: 'edit', cardId: card.id, expectedVersion: card.version, column: 'done', ownerCommandConfirmed: true,
      completionEvidence: [{ type: 'machine-verifiable', check: 'fabricated' }],
    } });
    expect(completed.isError).not.toBe(true);
    expect(JSON.parse(textFromResult(completed)).card.column).toBe('review');
  });

  it('accepts a distinct trusted owner status-only completion and rejects forged or mixed commands', async () => {
    const card = createCard('Owner completion fixture', '', 'in-progress', 'medium', [], 'alpha', [], tasksDir);
    const { updateCard } = await import('../kanban/file-store');
    updateCard(card.id, { owner: 'nikita', needsReview: true, requiresApprovalFrom: ['nikita'] }, undefined, tasksDir);
    const before = findCardById(card.id, tasksDir)!;
    const args = { mode: 'edit', cardId: card.id, expectedVersion: before.version, column: 'done',
      ownerCommandConfirmed: true, ownerCompletionConfirmed: true };
    expect((await client.callTool({ name: 'kanban.change', arguments: args })).isError).toBe(true);
    expect(findCardById(card.id, tasksDir)).toEqual(before);
    await client.close(); await server.close();
    const [ct, st] = InMemoryTransport.createLinkedPair();
    server = createKanbanMcpServer('work', { allowConfirmedOwnerCommands: true });
    client = new Client({ name: 'trusted-owner-status-only', version: '1' });
    await server.connect(st); await client.connect(ct);
    const { expectedVersion: _version, ...withoutVersion } = args;
    for (const bad of [ withoutVersion, { ...args, expectedVersion: before.version - 1 }, { ...args, ownerCommandConfirmed: false }, { ...args, title: 'Unexpected rename' },
      { ...args, assignees: ['other'] }, { ...args, dueAt: '2026-11-01T12:00:00Z' } ]) {
      expect((await client.callTool({ name: 'kanban.change', arguments: bad })).isError).toBe(true);
      expect(findCardById(card.id, tasksDir)).toEqual(before);
    }
    const result = await client.callTool({ name: 'kanban.change', arguments: args });
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(textFromResult(result)).card).toMatchObject({ column: 'done', needsReview: false,
      requiresApprovalFrom: [], completedBy: 'nikita', completionEvidence: [expect.objectContaining({
        type: 'owner_confirmed_completion', actor: 'nikita', origin: 'mcp',
      })] });
    const done = findCardById(card.id, tasksDir)!;
    expect((await client.callTool({ name: 'kanban.change', arguments: args })).isError).toBe(true);
    expect(findCardById(card.id, tasksDir)).toEqual(done);
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
