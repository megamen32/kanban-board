import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthStore } from '../../lib/auth/store';
import { POST } from './route';

const authSecret = 'mcp-test-secret-012345678901234567890123';

describe('Kanban MCP transport', () => {
  let tasksDir: string;
  let authDir: string;
  let token: string;

  beforeEach(() => {
    tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-mcp-tasks-'));
    authDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-mcp-auth-'));
    vi.stubEnv('TASKS_DIR', tasksDir);
    vi.stubEnv('KANBAN_AUTH_DIR', authDir);
    vi.stubEnv('KANBAN_AUTH_SECRET', authSecret);

    const auth = new AuthStore({ rootDir: authDir, encryptionKey: authSecret });
    const code = auth.createAuthorizationCode('tester', 'test-client', 'http://localhost/callback', 'kanban:work');
    token = auth.exchangeAuthorizationCode(code, 'test-client', 'http://localhost/callback')!.accessToken;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(tasksDir, { recursive: true, force: true });
    fs.rmSync(authDir, { recursive: true, force: true });
  });

  function request(body: unknown, bearer = token) {
    return new NextRequest('http://localhost/mcp', {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${bearer}`,
        'content-type': 'application/json',
        'mcp-protocol-version': '2025-06-18',
      },
      body: JSON.stringify(body),
    });
  }

  it('rejects MCP requests without the ChatGPT bearer identity', async () => {
    const response = await POST(request({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, 'invalid'));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'authentication required' });
  });

  it('serves initialize and tools/list over streamable HTTP for the token scope', async () => {
    const initialize = await POST(request({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
    }));
    expect(initialize.status).toBe(200);
    const initializeBody = await initialize.json();
    expect(initializeBody.result.serverInfo.name).toBe('excode-kanban-work');

    const tools = await POST(request({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }));
    expect(tools.status).toBe(200);
    const toolsBody = await tools.json();
    expect(toolsBody.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      'kanban.list',
      'kanban.read',
      'kanban.capture_inbox',
      'kanban.change',
      'kanban.project.ensure',
      'kanban.project.list',
      'kanban.delete',
    ]);
  });
  it('keeps source admission disabled on the live MCP route until an authenticated canonical lookup is wired', async () => {
    vi.stubEnv('EXMANAGER_SOURCE_ADMISSION_PUBLIC_KEY', 'legacy-signed-envelope-must-not-enable-admission');
    const ordinary = await POST(request({ jsonrpc: '2.0', id: 11, method: 'tools/list', params: {} }));
    expect((await ordinary.json()).result.tools.map((tool: { name: string }) => tool.name)).not.toContain('kanban.source.admit');

    const auth = new AuthStore({ rootDir: authDir, encryptionKey: authSecret });
    const code = auth.createAuthorizationCode('exmanager-service', 'exmanager-airlock-service', 'http://localhost/callback', 'kanban:work');
    token = auth.exchangeAuthorizationCode(code, 'exmanager-airlock-service', 'http://localhost/callback')!.accessToken;
    const trusted = await POST(request({ jsonrpc: '2.0', id: 12, method: 'tools/list', params: {} }));
    expect((await trusted.json()).result.tools.map((tool: { name: string }) => tool.name)).not.toContain('kanban.source.admit');
  });
  async function tool(name: string, args: Record<string, unknown>) {
    const response = await POST(request({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: args } }));
    return (await response.json()).result;
  }
  it('ensures and lists persistent empty projects over authenticated HTTP, with conflict and repeat', async () => {
    const args = { externalKey: 'exmanager:fixture:binding', name: 'Empty fixture' };
    const first = JSON.parse((await tool('kanban.project.ensure', args)).content[0].text);
    expect(first.created).toBe(true);
    expect(JSON.parse((await tool('kanban.project.ensure', args)).content[0].text)).toEqual({ ...first, created: false });
    expect(JSON.parse((await tool('kanban.project.list', {})).content[0].text)).toEqual({ projects: [first.project] });
    expect((await tool('kanban.project.ensure', { ...args, name: 'Renamed' })).isError).toBe(true);
    expect(JSON.parse((await tool('kanban.list', {})).content[0].text).cards).toEqual([]);
  });
  it('uses exact work service identity for normal internal edits and preserves CAS/evidence', async () => {
    const auth = new AuthStore({ rootDir: authDir, encryptionKey: authSecret });
    const code = auth.createAuthorizationCode('exmanager-service', 'exmanager-airlock-service', 'http://localhost/callback', 'kanban:work');
    token = auth.exchangeAuthorizationCode(code, 'exmanager-airlock-service', 'http://localhost/callback')!.accessToken;
    const first = JSON.parse((await tool('kanban.change', { mode: 'new', title: 'Internal fixture', project: 'QA', assignees: ['fixture'], dueAt: '2026-11-01T12:00:00Z' })).content[0].text).card;
    expect(first.assignees).toEqual(['fixture']);
    const edit = { mode: 'edit', cardId: first.id, expectedVersion: first.version, assignees: ['other'], dueAt: '2026-11-02T12:00:00Z' };
    const changed = JSON.parse((await tool('kanban.change', edit)).content[0].text).card;
    expect(changed.assignees).toEqual(['other']);
    expect(changed.dueAt).toBe('2026-11-02T12:00:00.000Z');
    expect((await tool('kanban.change', edit)).isError).toBe(true);
    expect((await tool('kanban.change', { mode: 'edit', cardId: first.id, column: 'todo' })).isError).toBe(true);
    const done = JSON.parse((await tool('kanban.change', { mode: 'edit', cardId: first.id, expectedVersion: changed.version, column: 'done', completionEvidence: [{ type: 'work_result', result: 'own fixture checked' }] })).content[0].text).card;
    expect(done.column).toBe('done');
    expect(done.completedBy).toBe('exmanager-service');
    expect(done.completionEvidence).toEqual([expect.objectContaining({ type: 'internal_team_completion' })]);
  });

});
