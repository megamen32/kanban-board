import { describe, expect, it, vi } from 'vitest';
import { readBoundSessionStatus, sessionStatusOperation } from './session-status-read';
import type { KanbanCard, TaskExecutionProjectBinding, TaskExecutionReceipt } from './types';

const operationId = 'a'.repeat(64);
const checkedAt = '2026-11-07T12:00:00.000Z';
const binding: TaskExecutionProjectBinding = {
  contract: 'integrator-host-readiness-v1', projectId: 'Demo', projectRoot: '/srv/demo',
  rootIdentity: 'demo-root', policyRevision: 'policy-1', observedAtMs: 1, runtimeInstanceId: 'runtime-1',
  hostId: 'test-host', harness: 'codex', harnessVersion: 'test', model: 'test-model',
  requiredTools: [], availableTools: [], availableModels: ['test-model'], resourceReady: true, cwd: '/srv/demo',
  pathResolution: { requestedCwd: '/srv/demo', canonicalCwd: '/srv/demo', rootPath: '/srv/demo', contained: true, identityMatches: true },
};

function card(overrides: Partial<TaskExecutionReceipt> = {}): KanbanCard {
  return {
    id: 'test-card', title: 'Test', description: '', column: 'in-progress', priority: 'medium', tags: [], order: 1,
    created: checkedAt, updated: checkedAt, fileName: 'test.md', version: 4, project: 'Demo', owner: 'operator', assignees: [],
    taskExecutionHistory: [{
      operationId, requestHash: 'b'.repeat(64), lastBoardVersion: 4,
      createInputId: 'c'.repeat(64), messageInputId: 'd'.repeat(64), phase: 'created',
      hostId: binding.hostId, harness: binding.harness, nativeSessionId: 'session-1', projectBinding: binding,
      startedBy: 'operator', createdAt: checkedAt, updatedAt: checkedAt, ...overrides,
    }],
  };
}

function provider(overrides: Record<string, unknown> = {}) {
  return { content: [{ type: 'text', text: 'Private transcript must not be returned' }], structuredContent: { session: {
    id: 'session-1', hostId: binding.hostId, harness: binding.harness, cwd: binding.cwd, model: binding.model,
    status: 'running', lastActivity: '2026-11-01T10:00:00.000Z', ...overrides,
  } } };
}

function read(current: KanbanCard, result: unknown = provider(), options: { legacyCwd?: string; latest?: KanbanCard } = {}) {
  const readSession = vi.fn(async () => result);
  const readCard = vi.fn(() => options.latest ?? current);
  return {
    readSession, readCard,
    observed: readBoundSessionStatus(current, operationId, { readSession, readCard, legacyCwd: options.legacyCwd, now: () => new Date(checkedAt) }),
  };
}

describe('session status operation selection', () => {
  it('accepts only one saved operation selector and no caller-supplied target', () => {
    expect(sessionStatusOperation(new URLSearchParams({ session: 'status', operationId }))).toBe(operationId);
    for (const query of [
      `session=status`, `session=sync&operationId=${operationId}`, `session=status&operationId=x`,
      `session=status&operationId=${operationId}&operationId=${operationId}`,
      `session=status&session=status&operationId=${operationId}`,
      `session=status&operationId=${operationId}&hostId=foreign`,
      `session=status&operationId=${operationId}&sessionId=foreign`,
      `session=status&operationId=${operationId}&cwd=/foreign`,
      `session=status&operationId=${operationId}&target=preview`,
    ]) expect(sessionStatusOperation(new URLSearchParams(query))).toBeNull();
  });
});

