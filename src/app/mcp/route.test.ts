import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthStore } from '../../lib/auth/store';
import { POST } from './route';
import type { SourceAdmissionRequest } from '../../lib/kanban/source-operation';

const authSecret = 'mcp-test-secret-012345678901234567890123';
const sourceSignatureDomain = Buffer.from('exmanager-source-admission-v1\n', 'utf8');
const todoWriteScopeDomain = Buffer.from('exmanager-todo-board-mcp-write-v1\n', 'utf8');
const todoProjectEnsureScopeDomain = Buffer.from('exmanager-todo-board-mcp-project-ensure-v1\n', 'utf8');

function canonical(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, character => ({
    '<': '\\u003c', '>': '\\u003e', '&': '\\u0026', '\u2028': '\\u2028', '\u2029': '\\u2029',
  })[character]!);
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${canonical(key)}:${canonical(record[key])}`).join(',')}}`;
  }
  throw new Error('unsupported test argument');
}

function signedTodoWriteScope(privateKey: KeyObject, args: Record<string, unknown>) {
  const issuedAtMs = Date.now();
  const claims = {
    v: 1,
    purpose: 'todo-board-mcp-write',
    userId: 'qa-manager',
    tool: 'kanban.change',
    argsSha256: createHash('sha256').update(canonical(args)).digest('base64url'),
    projects: ['QA'],
    owner: false,
    issuedAtMs,
    expiresAtMs: issuedAtMs + 120_000,
  };
  const payload = Buffer.from(JSON.stringify(claims), 'utf8');
  return { payload: payload.toString('base64url'), signature: sign(null, Buffer.concat([todoWriteScopeDomain, payload]), privateKey).toString('base64url') };
}

function signedTodoProjectEnsureScope(privateKey: KeyObject, args: Record<string, unknown>) {
  const issuedAtMs = Date.now();
  const claims = {
    v: 1,
    purpose: 'todo-board-mcp-project-ensure',
    userId: 'qa-admin',
    tool: 'kanban.project.ensure',
    argsSha256: createHash('sha256').update(canonical(args)).digest('base64url'),
    issuedAtMs,
    expiresAtMs: issuedAtMs + 120_000,
  };
  const payload = Buffer.from(JSON.stringify(claims), 'utf8');
  return { payload: payload.toString('base64url'), signature: sign(null, Buffer.concat([todoProjectEnsureScopeDomain, payload]), privateKey).toString('base64url') };
}

