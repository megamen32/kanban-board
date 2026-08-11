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
      'kanban.change',
      'kanban.delete',
    ]);
  });
});
