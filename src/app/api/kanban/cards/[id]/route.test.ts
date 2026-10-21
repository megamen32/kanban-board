import { NextRequest } from 'next/server';
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KanbanCard } from '@/lib/kanban/types';
import { nativeProjectAccessForRequest } from '../../../../../lib/kanban/native-project-access';

const { findCardById, updateCard, validateTransition, dispatchCardEvent, startDueReminderScheduler, tasksDirForScope, identity, authenticated, managerAuthorized, nativeAccess, nativeProjectAccessContextFromRequest } = vi.hoisted(() => ({
  findCardById: vi.fn(),
  updateCard: vi.fn(),
  validateTransition: vi.fn(),
  dispatchCardEvent: vi.fn(),
  startDueReminderScheduler: vi.fn(),
  tasksDirForScope: vi.fn(),
  identity: { current: { username: 'nikita', scope: 'work' as 'work' | 'personal' } },
  authenticated: { current: { username: 'nikita', scope: 'work' as const } as { username: string; scope: 'work' } | null },
  managerAuthorized: { current: false },
  nativeAccess: { current: null as null | { userId: string; forProject: (project: string) => Promise<{ project: string; team: string; readAllowed: true; writeAllowed: boolean }> } },
  nativeProjectAccessContextFromRequest: vi.fn(async (_request?: Request) => nativeAccess.current),
}));

vi.mock('@/lib/kanban/file-store', () => ({ findCardById, updateCard, deleteCard: vi.fn() }));
vi.mock('@/lib/kanban/due-at', () => ({ normalizeDueAt: vi.fn((value: unknown) => value) }));
vi.mock('@/lib/kanban/transition-policy', () => ({ validateTransition, NIKITA_ACTOR: 'nikita' }));
vi.mock('@/lib/auth/request', () => ({
  boardIdentityFromRequest: () => identity.current,
  identityFromRequest: () => authenticated.current,
  managerRequestAuthorized: () => managerAuthorized.current,
  nativeProjectAccessContextFromRequest,
}));
vi.mock('@/lib/auth/data-scope', () => ({ tasksDirForScope }));
vi.mock('@/lib/notifications/push', () => ({ dispatchCardEvent }));
vi.mock('@/lib/notifications/scheduler', () => ({ startDueReminderScheduler }));

vi.mock('@/lib/auth/board-human', () => ({ boardHumanIdentityFromRequest: async () => authenticated.current }));

import { GET, PATCH } from './route';

const existingCard: KanbanCard = {
  id: 'card-1',
  title: 'Prepare report',
  description: '',
  column: 'todo',
  priority: 'medium',
  tags: [],
  order: 0,
  created: '2026-08-12T00:00:00.000Z',
  updated: '2026-08-12T00:00:00.000Z',
  fileName: 'card-1.md',
  version: 2,
  project: 'Work',
  assignees: ['marina'],
};

function signedNativeCardGet(privateKey: KeyObject, cardId: string, userId: string, issuedAtMs: number): string {
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    userId,
    method: 'GET',
    path: `/api/kanban/cards/${cardId}`,
    bodySha256: createHash('sha256').update('').digest('base64url'),
    project: '',
    issuedAtMs,
    expiresAtMs: issuedAtMs + 60_000,
  }));
  const signature = sign(null, Buffer.concat([Buffer.from('airlock-todo-native-identity-v1\n'), payload]), privateKey);
  return `${payload.toString('base64url')}.${signature.toString('base64url')}`;
}

