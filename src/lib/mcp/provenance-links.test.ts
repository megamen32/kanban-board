import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KanbanCard } from '../kanban/types';
import { getAllCards } from '../kanban/file-store';
import { createKanbanMcpServer } from './kanban-server';

const message = 'https://messages.example.test/opaque-message';
const session = 'https://sessions.example.test/opaque-session#turn';
function cardResult(result: unknown): KanbanCard {
  if (!result || typeof result !== 'object') throw new Error('Expected an immediate MCP tool result');
  const payload = result as Record<string, unknown>;
  expect(payload.isError).not.toBe(true);
  if (!Array.isArray(payload.content)) throw new Error('MCP tool result has no content array');
  const content = payload.content as unknown[];
  const text = content.find((value): value is { type: 'text'; text: string } => {
    if (!value || typeof value !== 'object') return false;
    const item = value as Record<string, unknown>;
    return item.type === 'text' && typeof item.text === 'string';
  });
  if (!text) throw new Error('MCP tool result has no text payload');
  const decoded: unknown = JSON.parse(text.text);
  if (!decoded || typeof decoded !== 'object' || !('card' in decoded)) {
    throw new Error('MCP payload has no card');
  }
  const card = decoded.card;
  if (!card || typeof card !== 'object' || !('id' in card) || typeof card.id !== 'string'
      || !('version' in card) || typeof card.version !== 'number') {
    throw new Error('MCP card identity or version is invalid');
  }
  return card as KanbanCard;
}

describe('native MCP provenance reference contract', () => {
  let dir: string;
  let client: Client;
  let server: ReturnType<typeof createKanbanMcpServer>;
  async function connect(readOnlyApp = false) {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    server = createKanbanMcpServer('work', { readOnlyApp });
    client = new Client({ name: 'synthetic-provenance-client', version: '1.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  }
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-provenance-mcp-'));
    vi.stubEnv('TASKS_DIR', dir);
    vi.stubEnv('KANBAN_SCOPE_ROOT', '');
    await connect();
  });
  afterEach(async () => {
    await client.close();
    await server.close();
    vi.unstubAllEnvs();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('advertises typed nullable fields and their purpose in tools/list and instructions', async () => {
    const result = await client.listTools();
    for (const name of ['kanban.change', 'kanban.capture_inbox']) {
      const tool = result.tools.find(item => item.name === name)!;
      expect(tool.description).toContain('sourceMessageUrl');
      expect(tool.description).toContain('sourceSessionUrl');
      for (const field of ['sourceMessageUrl', 'sourceSessionUrl']) {
        const schema = tool.inputSchema.properties?.[field] as { description?: string } | undefined;
        expect(schema?.description).toMatch(/HTTP\(S\)/);
        expect(schema?.description).toMatch(/Null clears; omitted preserves/);
        expect(JSON.stringify(schema)).toContain('"maxLength":2048');
        expect(JSON.stringify(schema)).toContain('"null"');
      }
    }
    expect(client.getInstructions()).toContain('sourceMessageUrl');
    expect(client.getInstructions()).toContain('never invent provider routes');
  });

  it('persists create/edit/read URLs and keeps legacy source and omission semantics', async () => {
    const created = cardResult(await client.callTool({ name: 'kanban.change', arguments: {
      mode: 'new', title: 'Synthetic provenance task', project: 'Synthetic project',
      source: 'legacy:opaque', sourceMessageUrl: message, sourceSessionUrl: session,
    } }));
    const read = cardResult(await client.callTool({ name: 'kanban.read', arguments: { cardId: created.id } }));
    expect(read).toMatchObject({ source: 'legacy:opaque', sourceMessageUrl: message, sourceSessionUrl: session });
    const edited = cardResult(await client.callTool({ name: 'kanban.change', arguments: {
      mode: 'edit', cardId: read.id, expectedVersion: read.version, title: 'Synthetic renamed',
    } }));
    expect(edited).toMatchObject({ sourceMessageUrl: message, sourceSessionUrl: session });
    const cleared = cardResult(await client.callTool({ name: 'kanban.change', arguments: {
      mode: 'edit', cardId: edited.id, expectedVersion: edited.version, sourceSessionUrl: null,
    } }));
    expect(cleared.sourceSessionUrl).toBeUndefined();
    expect(cleared.sourceMessageUrl).toBe(message);
    expect(cleared.source).toBe('legacy:opaque');
    expect(cleared.taskExecutionHistory).toBeUndefined();
    expect(cleared.sourceAdmission).toBeUndefined();
  });

  it('captures explicit links without changing the raw Inbox workflow', async () => {
    const card = cardResult(await client.callTool({ name: 'kanban.capture_inbox', arguments: {
      transcript: 'Synthetic raw note', sourceMessageUrl: message, sourceSessionUrl: session,
    } }));
    expect(card).toMatchObject({
      description: 'Synthetic raw note', column: 'inbox', source: 'hermes:transcript',
      needsReview: true, sourceMessageUrl: message, sourceSessionUrl: session,
    });
    expect(card.assignees).toEqual([]);
    expect(card.dueAt).toBeUndefined();
    expect(card.taskExecutionHistory).toBeUndefined();
  });

  it.each(['kanban.change', 'kanban.capture_inbox'])('rejects an invalid URL before %s creates a card', async name => {
    const arguments_ = name === 'kanban.change'
      ? { mode: 'new', title: 'Must not persist', project: 'Synthetic project' }
      : { transcript: 'Must not persist' };
    const result = await client.callTool({ name, arguments: { ...arguments_, sourceMessageUrl: 'https://user:password@example.test/' } });
    expect(result.isError).toBe(true);
    expect(getAllCards(dir)).toHaveLength(0);
  });

  it('does not treat a session reference as approval or completion evidence', async () => {
    const card = cardResult(await client.callTool({ name: 'kanban.change', arguments: {
      mode: 'new', title: 'Synthetic unfinished task', project: 'Synthetic project', sourceSessionUrl: session,
    } }));
    const changed = cardResult(await client.callTool({ name: 'kanban.change', arguments: {
      mode: 'edit', cardId: card.id, expectedVersion: card.version, column: 'done',
    } }));
    expect(changed.column).toBe('review');
    expect(changed.sourceSessionUrl).toBe(session);
  });

  it('keeps read-only application clients read-only', async () => {
    await client.close();
    await server.close();
    await connect(true);
    const tools = (await client.listTools()).tools.map(item => item.name).sort();
    expect(tools).toEqual(['kanban.list', 'kanban.project.list', 'kanban.read']);
  });
});
