import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthStore } from '../../lib/auth/store';
import { POST } from './route';

const authSecret = 'planning-test-secret-012345678901234567890123';
const serviceName = 'gptadmin-todo-service';

describe('authenticated GPTAdmin board administrator', () => {
  let root: string;
  let auth: AuthStore;
  let token: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-planning-service-'));
    vi.stubEnv('KANBAN_SCOPE_ROOT', path.join(root, 'scopes'));
    vi.stubEnv('KANBAN_AUTH_DIR', path.join(root, 'auth'));
    vi.stubEnv('KANBAN_AUTH_SECRET', authSecret);
    vi.stubEnv('EXMANAGER_SOURCE_ADMISSION_PUBLIC_KEY', '');
    auth = new AuthStore({ rootDir: path.join(root, 'auth'), encryptionKey: authSecret });
    token = issueToken(serviceName, serviceName, 'kanban:work');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(root, { recursive: true, force: true });
  });

  function issueToken(username: string, clientId: string, scope: string) {
    const redirect = 'http://localhost/callback';
    const code = auth.createAuthorizationCode(username, clientId, redirect, scope);
    return auth.exchangeAuthorizationCode(code, clientId, redirect)!.accessToken;
  }

  async function callTool(name: string, args: Record<string, unknown>, bearer = token) {
    const response = await POST(new NextRequest('http://localhost/mcp', {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${bearer}`,
        'content-type': 'application/json',
        'mcp-protocol-version': '2025-06-18',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    }));
    return response.json();
  }

  async function change(args: Record<string, unknown>) {
    const body = await callTool('kanban.change', args);
    expect(body.error).toBeUndefined();
    expect(body.result.isError).not.toBe(true);
    return JSON.parse(body.result.content[0].text);
  }

  async function read(cardId: string) {
    const body = await callTool('kanban.read', { cardId });
    expect(body.result.isError).not.toBe(true);
    return JSON.parse(body.result.content[0].text).card;
  }

  async function list() {
    const body = await callTool('kanban.list', {});
    expect(body.result.isError).not.toBe(true);
    return JSON.parse(body.result.content[0].text).cards;
  }

  it('creates, reads, changes and clears assignee lists/deadlines with service audit identity', async () => {
    const created = await change({
      mode: 'new', title: 'Synthetic planning task', project: 'Fixture',
      assignees: ['fixture-first'],
      dueAt: '2030-01-02T15:00:00+03:00',
    });
    expect(created.card).toMatchObject({
      assignees: ['fixture-first'], dueAt: '2030-01-02T12:00:00.000Z',
      approvalEvidence: [expect.objectContaining({
        type: 'delegated_board_admin_change', actor: serviceName,
        origin: 'mcp', fields: expect.arrayContaining(['assignees', 'dueAt']),
      })],
    });
    expect(await read(created.card.id)).toEqual(created.card);

    const changed = await change({
      mode: 'edit', cardId: created.card.id, expectedVersion: created.card.version,
      assignees: ['fixture-second'], dueAt: '2030-01-03T12:00:00Z',
    });
    expect(changed.card).toMatchObject({
      assignees: ['fixture-second'], dueAt: '2030-01-03T12:00:00.000Z',
    });
    expect(await read(created.card.id)).toEqual(changed.card);

    const cleared = await change({
      mode: 'edit', cardId: changed.card.id, expectedVersion: changed.card.version,
      assignees: [], dueAt: null,
    });
    expect(cleared.card.assignees).toEqual([]);
    expect(cleared.card.dueAt).toBeUndefined();
    expect(cleared.card.approvalEvidence.every((entry: { actor: string }) => entry.actor === serviceName)).toBe(true);
    expect(await read(created.card.id)).toEqual(cleared.card);
  });

  it('round-trips an explicit calendar date without manufacturing a meeting time', async () => {
    const { card } = await change({
      mode: 'new', title: 'Synthetic date-only task', project: 'Fixture', dueAt: '2030-01-03',
    });
    expect(card.dueAt).toBe('2030-01-03');
    expect((await read(card.id)).dueAt).toBe('2030-01-03');
  });

  it('rejects missing, invalid and stale versions without writing', async () => {
    const { card } = await change({
      mode: 'new', title: 'Synthetic version task', project: 'Fixture', assignees: ['fixture-first'],
    });
    for (const expectedVersion of [undefined, 0, -1, card.version - 1]) {
      const body = await callTool('kanban.change', {
        mode: 'edit', cardId: card.id, expectedVersion, dueAt: '2030-01-03T12:00:00Z',
      });
      expect(body.error ?? body.result?.isError).toBeTruthy();
      expect(await read(card.id)).toEqual(card);
    }
  });

  it.each([
    ['wrong client', serviceName, 'other-client', 'kanban:work'],
    ['wrong username', 'other-user', serviceName, 'kanban:work'],
    ['wrong scope', serviceName, serviceName, 'kanban:personal'],
    ['human owner token', 'nikita', 'other-client', 'kanban:work'],
    ['ordinary client', 'other-user', 'other-client', 'kanban:work'],
    ['read-only app', 'airlock-todo-board-app', 'airlock-todo-board-app', 'kanban:work'],
    ['unsigned ExManager service', 'exmanager-service', 'exmanager-airlock-service', 'kanban:work'],
  ])('does not grant planning authority to %s, even with caller confirmation flags', async (_label, username, clientId, scope) => {
    const bearer = issueToken(username, clientId, scope);
    for (const fields of [{ assignees: ['fixture-first'] }, { dueAt: '2030-01-02T12:00:00Z' }]) {
      const body = await callTool('kanban.change', {
        mode: 'new', title: 'Synthetic denied task', project: 'Fixture',
        ownerCommandConfirmed: true, ...fields,
      }, bearer);
      expect(body.error ?? body.result?.isError).toBeTruthy();
      expect(await list()).toEqual([]);
    }
  });

  it('retains the planning audit when the same request submits an executor result', async () => {
    const { card } = await change({
      mode: 'new', title: 'Synthetic result task', project: 'Fixture',
    });
    const changed = await change({
      mode: 'edit', cardId: card.id, expectedVersion: card.version,
      assignees: ['fixture-first'], dueAt: '2030-01-03T12:00:00Z',
      executorResult: { summary: 'Synthetic work ready for review', evidenceRefs: ['fixture:result'] },
    });
    expect(changed.card).toMatchObject({
      column: 'review', needsReview: true,
      assignees: ['fixture-first'], dueAt: '2030-01-03T12:00:00.000Z',
      approvalEvidence: expect.arrayContaining([expect.objectContaining({
        type: 'delegated_board_admin_change', actor: serviceName, fields: expect.arrayContaining(['assignees', 'dueAt']),
      })]),
      resultHistory: [expect.objectContaining({ submittedBy: serviceName })],
    });
  });

  it('administers reviewers, executors and weekly planning with service audit identity', async () => {
    const { card } = await change({
      mode: 'new', title: 'Synthetic administration task', project: 'Fixture',
    });
    const updated = await change({
      mode: 'edit', cardId: card.id, expectedVersion: card.version,
      assignee: 'fixture-person', requiresApprovalFrom: ['fixture-reviewer'], executor: 'dot', week: '2030-W01', bigRock: true,
    });
    expect(updated.card).toMatchObject({
      assignee: 'fixture-person', requiresApprovalFrom: ['fixture-reviewer'], executor: 'dot', week: '2030-W01', bigRock: true,
      approvalEvidence: expect.arrayContaining([expect.objectContaining({
        type: 'delegated_board_admin_change', actor: serviceName,
      })]),
    });
  });

  it('accepts review and completes with server audit fields while retaining submitted result evidence', async () => {
    const { card } = await change({
      mode: 'new', title: 'Synthetic review task', project: 'Fixture',
      column: 'review', requiresApprovalFrom: ['fixture-reviewer'],
    });
    const completed = await change({
      mode: 'edit', cardId: card.id, expectedVersion: card.version,
      column: 'done', ownerCommandConfirmed: true, ownerCompletionConfirmed: true,
      completedBy: 'forged-human', completedAt: '2000-01-01T00:00:00.000Z',
      approvalEvidence: [{ type: 'forged-approval' }],
      completionEvidence: [{ type: 'synthetic-result', result: 'Synthetic completed deliverable' }],
    });
    expect(completed.card).toMatchObject({
      column: 'done', needsReview: false, requiresApprovalFrom: [],
      completedBy: serviceName,
      reviewHistory: [expect.objectContaining({ decision: 'accepted', actor: serviceName })],
      completionEvidence: [expect.objectContaining({
        type: 'delegated_board_admin_completion', actor: serviceName, origin: 'mcp',
        result: [{ type: 'synthetic-result', result: 'Synthetic completed deliverable' }],
      })],
    });
    expect(completed.card.completedAt).not.toBe('2000-01-01T00:00:00.000Z');
    expect(completed.card.approvalEvidence).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'forged-approval' }),
    ]));
  });

  it('preserves completion audit when a metadata edit repeats the unchanged done status', async () => {
    const { card } = await change({
      mode: 'new', title: 'Synthetic completed metadata task', project: 'Fixture', column: 'done',
      completionEvidence: [{ type: 'synthetic-result', result: 'Existing deliverable' }],
    });
    const updated = await change({
      mode: 'edit', cardId: card.id, expectedVersion: card.version,
      title: 'Synthetic corrected title', column: 'done',
    });
    expect(updated.card).toMatchObject({
      title: 'Synthetic corrected title', column: 'done', completedBy: card.completedBy,
      completedAt: card.completedAt, completionEvidence: card.completionEvidence,
    });
  });

  it('retains a newly submitted deliverable when an administrator updates an already completed card', async () => {
    const { card } = await change({
      mode: 'new', title: 'Synthetic completion update', project: 'Fixture', column: 'done',
      completionEvidence: [{ type: 'synthetic-result', result: 'First deliverable' }],
    });
    const updated = await change({
      mode: 'edit', cardId: card.id, expectedVersion: card.version, column: 'done',
      completionEvidence: [{ type: 'synthetic-result', result: 'Additional deliverable' }],
    });
    expect(updated.card.completionEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ result: [{ type: 'synthetic-result', result: 'First deliverable' }] }),
      expect.objectContaining({ result: [{ type: 'synthetic-result', result: 'Additional deliverable' }] }),
    ]));
  });

  it('reworks a review card without stranding review state, and still requires a blocker reason', async () => {
    const { card } = await change({
      mode: 'new', title: 'Synthetic rework task', project: 'Fixture', column: 'review',
    });
    const invalidFlag = await callTool('kanban.change', {
      mode: 'edit', cardId: card.id, expectedVersion: card.version, needsReview: false,
    });
    expect(invalidFlag.result.isError).toBe(true);
    expect(await read(card.id)).toEqual(card);

    const reworked = await change({
      mode: 'edit', cardId: card.id, expectedVersion: card.version, column: 'in-progress',
    });
    expect(reworked.card).toMatchObject({
      column: 'in-progress', needsReview: false,
      reviewHistory: [expect.objectContaining({ decision: 'rework', actor: serviceName })],
    });
    const blocked = await callTool('kanban.change', {
      mode: 'edit', cardId: card.id, expectedVersion: reworked.card.version, column: 'blocked',
    });
    expect(blocked.result.isError).toBe(true);
    expect(await read(card.id)).toEqual(reworked.card);
    const validBlocked = await change({
      mode: 'edit', cardId: card.id, expectedVersion: reworked.card.version,
      column: 'blocked', blockerReason: 'Synthetic dependency unavailable',
    });
    expect(validBlocked.card.column).toBe('blocked');
  });

  it('archives and restores the previous state without erasing completion or review history', async () => {
    const { card } = await change({
      mode: 'new', title: 'Synthetic archived task', project: 'Fixture', column: 'review',
    });
    const completed = await change({
      mode: 'edit', cardId: card.id, expectedVersion: card.version, column: 'done',
    });
    const archived = await change({
      mode: 'edit', cardId: card.id, expectedVersion: completed.card.version, column: 'archived',
    });
    expect(archived.card).toMatchObject({
      column: 'archived', completedBy: serviceName,
      completionEvidence: completed.card.completionEvidence, reviewHistory: completed.card.reviewHistory,
    });
    const wrongRestore = await callTool('kanban.change', {
      mode: 'edit', cardId: card.id, expectedVersion: archived.card.version, column: 'todo',
    });
    expect(wrongRestore.result.isError).toBe(true);
    expect(await read(card.id)).toEqual(archived.card);
    const restored = await change({
      mode: 'edit', cardId: card.id, expectedVersion: archived.card.version, column: 'done',
    });
    expect(restored.card).toMatchObject({
      column: 'done', completedAt: completed.card.completedAt,
      completionEvidence: completed.card.completionEvidence, reviewHistory: completed.card.reviewHistory,
    });
  });

  it('can create projects and delete cards through the existing native MCP tools', async () => {
    const ensured = await callTool('kanban.project.ensure', { externalKey: 'fixture:admin-project', name: 'Fixture admin project' });
    expect(ensured.result.isError).not.toBe(true);
    const { card } = await change({ mode: 'new', title: 'Synthetic removable task', project: 'Fixture admin project' });
    const deleted = await callTool('kanban.delete', { cardId: card.id });
    expect(deleted.result.isError).not.toBe(true);
    expect(await list()).toEqual([]);
  });
});