describe('readBoundSessionStatus', () => {
  it.each([
    ['running', 'running'], ['needs_input', 'waiting'], ['idle', 'idle'], ['stopped', 'stopped'], ['error', 'error'],
    ['stalled', 'unknown'], ['completed', 'unknown'], [undefined, 'unknown'],
  ])('maps only the documented source status %s to %s', async (source, expected) => {
    const current = card();
    const before = structuredClone(current);
    const observation = read(current, provider({ status: source }));
    expect(await observation.observed).toEqual({ status: 200, body: {
      cardId: current.id, cardVersion: 4, operationId, sessionId: 'session-1', state: expected,
      source: 'agent-herder:agent_info', checkedAt, lastActivityAt: '2026-11-01T10:00:00.000Z',
      reason: expected === 'unknown' ? 'status_unknown' : null,
    } });
    expect(observation.readSession).toHaveBeenCalledExactlyOnceWith({ hostId: 'test-host', harness: 'codex', sessionId: 'session-1' }, 8_000);
    expect(observation.readCard).toHaveBeenCalledOnce();
    expect(current).toEqual(before);
  });

  it.each([undefined, 'not a time', 'yesterday', 1730000000000])('keeps missing or invalid provider time unknown: %s', async lastActivity => {
    expect((await read(card(), provider({ lastActivity })).observed).body.lastActivityAt).toBeNull();
  });

  it('never infers the live state from an old receipt, card status, or progress', async () => {
    const current = { ...card({ phase: 'waiting', lastProgress: 'stalled', updatedAt: '2000-01-01T00:00:00Z' }), column: 'blocked' as const };
    const result = await read(current, provider({ status: undefined, lastActivity: undefined })).observed;
    expect(result.body).toMatchObject({ state: 'unknown', reason: 'status_unknown', lastActivityAt: null });
  });

  it.each([
    ['id', 'different-session'], ['hostId', 'different-host'], ['harness', 'opencode'],
    ['cwd', '/foreign'], ['model', 'different-model'], ['id', undefined],
  ])('refuses a provider response with a different or missing %s', async (field, value) => {
    const result = await read(card(), provider({ [field]: value })).observed;
    expect(result).toMatchObject({ status: 502, body: {
      state: 'unknown', source: null, checkedAt: null, lastActivityAt: null, reason: 'session_identity_unverified',
    } });
    expect(JSON.stringify(result)).not.toContain('Private transcript');
  });

  it.each([null, [], { isError: true, ...provider() }, { content: [{ type: 'text', text: JSON.stringify(provider().structuredContent) }] }])(
    'does not turn malformed or text-only responses into an observed status', async result => {
      const observed = await read(card(), result).observed;
      expect(observed.status).toBe(502);
      expect(observed.body).toMatchObject({ state: 'unknown', source: null, checkedAt: null });
    },
  );

  it.each([
    [{ provider: 'dot' as const }, 'provider_not_supported', 200],
    [{ harness: 'dot' as const }, 'provider_not_supported', 200],
    [{ nativeSessionId: undefined }, 'session_not_recorded', 200],
    [{ hostId: 'foreign-host' }, 'session_binding_unavailable', 409],
    [{ projectBinding: { ...binding, projectId: 'Foreign' } }, 'session_binding_unavailable', 409],
    [{ projectBinding: { ...binding, cwd: 'relative/path' } }, 'session_binding_unavailable', 409],
  ] as const)('avoids provider calls for unsupported or inconsistent bindings', async (overrides, reason, status) => {
    const observation = read(card(overrides), provider(), { legacyCwd: '/srv/legacy' });
    expect(await observation.observed).toMatchObject({ status, body: { state: 'unknown', source: null, checkedAt: null, reason } });
    expect(observation.readSession).not.toHaveBeenCalled();
  });

  it('rejects absent and ambiguous saved operations before reading the provider', async () => {
    const absent = card();
    absent.taskExecutionHistory = [];
    const missing = read(absent);
    expect(await missing.observed).toMatchObject({ status: 404, body: { reason: 'operation_not_found', sessionId: null } });
    expect(missing.readSession).not.toHaveBeenCalled();
    const duplicate = card();
    duplicate.taskExecutionHistory!.push({ ...duplicate.taskExecutionHistory![0]! });
    const ambiguous = read(duplicate);
    expect(await ambiguous.observed).toMatchObject({ status: 409, body: { reason: 'operation_ambiguous', sessionId: null } });
    expect(ambiguous.readSession).not.toHaveBeenCalled();
  });

  it('uses the existing explicit legacy binding without inventing a path or model', async () => {
    const legacy = card({ projectBinding: undefined, createReceiptText: JSON.stringify({ cwd: '/srv/legacy' }) });
    expect((await read(legacy, provider({ cwd: '/srv/legacy', model: 'gpt-6-luna' })).observed).body.state).toBe('running');
    const configured = card({ projectBinding: undefined });
    expect((await read(configured, provider({ cwd: '/srv/configured', model: 'gpt-6-luna' }), { legacyCwd: '/srv/configured' }).observed).body.state).toBe('running');
    const unbound = read(configured);
    expect(await unbound.observed).toMatchObject({ status: 409, body: { reason: 'session_binding_unavailable' } });
    expect(unbound.readSession).not.toHaveBeenCalled();
  });

  it.each(['version', 'project', 'owner', 'assignees', 'receipt'])('rejects an observation if the card %s changes during the read', async field => {
    const current = card();
    const latest = structuredClone(current);
    if (field === 'version') latest.version++;
    if (field === 'project') latest.project = 'Foreign';
    if (field === 'owner') latest.owner = 'foreign';
    if (field === 'assignees') latest.assignees = ['foreign'];
    if (field === 'receipt') latest.taskExecutionHistory![0]!.nativeSessionId = 'new-session';
    expect(await read(current, provider(), { latest }).observed).toMatchObject({ status: 409, body: {
      state: 'unknown', reason: 'card_changed', checkedAt: null,
    } });
  });

  it.each([
    ['task_execution_transport_unconfigured', 'transport_unconfigured'],
    ['Bearer fake-token /private/stack\nsecret', 'transport_unavailable'],
  ])('sanitizes transport failures and leaves the status unknown', async (message, reason) => {
    const current = card();
    const readCard = vi.fn(() => current);
    const observed = await readBoundSessionStatus(current, operationId, {
      readSession: async () => { throw new Error(message); }, readCard,
    });
    expect(observed).toMatchObject({ status: 503, body: { state: 'unknown', checkedAt: null, source: null, reason } });
    expect(JSON.stringify(observed)).not.toMatch(/fake-token|private|secret|stack/);
    expect(readCard).not.toHaveBeenCalled();
  });

  it('keeps missing or unreadable final card data unknown', async () => {
    for (const readCard of [() => undefined, () => { throw new Error('private file error'); }]) {
      const observed = await readBoundSessionStatus(card(), operationId, { readSession: async () => provider(), readCard });
      expect(observed.body).toMatchObject({ state: 'unknown', checkedAt: null, source: null });
      expect(JSON.stringify(observed)).not.toContain('private file error');
    }
  });
});
