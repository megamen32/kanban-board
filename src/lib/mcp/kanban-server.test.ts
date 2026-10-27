import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCard, deleteCard, findCardById, getAllCards } from '../kanban/file-store';
import { createKanbanMcpServer } from './kanban-server';
import type { SourceAdmissionRequest } from '../kanban/source-operation';
import { createSourceAdmissionVerifier, type SignedSourceAdmissionEnvelope } from './source-resolver';
import { createTodoMcpReadScopeVerifier, createTodoMcpWriteScopeVerifier,
  type TodoMcpReadScopeClaims, type TodoMcpWriteScopeClaims } from './todo-caller-scope';

const SOURCE_SIGNATURE_DOMAIN = Buffer.from('exmanager-source-admission-v1\n', 'utf8');
const TODO_READ_SCOPE_DOMAIN = Buffer.from('exmanager-todo-board-mcp-read-v1\n', 'utf8');
const TODO_WRITE_SCOPE_DOMAIN = Buffer.from('exmanager-todo-board-mcp-write-v1\n', 'utf8');

function signSourceRequest(privateKey: KeyObject, sourceRef: string, request: SourceAdmissionRequest): SignedSourceAdmissionEnvelope {
  const payload = Buffer.from(JSON.stringify({ sourceRef, request }), 'utf8');
  const issuedAtMs = Date.now();
  const expiresAtMs = issuedAtMs + 120_000;
  const authorization = Buffer.from(`\nsource-admission\n${issuedAtMs}\n${expiresAtMs}`, 'utf8');
  return { payload: payload.toString('base64url'), purpose: 'source-admission', issuedAtMs, expiresAtMs,
    signature: sign(null, Buffer.concat([SOURCE_SIGNATURE_DOMAIN, payload, authorization]), privateKey).toString('base64url') };
}

function signTodoReadScope(privateKey: KeyObject, claims: TodoMcpReadScopeClaims) {
  const payload = Buffer.from(JSON.stringify(claims), 'utf8');
  return { payload: payload.toString('base64url'), signature: sign(null, Buffer.concat([TODO_READ_SCOPE_DOMAIN, payload]), privateKey).toString('base64url') };
}