describe('PATCH /api/kanban/cards/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nativeAccess.current = null;
    identity.current = { username: 'nikita', scope: 'work' };
    authenticated.current = { username: 'nikita', scope: 'work' };
    managerAuthorized.current = false;
    nativeAccess.current = null;
    nativeProjectAccessContextFromRequest.mockImplementation(async () => nativeAccess.current);
    tasksDirForScope.mockReturnValue('/scoped/work');
    findCardById.mockReturnValue(existingCard);
    updateCard.mockReturnValue({ ...existingCard, version: 3 });
    dispatchCardEvent.mockResolvedValue({ sent: 1, failed: 0, removed: 0, skipped: false });
  });

  it('returns 400 and does not persist an inferred assignee change', async () => {
    validateTransition.mockReturnValue({ kind: 'rejected', reason: 'assignee_change_requires_owner_authorization' });

    const response = await PATCH(new NextRequest('http://localhost/api/kanban/cards/card-1', {
      method: 'PATCH',
      body: JSON.stringify({ assignees: ['nikita'] }),
      headers: { 'content-type': 'application/json' },
    }), { params: Promise.resolve({ id: 'card-1' }) });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'assignee_change_requires_owner_authorization' });
    expect(updateCard).not.toHaveBeenCalled();
  });

  it('allows authenticated nikita to explicitly confirm reassignment with intent and evidence', async () => {
    validateTransition.mockReturnValue({ kind: 'accepted', patch: { assignees: ['nikita'] } });

    const response = await PATCH(new NextRequest('http://localhost/api/kanban/cards/card-1', {
      method: 'PATCH',
      body: JSON.stringify({
        assignees: ['nikita'],
        reassignmentIntent: 'direct-owner-command',
        reassignmentEvidence: {
          type: 'caller-claimed',
          actor: 'attacker',
          origin: 'untrusted-client',
          source: 'owner-confirmation',
          requestId: 'confirm-1',
        },
      }),
      headers: { 'content-type': 'application/json' },
    }), { params: Promise.resolve({ id: 'card-1' }) });

    expect(response.status).toBe(200);
    expect(validateTransition).toHaveBeenCalledWith(
      existingCard,
      expect.objectContaining({ assignees: ['nikita'] }),
      expect.objectContaining({
        origin: 'human-ui',
        actor: 'nikita',
        ownerAuthorization: {
          actor: 'nikita',
          evidence: expect.objectContaining({
            type: 'direct-owner-command',
            actor: 'nikita',
            origin: 'rest',
            source: 'owner-confirmation',
            requestId: 'confirm-1',
          }),
        },
      }),
    );
    expect(updateCard).toHaveBeenCalledWith('card-1', { assignees: ['nikita'] }, undefined, '/scoped/work');
  });

  it('rejects reassignment intent and evidence from an unauthenticated request', async () => {
    identity.current = { username: 'anonymous', scope: 'work' };
    authenticated.current = null;
    validateTransition.mockReturnValue({ kind: 'rejected', reason: 'assignee_change_requires_owner_authorization' });

    const response = await PATCH(new NextRequest('http://localhost/api/kanban/cards/card-1', {
      method: 'PATCH',
      body: JSON.stringify({
        assignees: ['nikita'],
        reassignmentIntent: 'direct-owner-command',
        reassignmentEvidence: { source: 'owner-confirmation' },
      }),
      headers: { 'content-type': 'application/json' },
    }), { params: Promise.resolve({ id: 'card-1' }) });

    expect(response.status).toBe(400);
    expect(validateTransition).toHaveBeenCalledWith(
      existingCard,
      expect.objectContaining({ assignees: ['nikita'] }),
      { origin: 'automation', actor: 'anonymous' },
    );
    expect(updateCard).not.toHaveBeenCalled();
  });

  it('authorizes manager-service reassignment with server-owned evidence', async () => {
    identity.current = { username: 'anonymous', scope: 'work' };
    authenticated.current = null;
    managerAuthorized.current = true;
    validateTransition.mockReturnValue({ kind: 'accepted', patch: { assignees: ['nikita'] } });

    const response = await PATCH(new NextRequest('http://localhost/api/kanban/cards/card-1', {
      method: 'PATCH',
      body: JSON.stringify({ assignees: ['nikita'] }),
      headers: { 'content-type': 'application/json', 'x-kanban-manager-token': 'opaque' },
    }), { params: Promise.resolve({ id: 'card-1' }) });

    expect(response.status).toBe(200);
    expect(validateTransition).toHaveBeenCalledWith(existingCard, expect.objectContaining({ assignees: ['nikita'] }), expect.objectContaining({
      origin: 'automation',
      actor: 'manager',
      ownerAuthorization: {
        actor: 'nikita',
        evidence: expect.objectContaining({ type: 'direct-owner-command', origin: 'manager-service' }),
      },
    }));
  });

  it('returns 400 and does not persist an inferred deadline', async () => {
    validateTransition.mockReturnValue({ kind: 'rejected', reason: 'deadline_change_requires_human_ui' });

    const response = await PATCH(new NextRequest('http://localhost/api/kanban/cards/card-1', {
      method: 'PATCH',
      body: JSON.stringify({ dueAt: '2026-08-15T12:00:00.000Z' }),
      headers: { 'content-type': 'application/json' },
    }), { params: Promise.resolve({ id: 'card-1' }) });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'deadline_change_requires_human_ui' });
    expect(updateCard).not.toHaveBeenCalled();
  });

  it('does not treat anonymous public HTTP as a human completion confirmation', async () => {
    identity.current = { username: 'anonymous', scope: 'work' };
    authenticated.current = null;
    validateTransition.mockReturnValue({
      kind: 'redirected',
      reason: 'automation_done_requires_review',
      patch: { column: 'review', needsReview: true },
    });

    const response = await PATCH(new NextRequest('http://localhost/api/kanban/cards/card-1', {
      method: 'PATCH',
      body: JSON.stringify({ column: 'done' }),
      headers: { 'content-type': 'application/json' },
    }), { params: Promise.resolve({ id: 'card-1' }) });

    expect(response.status).toBe(200);
    expect(validateTransition).toHaveBeenCalledWith(
      existingCard,
      expect.objectContaining({ column: 'done' }),
      { origin: 'automation', actor: 'anonymous' },
    );
  });

  it('does not pass client completion or approval evidence to policy', async () => {
    validateTransition.mockReturnValue({ kind: 'accepted', patch: { title: 'Prepare report' } });

    const response = await PATCH(new NextRequest('http://localhost/api/kanban/cards/card-1', {
      method: 'PATCH',
      body: JSON.stringify({
        title: 'Prepare report',
        completionEvidence: [{ type: 'machine-verifiable', check: 'caller-claimed' }],
        approvalEvidence: [{ type: 'direct-owner-command', actor: 'nikita' }],
        completedBy: 'attacker',
        completedAt: '2000-01-01T00:00:00.000Z',
      }),
      headers: { 'content-type': 'application/json' },
    }), { params: Promise.resolve({ id: 'card-1' }) });

    expect(response.status).toBe(200);
    expect(validateTransition.mock.calls[0][1]).not.toEqual(expect.objectContaining({
      completionEvidence: expect.anything(),
      approvalEvidence: expect.anything(),
      completedBy: expect.anything(),
      completedAt: expect.anything(),
    }));
  });
});