function signedSourceEnvelope(privateKey: KeyObject, sourceRef: string, request: SourceAdmissionRequest, issuedAtMs = Date.now(), expiresAtMs = issuedAtMs + 120_000) {
  const payload = Buffer.from(JSON.stringify({ sourceRef, request }), 'utf8');
  const authorization = Buffer.from(`\nsource-admission\n${issuedAtMs}\n${expiresAtMs}`, 'utf8');
  return { payload: payload.toString('base64url'), purpose: 'source-admission', issuedAtMs, expiresAtMs,
    signature: sign(null, Buffer.concat([sourceSignatureDomain, payload, authorization]), privateKey).toString('base64url') };
}

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
    vi.stubEnv('EXMANAGER_SOURCE_ADMISSION_PUBLIC_KEY', '');

    const auth = new AuthStore({ rootDir: authDir, encryptionKey: authSecret });
    const code = auth.createAuthorizationCode('tester', 'test-client', 'http://localhost/callback', 'kanban:work');
    token = auth.exchangeAuthorizationCode(code, 'test-client', 'http://localhost/callback')!.accessToken;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
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
  it('keeps source admission disabled without a valid pinned verifier even for the service identity', async () => {
    vi.stubEnv('EXMANAGER_SOURCE_ADMISSION_PUBLIC_KEY', 'legacy-signed-envelope-must-not-enable-admission');
    const ordinary = await POST(request({ jsonrpc: '2.0', id: 11, method: 'tools/list', params: {} }));
    expect((await ordinary.json()).result.tools.map((tool: { name: string }) => tool.name)).not.toContain('kanban.source.admit');

    const auth = new AuthStore({ rootDir: authDir, encryptionKey: authSecret });
    const code = auth.createAuthorizationCode('exmanager-service', 'exmanager-airlock-service', 'http://localhost/callback', 'kanban:work');
    token = auth.exchangeAuthorizationCode(code, 'exmanager-airlock-service', 'http://localhost/callback')!.accessToken;
    const trusted = await POST(request({ jsonrpc: '2.0', id: 12, method: 'tools/list', params: {} }));
    expect((await trusted.json()).result.tools.map((tool: { name: string }) => tool.name)).not.toContain('kanban.source.admit');
  });

  it('requires a signed canonical envelope despite the model-facing trusted MCP service identity', async () => {
    const sourceRef = '2f25df26-5d80-4ed0-9227-30dbf9e53170';
    const sourceRequest: SourceAdmissionRequest = {
      tenant: 'exmanager-team:team-1', sourceOwner: 'airlock-user-2', sourceEvent: sourceRef, primaryItem: 'primary',
      sourceRevision: 'sha256:decision', project: 'alpha', title: 'Review intake',
      description: 'Check the submitted source', priority: 'medium', assignees: [],
      classification: 'explicit-task', evidenceRefs: [`exmanager-task-source:${sourceRef}#span:1-20`],
    };
    const keys = generateKeyPairSync('ed25519');
    const publicKeyDer = keys.publicKey.export({ format: 'der', type: 'spki' });
    vi.stubEnv('EXMANAGER_SOURCE_ADMISSION_PUBLIC_KEY', Buffer.from(publicKeyDer).subarray(-32).toString('base64url'));

    const auth = new AuthStore({ rootDir: authDir, encryptionKey: authSecret });
    const serviceCode = auth.createAuthorizationCode('exmanager-service', 'exmanager-airlock-service', 'http://localhost/callback', 'kanban:work');
    const serviceToken = auth.exchangeAuthorizationCode(serviceCode, 'exmanager-airlock-service', 'http://localhost/callback')!.accessToken;
    const ordinaryToken = token;
    token = serviceToken;
    const tools = await POST(request({ jsonrpc: '2.0', id: 20, method: 'tools/list', params: {} }));
    const toolNames = (await tools.json()).result.tools.map((item: { name: string }) => item.name);
    expect(toolNames).toContain('kanban.source.admit');
    expect(toolNames).toContain('kanban.catalog.link');
    expect((await tool('kanban.change', { mode: 'new', project: 'alpha', title: 'Raw service mutation' })).isError).toBe(true);

    async function admit(envelope: unknown) {
      const response = await POST(request({
        jsonrpc: '2.0', id: 21, method: 'tools/call',
        params: { name: 'kanban.source.admit', arguments: { envelope } },
      }));
      return (await response.json()).result;
    }

    const forged = await admit({ payload: Buffer.from(JSON.stringify({ sourceRef, request: { ...sourceRequest, sourceOwner: 'forged-actor' } })).toString('base64url'), signature: 'A'.repeat(86) });
    expect(forged.isError).toBe(true);
    expect((await tool('kanban.list', {})).isError).toBe(true);

    const envelope = signedSourceEnvelope(keys.privateKey, sourceRef, sourceRequest);
    const first = JSON.parse((await admit(envelope)).content[0].text);
    const replay = JSON.parse((await admit(envelope)).content[0].text);
    const resignedReplay = JSON.parse((await admit(signedSourceEnvelope(keys.privateKey, sourceRef, sourceRequest))).content[0].text);
    expect(first).toMatchObject({ status: 'committed', classification: 'explicit-task' });
    expect(replay).toMatchObject({ status: 'replayed', cardId: first.cardId, intentId: first.intentId });
    expect(resignedReplay).toMatchObject({ status: 'replayed', cardId: first.cardId, intentId: first.intentId });
    const expired = await admit(signedSourceEnvelope(keys.privateKey, '7f1fec1d-0dad-4d20-9e68-24b2dd7c0066', { ...sourceRequest, sourceEvent: '7f1fec1d-0dad-4d20-9e68-24b2dd7c0066' }, Date.now() - 121_000, Date.now() - 1));
    expect(expired.isError).toBe(true);

    const changed = JSON.parse((await admit(signedSourceEnvelope(keys.privateKey, sourceRef, { ...sourceRequest, title: 'Changed request' }))).content[0].text);
    expect(changed).toMatchObject({ status: 'conflict', reason: 'same_identity_different_request' });
    token = ordinaryToken;
    expect(JSON.parse((await tool('kanban.list', { project: 'alpha' })).content[0].text).cards.map((card: { id: string }) => card.id)).toContain(first.cardId);
    expect(JSON.parse((await tool('kanban.list', { project: 'forged-project' })).content[0].text).cards).toEqual([]);

    token = ordinaryToken;
    const ordinaryTools = await POST(request({ jsonrpc: '2.0', id: 22, method: 'tools/list', params: {} }));
    expect((await ordinaryTools.json()).result.tools.map((item: { name: string }) => item.name)).not.toContain('kanban.source.admit');
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
    const keys = generateKeyPairSync('ed25519');
    const publicKeyDer = keys.publicKey.export({ format: 'der', type: 'spki' });
    vi.stubEnv('EXMANAGER_SOURCE_ADMISSION_PUBLIC_KEY', Buffer.from(publicKeyDer).subarray(-32).toString('base64url'));
    const auth = new AuthStore({ rootDir: authDir, encryptionKey: authSecret });
    const code = auth.createAuthorizationCode('exmanager-service', 'exmanager-airlock-service', 'http://localhost/callback', 'kanban:work');
    token = auth.exchangeAuthorizationCode(code, 'exmanager-airlock-service', 'http://localhost/callback')!.accessToken;
    const createArgs = { mode: 'new', title: 'Internal fixture', project: 'QA', assignees: ['fixture'], dueAt: '2026-11-01T12:00:00Z' };
    expect((await tool('kanban.change', createArgs)).isError).toBe(true);
    const first = JSON.parse((await tool('kanban.change', { ...createArgs, exmanagerScope: signedTodoWriteScope(keys.privateKey, createArgs) })).content[0].text).card;
    expect(first.assignees).toEqual(['fixture']);
    const edit = { mode: 'edit', cardId: first.id, expectedVersion: first.version, assignees: ['other'], dueAt: '2026-11-02T12:00:00Z' };
    const changed = JSON.parse((await tool('kanban.change', { ...edit, exmanagerScope: signedTodoWriteScope(keys.privateKey, edit) })).content[0].text).card;
    expect(changed.assignees).toEqual(['other']);
    expect(changed.dueAt).toBe('2026-11-02T12:00:00.000Z');
    expect((await tool('kanban.change', { ...edit, exmanagerScope: signedTodoWriteScope(keys.privateKey, edit) })).isError).toBe(true);
    const unversionedEdit = { mode: 'edit', cardId: first.id, column: 'todo' };
    expect((await tool('kanban.change', { ...unversionedEdit, exmanagerScope: signedTodoWriteScope(keys.privateKey, unversionedEdit) })).isError).toBe(true);
    const doneArgs = { mode: 'edit', cardId: first.id, expectedVersion: changed.version, column: 'done', completionEvidence: [{ type: 'work_result', result: 'own fixture checked' }] };
    const done = JSON.parse((await tool('kanban.change', { ...doneArgs, exmanagerScope: signedTodoWriteScope(keys.privateKey, doneArgs) })).content[0].text).card;
    expect(done.column).toBe('done');
    expect(done.completedBy).toBe('exmanager-service');
    expect(done.completionEvidence).toEqual([expect.objectContaining({ type: 'internal_team_completion' })]);

    const projectArgs = { externalKey: 'exmanager:fixture:binding', name: 'Empty fixture' };
    expect((await tool('kanban.project.ensure', projectArgs)).isError).toBe(true);
    const ensured = await tool('kanban.project.ensure', { ...projectArgs, exmanagerScope: signedTodoProjectEnsureScope(keys.privateKey, projectArgs) });
    expect(JSON.parse(ensured.content[0].text).project).toMatchObject(projectArgs);
    expect((await tool('kanban.project.list', {})).isError).toBe(true);
    expect((await tool('kanban.capture_inbox', { transcript: 'unscoped' })).isError).toBe(true);
    expect((await tool('kanban.delete', { cardId: first.id })).isError).toBe(true);
  });

  it('serves the Airlock application client as read-only and leaves the ordinary client unchanged', async () => {
    const ordinary = await POST(request({ jsonrpc: '2.0', id: 30, method: 'tools/list', params: {} }));
    expect((await ordinary.json()).result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      'kanban.list',
      'kanban.read',
      'kanban.capture_inbox',
      'kanban.change',
      'kanban.project.ensure',
      'kanban.project.list',
      'kanban.delete',
    ]);

    const auth = new AuthStore({ rootDir: authDir, encryptionKey: authSecret });
    const appCode = auth.createAuthorizationCode('airlock-todo-board-app', 'airlock-todo-board-app', 'urn:airlock:app', 'kanban:work');
    token = auth.exchangeAuthorizationCode(appCode, 'airlock-todo-board-app', 'urn:airlock:app')!.accessToken;

    const appTools = await POST(request({ jsonrpc: '2.0', id: 31, method: 'tools/list', params: {} }));
    const appToolNames = (await appTools.json()).result.tools.map((tool: { name: string }) => tool.name);
    expect(appToolNames).toEqual(['kanban.list', 'kanban.read', 'kanban.project.list']);

    const read = await POST(request({ jsonrpc: '2.0', id: 32, method: 'tools/call', params: { name: 'kanban.list', arguments: { limit: 5 } } }));
    expect((await read.json()).result.isError).toBeFalsy();

    for (const name of ['kanban.change', 'kanban.delete', 'kanban.capture_inbox', 'kanban.project.ensure']) {
      const mutation = await POST(request({
        jsonrpc: '2.0', id: 33, method: 'tools/call',
        params: { name, arguments: { cardId: 'x', mode: 'new', project: 'QA', title: 'x', transcript: 'x', externalKey: 'x', name: 'x' } },
      }));
      const body = await mutation.json();
      expect(body.error ?? body.result?.isError).toBeTruthy();
    }
  });

});