function signTodoWriteScope(privateKey: KeyObject, claims: TodoMcpWriteScopeClaims) {
  const payload = Buffer.from(JSON.stringify(claims), 'utf8');
  return { payload: payload.toString('base64url'), signature: sign(null, Buffer.concat([TODO_WRITE_SCOPE_DOMAIN, payload]), privateKey).toString('base64url') };
}

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

  it('routes a structured executor result into review and persists only reference metadata', async () => {
    const card = createCard('MCP result', '', 'in-progress', 'medium', [], 'alpha', [], tasksDir);
    const result = await client.callTool({
      name: 'kanban.change',
      arguments: {
        mode: 'edit', cardId: card.id, expectedVersion: card.version, column: 'done',
        executorResult: {
          summary: 'Compared the two configured routes.',
          evidenceRefs: ['source:evt-12:span-3'],
          nextAction: 'Human review requested.',
          runRef: 'run:forged', submittedBy: 'nikita', actor: 'nikita', sourceRef: 'forged-source',
        },
      },
    });
    expect(result.isError).not.toBe(true);
    const payload = JSON.parse(textFromResult(result));
    expect(payload).toMatchObject({ transition: {
      kind: 'redirected', reason: 'executor_result_requires_review',
    }, card: {
      column: 'review', needsReview: true, nextAction: 'Human review requested.',
      resultHistory: [{ summary: 'Compared the two configured routes.', evidenceRefs: ['source:evt-12:span-3'],
        submittedBy: 'mcp' }],
    } });
    expect(payload.card.resultHistory[0]).not.toHaveProperty('runRef');
    expect(payload.card.resultHistory[0]).not.toHaveProperty('actor');
    expect(payload.card.resultHistory[0]).not.toHaveProperty('sourceRef');
    expect(findCardById(card.id, tasksDir)).toMatchObject({
      column: 'review', resultHistory: [{ evidenceRefs: ['source:evt-12:span-3'] }],
    });
    expect(findCardById(card.id, tasksDir)?.completionEvidence).toEqual([]);
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

  it('allows only a signed exact owner completion from review and preserves CAS and audit', async () => {
    await client.close(); await server.close();
    const [ct, st] = InMemoryTransport.createLinkedPair();
    server = createKanbanMcpServer('work', { allowConfirmedOwnerCommands: true });
    client = new Client({ name: 'trusted-owner-review-completion-regression', version: '1' });
    await server.connect(st); await client.connect(ct);

    const { updateCard } = await import('../kanban/file-store');
    const inReview = createCard('Column review gate', '', 'review', 'medium', [], 'alpha', [], tasksDir);
    updateCard(inReview.id, { owner: 'nikita', needsReview: true, requiresApprovalFrom: ['nikita'] }, inReview.version, tasksDir);
    const reviewBefore = findCardById(inReview.id, tasksDir)!;
    const withOwnerFlags = { mode: 'edit', cardId: reviewBefore.id, expectedVersion: reviewBefore.version,
      column: 'done', ownerCommandConfirmed: true, ownerCompletionConfirmed: true };
    for (const bad of [
      { ...withOwnerFlags, expectedVersion: undefined },
      { ...withOwnerFlags, expectedVersion: reviewBefore.version - 1 },
      { ...withOwnerFlags, ownerCommandConfirmed: false },
      { ...withOwnerFlags, ownerCompletionConfirmed: false },
      { ...withOwnerFlags, title: 'Mixed edit' },
      { ...withOwnerFlags, column: 'in-progress', ownerCompletionConfirmed: false,
        needsReview: false, requiresApprovalFrom: ['marina'] },
    ]) {
      expect((await client.callTool({ name: 'kanban.change', arguments: bad })).isError).toBe(true);
      expect(findCardById(inReview.id, tasksDir)).toEqual(reviewBefore);
    }
    const otherReviewer = createCard('Other reviewer gate', '', 'review', 'medium', [], 'alpha', [], tasksDir);
    updateCard(otherReviewer.id, { owner: 'nikita', needsReview: true, requiresApprovalFrom: ['oleg'] }, otherReviewer.version, tasksDir);
    const otherReviewerBefore = findCardById(otherReviewer.id, tasksDir)!;
    expect((await client.callTool({ name: 'kanban.change', arguments: {
      ...withOwnerFlags, cardId: otherReviewer.id, expectedVersion: otherReviewerBefore.version,
    } })).isError).toBe(true);
    expect(findCardById(otherReviewer.id, tasksDir)).toEqual(otherReviewerBefore);

    const result = await client.callTool({ name: 'kanban.change', arguments: withOwnerFlags });
    expect(result.isError, textFromResult(result)).not.toBe(true);
    const payload = JSON.parse(textFromResult(result));
    expect(payload.card).toMatchObject({ column: 'done', needsReview: false,
      requiresApprovalFrom: [], completedBy: 'nikita', completedAt: expect.any(String),
      completionEvidence: [expect.objectContaining({
        type: 'owner_confirmed_completion', actor: 'nikita', origin: 'mcp',
        evidence: expect.objectContaining({ type: 'airlock_confirmed_command', service: 'exmanager-airlock-service' }),
      })] });
    expect(payload.card.version).toBe(reviewBefore.version + 1);
    const completed = findCardById(inReview.id, tasksDir)!;
    expect(completed).toEqual(payload.card);
    expect((await client.callTool({ name: 'kanban.change', arguments: withOwnerFlags })).isError).toBe(true);
    expect(findCardById(inReview.id, tasksDir)).toEqual(completed);
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

  it('requires an ExManager signature, then replays one source identity and preserves no-launch outcomes', async () => {
    expect((await client.listTools()).tools.some(tool => tool.name === 'kanban.source.admit')).toBe(false);
    await client.close(); await server.close();
    const keys = generateKeyPairSync('ed25519');
    const publicKeyDer = keys.publicKey.export({ format: 'der', type: 'spki' });
    const publicKey = Buffer.from(publicKeyDer).subarray(-32).toString('base64url');
    const sourceRequest: SourceAdmissionRequest = {
      tenant: 'fixture-tenant', sourceOwner: 'fixture-owner', sourceEvent: '8be4b0d5-79cf-44fa-90e4-b57c0a8f5c90', primaryItem: 'primary',
      sourceRevision: 'rev-1', project: 'alpha', title: 'Verify MCP intake', description: 'Source-backed fixture task',
      priority: 'medium' as const, assignees: [], classification: 'explicit-task', evidenceRefs: ['fixture:event-22:span-2'],
    };
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    server = createKanbanMcpServer('work', { verifySourceAdmission: createSourceAdmissionVerifier(publicKey)! });
    client = new Client({ name: 'kanban-source-admission-fixture', version: '1.0.0' });
    await server.connect(serverTransport); await client.connect(clientTransport);
    expect((await client.listTools()).tools.some(tool => tool.name === 'kanban.source.admit')).toBe(true);

    const sourceRef = sourceRequest.sourceEvent;
    const envelope = signSourceRequest(keys.privateKey, sourceRef, sourceRequest);
    const forged = await client.callTool({ name: 'kanban.source.admit', arguments: {
      envelope: { ...envelope, signature: 'A'.repeat(86) },
    } });
    expect(forged.isError).toBe(true);
    expect(getAllCards(tasksDir)).toHaveLength(0);

    const first = await client.callTool({ name: 'kanban.source.admit', arguments: { envelope } });
    expect(first.isError).not.toBe(true);
    const admitted = JSON.parse(textFromResult(first));
    expect(admitted.status).toBe('committed');
    const second = await client.callTool({ name: 'kanban.source.admit', arguments: { envelope } });
    expect(JSON.parse(textFromResult(second))).toMatchObject({ status: 'replayed', cardId: admitted.cardId, intentId: admitted.intentId });
    const changed = await client.callTool({ name: 'kanban.source.admit', arguments: {
      envelope: signSourceRequest(keys.privateKey, sourceRef, { ...sourceRequest, title: 'Changed frozen request' }),
    } });
    expect(JSON.parse(textFromResult(changed))).toMatchObject({ status: 'conflict', reason: 'same_identity_different_request' });
    expect(findCardById(admitted.cardId, tasksDir)).toMatchObject({
      title: sourceRequest.title,
      sourceAdmission: {
        tenantId: sourceRequest.tenant,
        sourceOwnerId: sourceRequest.sourceOwner,
        sourceEventId: sourceRequest.sourceEvent,
        sourceRevision: sourceRequest.sourceRevision,
        classification: sourceRequest.classification,
        evidenceRefs: sourceRequest.evidenceRefs,
      },
    });
    expect(getAllCards(tasksDir)).toHaveLength(1);

    for (const [classification, column] of [['idea', 'someday'], ['ambiguous', 'inbox']] as const) {
      const ref = classification === 'idea' ? '46b4fb66-a681-4317-86ea-f3cb628bf956' : '6a9c3135-34e2-4f5f-af98-04f9200f44d5';
      const classifiedRequest = { ...sourceRequest, sourceEvent: ref, classification } as SourceAdmissionRequest;
      const classified = await client.callTool({ name: 'kanban.source.admit', arguments: {
        envelope: signSourceRequest(keys.privateKey, ref, classifiedRequest),
      } });
      const outcome = JSON.parse(textFromResult(classified));
      expect(outcome).toMatchObject({ status: 'committed', classification });
      expect(outcome).not.toHaveProperty('intentId');
      expect(findCardById(outcome.cardId, tasksDir)).toMatchObject({ column });
    }
    expect(deleteCard(admitted.cardId, tasksDir)).toBe(true);
    const replayAfterDelete = await client.callTool({ name: 'kanban.source.admit', arguments: { envelope } });
    expect(JSON.parse(textFromResult(replayAfterDelete))).toMatchObject({ status: 'cancelled', cardId: admitted.cardId });
    expect(getAllCards(tasksDir)).toHaveLength(2);

    const rawRequest = await client.callTool({ name: 'kanban.source.admit', arguments: { sourceRef, ...sourceRequest } });
    expect(rawRequest.isError).toBe(true);
    expect(getAllCards(tasksDir)).toHaveLength(2);
  });

  it('persists the frozen idea and ambiguity quotes across signed replay without launch intents', async () => {
    await client.close(); await server.close();
    const keys = generateKeyPairSync('ed25519');
    const publicKey = Buffer.from(keys.publicKey.export({ format: 'der', type: 'spki' })).subarray(-32).toString('base64url');
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    server = createKanbanMcpServer('work', { verifySourceAdmission: createSourceAdmissionVerifier(publicKey)! });
    client = new Client({ name: 'kanban-source-visible-outcomes', version: '1.0.0' });
    await server.connect(serverTransport); await client.connect(clientTransport);

    const cases = [
      { sourceRef: '0e467f03-c8ec-4f5b-a43b-d9602ac11f87', classification: 'idea' as const,
        quote: 'Идея: сохранить пример удачной интеграции Alpha для будущего обсуждения.',
        title: 'Идея из исходного сообщения', description: 'Сохранённая идея: «Идея: сохранить пример удачной интеграции Alpha для будущего обсуждения.»', column: 'someday' },
      { sourceRef: 'b3746243-5629-450f-ac0c-f475f746eff9', classification: 'ambiguous' as const,
        quote: 'Неоднозначно: обсудить интеграцию Alpha?',
        title: 'Уточнить исходное сообщение', description: 'Неоднозначный смысл; требуется уточнение: «Неоднозначно: обсудить интеграцию Alpha?»', column: 'inbox' },
    ];

    for (const item of cases) {
      const request: SourceAdmissionRequest = {
        tenant: 'fixture-tenant', sourceOwner: 'fixture-owner', sourceEvent: item.sourceRef, primaryItem: 'primary',
        sourceRevision: `frozen-${item.classification}`, project: 'alpha', title: item.title, description: item.description,
        priority: 'medium', assignees: [], classification: item.classification,
        evidenceRefs: [`exmanager-task-source:${item.sourceRef}#span:0-${Buffer.byteLength(item.quote, 'utf8')}`],
      };
      const first = await client.callTool({ name: 'kanban.source.admit', arguments: {
        envelope: signSourceRequest(keys.privateKey, item.sourceRef, request),
      } });
      expect(first.isError).not.toBe(true);
      const committed = JSON.parse(textFromResult(first));
      expect(committed).toMatchObject({ status: 'committed', classification: item.classification });
      expect(committed).not.toHaveProperty('intentId');

      const saved = findCardById(committed.cardId, tasksDir);
      expect(saved).toMatchObject({ title: item.title, column: item.column, description: item.description,
        sourceAdmission: { classification: item.classification, evidenceRefs: request.evidenceRefs } });
      expect(saved?.description).toContain(item.quote);

      const replay = await client.callTool({ name: 'kanban.source.admit', arguments: {
        envelope: signSourceRequest(keys.privateKey, item.sourceRef, request),
      } });
      const replayed = JSON.parse(textFromResult(replay));
      expect(replayed).toMatchObject({ status: 'replayed', classification: item.classification, cardId: committed.cardId });
      expect(replayed).not.toHaveProperty('intentId');
      expect(findCardById(committed.cardId, tasksDir)?.description).toContain(item.quote);
    }
    expect(getAllCards(tasksDir)).toHaveLength(2);
  });

});

describe('shared ExManager MCP read scope', () => {
  let tasksDir: string;
  let client: Client;
  let server: ReturnType<typeof createKanbanMcpServer>;
  let privateKey: KeyObject;

  beforeEach(async () => {
    tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-mcp-read-scope-'));
    vi.stubEnv('TASKS_DIR', tasksDir);
    const keys = generateKeyPairSync('ed25519');
    const rawPublicKey = keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64url');
    privateKey = keys.privateKey;
    server = createKanbanMcpServer('work', {
      requireExManagerReadScope: true,
      verifyExManagerReadScope: createTodoMcpReadScopeVerifier(rawPublicKey),
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'kanban-read-scope-test', version: '1.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
    vi.unstubAllEnvs();
    fs.rmSync(tasksDir, { recursive: true, force: true });
  });

  it('denies raw list/read and limits signed list/read to the current project set', async () => {
    const alpha = createCard('Alpha private', '', 'todo', 'medium', [], 'alpha', [], tasksDir);
    const beta = createCard('Beta private', '', 'todo', 'medium', [], 'beta', [], tasksDir);
    const rawList = await client.callTool({ name: 'kanban.list', arguments: { project: 'alpha' } });
    const rawRead = await client.callTool({ name: 'kanban.read', arguments: { cardId: alpha.id } });
    expect(rawList.isError).toBe(true);
    expect(rawRead.isError).toBe(true);

    const issuedAtMs = Date.now();
    const listArgs = { project: 'alpha' };
    const listClaims: TodoMcpReadScopeClaims = {
      v: 1, purpose: 'todo-board-mcp-read', userId: 'member-a', tool: 'kanban.list',
      argsSha256: createHash('sha256').update(JSON.stringify(listArgs)).digest('base64url'),
      projects: ['alpha'], owner: false, issuedAtMs, expiresAtMs: issuedAtMs + 120_000,
    };
    const list = await client.callTool({ name: 'kanban.list', arguments: { ...listArgs, exmanagerScope: signTodoReadScope(privateKey, listClaims) } });
    expect(JSON.parse(textFromResult(list)).cards.map((card: { id: string }) => card.id)).toEqual([alpha.id]);
    const wrongTool = await client.callTool({ name: 'kanban.list', arguments: { ...listArgs, exmanagerScope: signTodoReadScope(privateKey, { ...listClaims, tool: 'kanban.read' }) } });
    expect(wrongTool.isError).toBe(true);

    const readArgs = { cardId: alpha.id };
    const readClaims: TodoMcpReadScopeClaims = {
      ...listClaims, tool: 'kanban.read',
      argsSha256: createHash('sha256').update(JSON.stringify(readArgs)).digest('base64url'),
    };
    const read = await client.callTool({ name: 'kanban.read', arguments: { ...readArgs, exmanagerScope: signTodoReadScope(privateKey, readClaims) } });
    expect(JSON.parse(textFromResult(read)).card.id).toBe(alpha.id);
    const foreignRead = await client.callTool({ name: 'kanban.read', arguments: {
      cardId: beta.id,
      exmanagerScope: signTodoReadScope(privateKey, { ...readClaims, argsSha256: createHash('sha256').update(JSON.stringify({ cardId: beta.id })).digest('base64url') }),
    } });
    expect(foreignRead.isError).toBe(true);
  });
});

describe('shared ExManager MCP write scope', () => {
  let tasksDir: string;
  let client: Client;
  let server: ReturnType<typeof createKanbanMcpServer>;
  let privateKey: KeyObject;

  beforeEach(async () => {
    tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-mcp-write-scope-'));
    vi.stubEnv('TASKS_DIR', tasksDir);
    const keys = generateKeyPairSync('ed25519');
    const rawPublicKey = keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64url');
    privateKey = keys.privateKey;
    server = createKanbanMcpServer('work', {
      allowInternalTeamCommands: true,
      requireExManagerWriteScope: true,
      verifyExManagerWriteScope: createTodoMcpWriteScopeVerifier(rawPublicKey),
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'kanban-write-scope-test', version: '1.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
    vi.unstubAllEnvs();
    fs.rmSync(tasksDir, { recursive: true, force: true });
  });

  it('denies raw and cross-project changes while accepting an exact signed current-manager change', async () => {
    const alpha = createCard('Alpha task', '', 'todo', 'medium', [], 'alpha', [], tasksDir);
    const beta = createCard('Beta task', '', 'todo', 'medium', [], 'beta', [], tasksDir);
    const changeArgs = { cardId: alpha.id, expectedVersion: alpha.version, mode: 'edit', title: 'Manager update' };
    const raw = await client.callTool({ name: 'kanban.change', arguments: changeArgs });
    expect(raw.isError).toBe(true);
    expect(findCardById(alpha.id, tasksDir)?.title).toBe('Alpha task');

    const issuedAtMs = Date.now();
    const claims: TodoMcpWriteScopeClaims = {
      v: 1, purpose: 'todo-board-mcp-write', userId: 'manager-a', tool: 'kanban.change',
      argsSha256: createHash('sha256').update(JSON.stringify(changeArgs)).digest('base64url'),
      projects: ['alpha'], owner: false, issuedAtMs, expiresAtMs: issuedAtMs + 120_000,
    };
    const signed = await client.callTool({ name: 'kanban.change', arguments: { ...changeArgs, exmanagerScope: signTodoWriteScope(privateKey, claims) } });
    expect(signed.isError, textFromResult(signed)).not.toBe(true);
    expect(findCardById(alpha.id, tasksDir)?.title).toBe('Manager update');

    const crossArgs = { cardId: beta.id, expectedVersion: beta.version, mode: 'edit', title: 'Foreign update' };
    const crossClaims: TodoMcpWriteScopeClaims = {
      ...claims,
      argsSha256: createHash('sha256').update(JSON.stringify(crossArgs)).digest('base64url'),
    };
    const cross = await client.callTool({ name: 'kanban.change', arguments: { ...crossArgs, exmanagerScope: signTodoWriteScope(privateKey, crossClaims) } });
    expect(cross.isError).toBe(true);
    expect(findCardById(beta.id, tasksDir)?.title).toBe('Beta task');
  });
});