describe('GET /api/kanban/cards/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    identity.current = { username: 'anonymous', scope: 'work' };
    authenticated.current = null;
    managerAuthorized.current = false;
    tasksDirForScope.mockReturnValue('/scoped/work');
    findCardById.mockReturnValue(existingCard);
  });

  it('preserves ordinary board reads without a manager header', async () => {
    const response = await GET(new NextRequest('http://localhost/api/kanban/cards/card-1'), {
      params: Promise.resolve({ id: 'card-1' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ card: existingCard });
    expect(findCardById).toHaveBeenCalledWith('card-1', '/scoped/work');
  });

  it('rejects an invalid supplied manager capability instead of falling back to anonymous access', async () => {
    const response = await GET(new NextRequest('http://localhost/api/kanban/cards/card-1', {
      headers: { 'x-kanban-manager-token': 'invalid' },
    }), { params: Promise.resolve({ id: 'card-1' }) });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
    expect(findCardById).not.toHaveBeenCalled();
  });

  it('returns the canonical card and version to an authorized manager caller', async () => {
    managerAuthorized.current = true;
    identity.current = { username: 'anonymous', scope: 'personal' };
    const response = await GET(new NextRequest('http://localhost/api/kanban/cards/card-1', {
      headers: { 'x-kanban-manager-token': 'valid' },
    }), { params: Promise.resolve({ id: 'card-1' }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ card: existingCard });
    expect(findCardById).toHaveBeenCalledWith('card-1', '/scoped/work');
  });

  it('checks the canonical project with the verified native member before returning a card', async () => {
    const cardId = '550e8400-e29b-41d4-a716-446655440000';
    const nativeCard = { ...existingCard, id: cardId, project: 'Integrators' };
    findCardById.mockReturnValue(nativeCard);
    const forProject = vi.fn(async () => ({ project: 'Integrators', team: 'integrator', readAllowed: true as const, writeAllowed: false }));
    nativeAccess.current = { userId: 'sdk-user-17', forProject };
    nativeProjectAccessContextFromRequest.mockResolvedValue(nativeAccess.current);
    const response = await GET(new NextRequest(`https://todo.example/api/kanban/cards/${cardId}`, {
      headers: { 'X-Airlock-Todo-Native-Identity': 'verified-by-resolver' },
    }), { params: Promise.resolve({ id: cardId }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ card: nativeCard });
    expect(tasksDirForScope).toHaveBeenCalledWith('work');
    expect(forProject).toHaveBeenCalledWith('Integrators');
    expect(findCardById).toHaveBeenCalledWith(cardId, '/scoped/work');
  });

  it('verifies a signed native header through the real request resolver before reading a saved card', async () => {
    const cardId = '550e8400-e29b-41d4-a716-446655440000';
    const savedCard = { ...existingCard, id: cardId, project: 'Integrators' };
    findCardById.mockReturnValue(savedCard);
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const now = Date.now();
    const scopeCalls: Array<{ url: string; project: string; userId: string; forwardedAssertion: string | null }> = [];
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      const assertion = new Headers(init?.headers).get('X-Airlock-Todo-Native-Identity');
      if (!assertion) throw new Error('scope request did not forward the verified assertion');
      const [encodedPayload] = assertion.split('.');
      const claims = JSON.parse(Buffer.from(encodedPayload!, 'base64url').toString('utf8')) as { userId: string };
      const body = JSON.parse(String(init?.body)) as { project: string };
      scopeCalls.push({ url: String(input), project: body.project, userId: claims.userId, forwardedAssertion: assertion });
      if (claims.userId !== 'sdk-native-member') return new Response('denied', { status: 403 });
      return new Response(JSON.stringify({ project: body.project, team: 'integrators-team', readAllowed: true, writeAllowed: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    nativeProjectAccessContextFromRequest.mockImplementation(async (request?: Request) => {
      if (!request) throw new Error('signed route request was not passed to the resolver');
      return nativeProjectAccessForRequest(request, {
        endpoint: 'https://exmanager.test/internal/todo/project-scope', publicKey, fetcher,
      });
    });

    const readAs = async (userId: string) => GET(new NextRequest(`https://todo.example/api/kanban/cards/${cardId}`, {
      headers: { 'X-Airlock-Todo-Native-Identity': signedNativeCardGet(privateKey, cardId, userId, now) },
    }), { params: Promise.resolve({ id: cardId }) });

    const member = await readAs('sdk-native-member');
    expect(member.status).toBe(200);
    expect(await member.json()).toEqual({ card: savedCard });
    expect(findCardById).toHaveBeenCalledWith(cardId, '/scoped/work');

    const outsider = await readAs('sdk-native-outsider');
    expect(outsider.status).toBe(404);
    expect(findCardById).toHaveBeenCalledTimes(2);
    expect(scopeCalls).toEqual([
      { url: 'https://exmanager.test/internal/todo/project-scope', project: 'Integrators', userId: 'sdk-native-member', forwardedAssertion: expect.any(String) },
      { url: 'https://exmanager.test/internal/todo/project-scope', project: 'Integrators', userId: 'sdk-native-outsider', forwardedAssertion: expect.any(String) },
    ]);
    expect(scopeCalls[0]?.forwardedAssertion).not.toBe(scopeCalls[1]?.forwardedAssertion);
    expect(tasksDirForScope).toHaveBeenCalledWith('work');
    expect(nativeProjectAccessContextFromRequest).toHaveBeenCalledTimes(2);
  });

  it('hides a native card without current project read access', async () => {
    const cardId = '550e8400-e29b-41d4-a716-446655440000';
    findCardById.mockReturnValue({ ...existingCard, id: cardId, project: 'Integrators' });
    const forProject = vi.fn(async () => { throw new Error('native_project_access_denied'); });
    nativeAccess.current = { userId: 'sdk-user-outsider', forProject };
    nativeProjectAccessContextFromRequest.mockResolvedValue(nativeAccess.current);
    const response = await GET(new NextRequest(`https://todo.example/api/kanban/cards/${cardId}`, {
      headers: { 'X-Airlock-Todo-Native-Identity': 'verified-by-resolver' },
    }), { params: Promise.resolve({ id: cardId }) });

    expect(response.status).toBe(404);
    expect(findCardById).toHaveBeenCalledTimes(1);
    expect(forProject).toHaveBeenCalledWith('Integrators');
  });

  it('fails closed on a present invalid native assertion, while preserving the anonymous legacy GET path', async () => {
    const cardId = '550e8400-e29b-41d4-a716-446655440000';
    nativeAccess.current = null;
    nativeProjectAccessContextFromRequest.mockRejectedValueOnce(new Error('native_identity_invalid'));
    const invalid = await GET(new NextRequest(`https://todo.example/api/kanban/cards/${cardId}`, {
      headers: { 'X-Airlock-Todo-Native-Identity': 'tampered' },
    }), { params: Promise.resolve({ id: cardId }) });
    expect(invalid.status).toBe(403);
    expect(findCardById).not.toHaveBeenCalled();

    nativeProjectAccessContextFromRequest.mockResolvedValue(null);
    const legacy = await GET(new NextRequest('http://localhost/api/kanban/cards/card-1'), {
      params: Promise.resolve({ id: 'card-1' }),
    });
    expect(legacy.status).toBe(200);
    expect(await legacy.json()).toEqual({ card: existingCard });
  });
});
