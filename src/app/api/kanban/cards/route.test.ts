import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KanbanCard } from '@/lib/kanban/types';

const { createCard, updateCard, getAllCards, listProjects, validateTransition, dispatchCardEvent, startDueReminderScheduler, tasksDirForScope, identity, authenticated, managerAuthorized, nativeAccess, nativeProjectAccessContextFromRequest, ownerBrowserReadAllowed } = vi.hoisted(() => ({
  createCard: vi.fn(),
  updateCard: vi.fn(),
  getAllCards: vi.fn(),
  listProjects: vi.fn(),
  validateTransition: vi.fn(),
  dispatchCardEvent: vi.fn(),
  startDueReminderScheduler: vi.fn(),
  tasksDirForScope: vi.fn(),
  identity: { current: { username: 'nikita', scope: 'work' as const } },
  authenticated: { current: { username: 'nikita', scope: 'work' as const } as { username: string; scope: 'work' | 'personal' } | null },
  managerAuthorized: { current: false },
  nativeAccess: { current: null as null | { userId: string; forProject: ReturnType<typeof vi.fn> } },
  nativeProjectAccessContextFromRequest: vi.fn(async () => nativeAccess.current),
  ownerBrowserReadAllowed: vi.fn(async () => false),
}));

vi.mock('@/lib/kanban/file-store', () => ({ createCard, updateCard, getAllCards }));
vi.mock('../../../../lib/kanban/project-store', () => ({ listProjects }));
vi.mock('@/lib/kanban/due-at', () => ({ normalizeDueAt: vi.fn((value: unknown) => value) }));
vi.mock('@/lib/kanban/transition-policy', () => ({ validateTransition, NIKITA_ACTOR: 'nikita' }));
vi.mock('@/lib/auth/request', () => ({
  boardIdentityFromRequest: () => identity.current,
  identityFromRequest: () => authenticated.current,
  managerRequestAuthorized: () => managerAuthorized.current,
  nativeProjectAccessContextFromRequest,
}));
vi.mock('@/lib/auth/owner-browser-read', () => ({ ownerBrowserReadAllowed }));
vi.mock('@/lib/auth/data-scope', () => ({ tasksDirForScope }));
vi.mock('@/lib/notifications/push', () => ({ dispatchCardEvent }));
vi.mock('@/lib/notifications/scheduler', () => ({ startDueReminderScheduler }));

vi.mock('@/lib/auth/board-human', () => ({ boardHumanIdentityFromRequest: async () => authenticated.current }));

import { GET, POST } from './route';

const createdCard: KanbanCard = {
  id: 'created',
  title: 'Finish report',
  description: '',
  column: 'done',
  priority: 'medium',
  tags: [],
  order: 0,
  created: '2026-08-12T00:00:00.000Z',
  updated: '2026-08-12T00:00:00.000Z',
  fileName: 'created.md',
  version: 1,
  project: 'Work',
  assignees: [],
};

describe('POST /api/kanban/cards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    identity.current = { username: 'nikita', scope: 'work' };
    authenticated.current = { username: 'nikita', scope: 'work' };
    authenticated.current = { username: 'nikita', scope: 'work' };
    managerAuthorized.current = false;
    tasksDirForScope.mockReturnValue('/scoped/work');
    createCard.mockReturnValue(createdCard);
    updateCard.mockReturnValue(createdCard);
    dispatchCardEvent.mockResolvedValue({ sent: 1, failed: 0, removed: 0, skipped: false });
    validateTransition.mockReturnValue({ kind: 'accepted', patch: {} });
  });

  it('persists manual UI completion evidence with the authenticated actor', async () => {
    validateTransition.mockReturnValue({
      kind: 'accepted',
      patch: { column: 'done', completionEvidence: [{ type: 'manual_confirmation', actor: 'nikita' }] },
    });
    const response = await POST(new NextRequest('http://localhost/api/kanban/cards', {
      method: 'POST',
      body: JSON.stringify({ title: 'Finish report', project: 'Work', column: 'done' }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(201);
    expect(validateTransition).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ column: 'done' }),
      { origin: 'human-ui', actor: 'nikita', isCreation: true },
    );
    expect(updateCard).toHaveBeenCalledWith(
      'created',
      expect.objectContaining({
        column: 'done',
        completionEvidence: [expect.objectContaining({ type: 'manual_confirmation', actor: 'nikita' })],
      }),
      undefined,
      '/scoped/work',
    );
  });

  it('passes an authorized initial parent and owner to the atomic store create', async () => {
    validateTransition.mockReturnValue({ kind: 'accepted', patch: { parent: 'existing-parent', owner: 'oleg' } });
    const response = await POST(new NextRequest('http://localhost/api/kanban/cards', {
      method: 'POST',
      body: JSON.stringify({ title: 'Tender pilot', project: 'Work', parent: 'existing-parent' }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(201);
    expect(createCard).toHaveBeenCalledWith(
      'Tender pilot', undefined, undefined, undefined, undefined, 'Work', undefined, '/scoped/work', undefined,
      { parent: 'existing-parent', owner: 'oleg' },
    );
    expect(updateCard).not.toHaveBeenCalled();
  });

  it('validates and persists the explicit blocker reason when creating a blocked card', async () => {
    validateTransition.mockReturnValue({
      kind: 'accepted',
      patch: { column: 'blocked', blockerReason: 'Waiting for the partner test file.' },
    });

    const response = await POST(new NextRequest('http://localhost/api/kanban/cards', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Prepare workbook report',
        project: 'UX QA 2026-10-26',
        column: 'blocked',
        blockerReason: 'Waiting for the partner test file.',
      }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(201);
    expect(validateTransition).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ column: 'blocked', blockerReason: 'Waiting for the partner test file.' }),
      { origin: 'human-ui', actor: 'nikita', isCreation: true },
    );
    expect(updateCard).toHaveBeenCalledWith(
      'created',
      expect.objectContaining({ column: 'blocked', blockerReason: 'Waiting for the partner test file.' }),
      undefined,
      '/scoped/work',
    );
  });

  it('passes creation context so an authenticated human may choose initial assignees', async () => {
    validateTransition.mockReturnValue({ kind: 'accepted', patch: { assignees: ['marina'] } });
    const response = await POST(new NextRequest('http://localhost/api/kanban/cards', {
      method: 'POST',
      body: JSON.stringify({ title: 'Delegate report', project: 'Work', assignees: ['marina'] }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(201);
    expect(validateTransition).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ assignees: ['marina'] }),
      expect.objectContaining({ origin: 'human-ui', actor: 'nikita', isCreation: true }),
    );
    expect(validateTransition.mock.calls[0][2]).toEqual(expect.objectContaining({
      ownerAuthorization: {
        actor: 'nikita',
        evidence: expect.objectContaining({ type: 'direct-owner-command' }),
      },
    }));
  });

  it('does not authorize initial assignment for a non-owner authenticated user', async () => {
    authenticated.current = { username: 'marina', scope: 'work' };
    identity.current = { username: 'marina', scope: 'work' };
    validateTransition.mockReturnValue({ kind: 'rejected', reason: 'assignee_change_requires_owner_authorization' });

    const response = await POST(new NextRequest('http://localhost/api/kanban/cards', {
      method: 'POST',
      body: JSON.stringify({ title: 'Delegate report', project: 'Work', assignees: ['igor'] }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(400);
    expect(validateTransition.mock.calls[0][2]).toEqual({
      origin: 'human-ui',
      actor: 'marina',
      isCreation: true,
    });
    expect(createCard).not.toHaveBeenCalled();
  });

  it('authorizes manager-service assignment while retaining automation transition rules', async () => {
    identity.current = { username: 'anonymous', scope: 'work' };
    authenticated.current = null;
    managerAuthorized.current = true;
    validateTransition.mockReturnValue({ kind: 'accepted', patch: { assignees: ['marina'] } });

    const response = await POST(new NextRequest('http://localhost/api/kanban/cards', {
      method: 'POST',
      body: JSON.stringify({ title: 'Delegated by manager', project: 'Work', assignees: ['marina'] }),
      headers: { 'content-type': 'application/json', 'x-kanban-manager-token': 'opaque' },
    }));

    expect(response.status).toBe(201);
    expect(validateTransition.mock.calls[0][2]).toEqual(expect.objectContaining({
      origin: 'automation',
      actor: 'manager',
      isCreation: true,
      ownerAuthorization: {
        actor: 'nikita',
        evidence: expect.objectContaining({ type: 'direct-owner-command', origin: 'manager-service' }),
      },
    }));
  });

  it('does not pass client completion or approval evidence to policy', async () => {
    const response = await POST(new NextRequest('http://localhost/api/kanban/cards', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Forged audit',
        project: 'Work',
        completionEvidence: [{ type: 'machine-verifiable', check: 'caller-claimed' }],
        approvalEvidence: [{ type: 'direct-owner-command', actor: 'nikita' }],
        completedBy: 'attacker',
        completedAt: '2000-01-01T00:00:00.000Z',
      }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(201);
    expect(validateTransition.mock.calls[0][1]).not.toEqual(expect.objectContaining({
      completionEvidence: expect.anything(),
      approvalEvidence: expect.anything(),
      completedBy: expect.anything(),
      completedAt: expect.anything(),
    }));
  });

  it('does not let a request body escape the authenticated board scope', async () => {
    const response = await POST(new NextRequest('http://localhost/api/kanban/cards', {
      method: 'POST',
      body: JSON.stringify({ title: 'Scoped card', project: 'Work', scope: 'personal' }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(201);
    expect(tasksDirForScope).toHaveBeenCalledWith('work');
    expect(createCard).toHaveBeenCalledWith(
      'Scoped card',
      undefined,
      undefined,
      undefined,
      undefined,
      'Work',
      undefined,
      '/scoped/work',
      undefined,
    );
    expect(tasksDirForScope).not.toHaveBeenCalledWith('personal');
  });

  it('does not treat anonymous public HTTP as a human completion confirmation', async () => {
    identity.current = { username: 'anonymous', scope: 'work' };
    authenticated.current = null;
    validateTransition.mockReturnValue({
      kind: 'redirected',
      reason: 'automation_done_requires_review',
      patch: { column: 'review', needsReview: true },
    });

    const response = await POST(new NextRequest('http://localhost/api/kanban/cards', {
      method: 'POST',
      body: JSON.stringify({ title: 'Public completion', project: 'Work', column: 'done' }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(201);
    expect(validateTransition).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ column: 'done' }),
      { origin: 'automation', actor: 'anonymous', isCreation: true },
    );
  });

  it('accepts a personal role label rather than a global hardcoded role', async () => {
    const response = await POST(new NextRequest('http://localhost/api/kanban/cards', {
      method: 'POST',
      body: JSON.stringify({ title: 'Personal role', project: 'Work', role: 'Client success' }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(201);
    expect(createCard).toHaveBeenCalled();
  });
});

describe('GET /api/kanban/cards', () => {
  const allowed = { ...createdCard, id: 'allowed-card', project: 'Олег и Никита' };
  const qaCard = { ...createdCard, id: 'qa-card', project: 'ExManager QA' };
  const testLoginQaCard = {
    ...createdCard, id: '43687640-5245-4ec4-b29c-2b8970cb9d30',
    project: 'UX QA 2026-10-26', owner: 'testlogin',
  };
  const alpha = { ...createdCard, id: 'alpha-card', project: 'Alpha' };
  const beta = { ...createdCard, id: 'beta-card', project: 'Beta' };
  const legacy = { ...createdCard, id: 'legacy-card', project: 'Legacy' };
  const projects = [
    { id: '00000000-0000-4000-8000-000000000001', externalKey: 'alpha-key', name: 'Alpha' },
    { id: '00000000-0000-4000-8000-000000000002', externalKey: 'empty-key', name: 'Empty project' },
    { id: '00000000-0000-4000-8000-000000000003', externalKey: 'beta-key', name: 'Beta' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    nativeAccess.current = null;
    nativeProjectAccessContextFromRequest.mockReset().mockResolvedValue(null);
    ownerBrowserReadAllowed.mockReset().mockResolvedValue(false);
    identity.current = { username: 'nikita', scope: 'work' };
    authenticated.current = { username: 'nikita', scope: 'work' };
    tasksDirForScope.mockReturnValue('/scoped/work');
    getAllCards.mockReturnValue([allowed, qaCard, alpha, beta, legacy]);
    listProjects.mockReturnValue([...projects, { id: 'board-project', externalKey: 'board', name: 'Олег и Никита' }, { id: 'qa-project', externalKey: 'exmanager-qa', name: 'ExManager QA' }]);
  });

  it('returns only the verified board project for nikita despite other shared-store projects', async () => {
    authenticated.current = { username: 'nikita', scope: 'work' };
    const response = await GET(new NextRequest('https://todo.example/api/kanban/cards'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      cards: [allowed],
      projects: [{ id: 'board-project', externalKey: 'board', name: 'Олег и Никита' }],
    });
    expect(tasksDirForScope).toHaveBeenCalledWith('work');
  });

  it('uses the existing owner browser read grant before the unavailable native resolver', async () => {
    ownerBrowserReadAllowed.mockResolvedValueOnce(true);
    nativeProjectAccessContextFromRequest.mockRejectedValueOnce(new Error('native_identity_unconfigured'));
    const response = await GET(new NextRequest('https://todo-board.airlock.bezrabotnyi.com/api/kanban/cards', {
      headers: {
        cookie: 'kanban_session=owner-session',
        'X-Airlock-Todo-Native-Identity': 'verified-owner-assertion',
      },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      cards: [allowed],
      projects: [{ id: 'board-project', externalKey: 'board', name: 'Олег и Никита' }],
    });
    expect(ownerBrowserReadAllowed).toHaveBeenCalledOnce();
    expect(nativeProjectAccessContextFromRequest).not.toHaveBeenCalled();
  });

  it('keeps a native-only request on the existing fail-closed project resolver', async () => {
    ownerBrowserReadAllowed.mockResolvedValueOnce(false);
    nativeProjectAccessContextFromRequest.mockRejectedValueOnce(new Error('native_identity_unconfigured'));
    const response = await GET(new NextRequest('https://todo-board.airlock.bezrabotnyi.com/api/kanban/cards', {
      headers: { 'X-Airlock-Todo-Native-Identity': 'verified-native-assertion' },
    }));
    expect(response.status).toBe(503);
    expect(nativeProjectAccessContextFromRequest).toHaveBeenCalledOnce();
  });

  it('returns only the server-allowlisted board project, independent of query hints', async () => {
    authenticated.current = { username: 'oleg', scope: 'work' };
    const response = await GET(new NextRequest('https://todo.example/api/kanban/cards?project=Alpha'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cards: [allowed], projects: [{ id: 'board-project', externalKey: 'board', name: 'Олег и Никита' }] });
  });

  it('allows the other exact server-resolved board identity for the same project only', async () => {
    identity.current = { username: 'oleg', scope: 'work' };
    authenticated.current = { username: 'oleg', scope: 'work' };
    const response = await GET(new NextRequest('https://todo.example/api/kanban/cards?project=Beta'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cards: [allowed], projects: [{ id: 'board-project', externalKey: 'board', name: 'Олег и Никита' }] });
  });

  it.each(['qa_exmanager_a', 'qa_exmanager_b'])('allows QA identity %s to read only the isolated QA project', async username => {
    identity.current = { username, scope: 'work' };
    authenticated.current = { username, scope: 'work' };
    const response = await GET(new NextRequest('https://todo.example/api/kanban/cards?project=Олег%20и%20Никита'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cards: [qaCard], projects: [{ id: 'qa-project', externalKey: 'exmanager-qa', name: 'ExManager QA' }] });
  });

  it('preserves the anonymous loopback fixture read for only the synthetic UX QA project', async () => {
    authenticated.current = null;
    vi.stubEnv('KANBAN_QA_ANONYMOUS_READS', '1');
    const secondFixture = { ...testLoginQaCard, id: 'another-loopback-fixture' };
    getAllCards.mockReturnValue([testLoginQaCard, secondFixture, alpha]);
    listProjects.mockReturnValue([
      { id: 'ux-qa-project', externalKey: 'ux-qa', name: 'UX QA 2026-10-26' },
      { id: 'other-project', externalKey: 'other', name: 'Alpha' },
    ]);

    const response = await GET(new NextRequest('http://127.0.0.1:3001/api/kanban/cards', {
      headers: { 'x-forwarded-host': '127.0.0.1:43330' },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      cards: [testLoginQaCard, secondFixture],
      projects: [{ id: 'ux-qa-project', externalKey: 'ux-qa', name: 'UX QA 2026-10-26' }],
    });
    expect(tasksDirForScope).toHaveBeenCalledWith('work');
  });

  it('returns only the exact synthetic card to testlogin on the isolated QA board', async () => {
    authenticated.current = { username: 'testlogin', scope: 'work' };
    vi.stubEnv('KANBAN_QA_ANONYMOUS_READS', '1');
    const anotherCard = { ...testLoginQaCard, id: 'another-qa-card' };
    const sameIdOtherProject = { ...testLoginQaCard, project: 'Alpha' };
    getAllCards.mockReturnValue([testLoginQaCard, anotherCard, sameIdOtherProject, alpha]);
    listProjects.mockReturnValue([
      { id: 'ux-qa-project', externalKey: 'ux-qa', name: 'UX QA 2026-10-26' },
      { id: 'other-project', externalKey: 'other', name: 'Alpha' },
    ]);

    const response = await GET(new NextRequest('https://qa-board.bezrabotnyi.com/api/kanban/cards'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      cards: [testLoginQaCard],
      projects: [{ id: 'ux-qa-project', externalKey: 'ux-qa', name: 'UX QA 2026-10-26' }],
    });
    expect(tasksDirForScope).toHaveBeenCalledWith('work');
  });

  it('keeps isolated QA card reads off for anonymous, unrelated, and personal identities', async () => {
    vi.stubEnv('KANBAN_QA_ANONYMOUS_READS', '1');
    authenticated.current = null;
    const anonymous = await GET(new NextRequest('https://qa-board.bezrabotnyi.com/api/kanban/cards'));
    expect(await anonymous.json()).toEqual({ cards: [], projects: [] });
    expect(getAllCards).not.toHaveBeenCalled();

    authenticated.current = { username: 'other-user', scope: 'work' };
    const unrelatedIdentity = await GET(new NextRequest('https://qa-board.bezrabotnyi.com/api/kanban/cards'));
    expect(await unrelatedIdentity.json()).toEqual({ cards: [], projects: [] });
    expect(getAllCards).not.toHaveBeenCalled();

    authenticated.current = { username: 'testlogin', scope: 'personal' };
    const personalScope = await GET(new NextRequest('https://qa-board.bezrabotnyi.com/api/kanban/cards'));
    expect(await personalScope.json()).toEqual({ cards: [], projects: [] });
    expect(getAllCards).not.toHaveBeenCalled();

    authenticated.current = { username: 'testlogin', scope: 'work' };
    const unrelatedHost = await GET(new NextRequest('https://todo.example/api/kanban/cards'));
    expect(await unrelatedHost.json()).toEqual({ cards: [], projects: [] });
    expect(getAllCards).not.toHaveBeenCalled();
  });

  it('does not enable testlogin self-read when the QA runtime flag is absent', async () => {
    authenticated.current = { username: 'testlogin', scope: 'work' };

    const response = await GET(new NextRequest('https://qa-board.bezrabotnyi.com/api/kanban/cards'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cards: [], projects: [] });
    expect(getAllCards).not.toHaveBeenCalled();
    expect(listProjects).not.toHaveBeenCalled();
  });

  it('fails closed for another verified identity without reading the shared store', async () => {
    identity.current = { username: 'other-user', scope: 'work' };
    authenticated.current = { username: 'other-user', scope: 'work' };
    const response = await GET(new NextRequest('https://todo.example/api/kanban/cards'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cards: [], projects: [] });
    expect(getAllCards).not.toHaveBeenCalled();
    expect(listProjects).not.toHaveBeenCalled();
  });

  it('does not authorize the presentation-only board identity when server identity verification fails', async () => {
    identity.current = { username: 'nikita', scope: 'work' };
    authenticated.current = null;
    const response = await GET(new NextRequest('https://todo.example/api/kanban/cards'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cards: [], projects: [] });
    expect(getAllCards).not.toHaveBeenCalled();
    expect(listProjects).not.toHaveBeenCalled();
  });

  it('filters every persisted card and empty project through current native membership', async () => {
    authenticated.current = null;
    const forProject = vi.fn(async (project: string) => {
      if (project === 'ExManager QA' || project === 'Beta' || project === 'Legacy') throw new Error('native_project_access_denied');
      return { project, team: 'integrator', readAllowed: true as const, writeAllowed: false };
    });
    nativeAccess.current = { userId: 'sdk-user-17', forProject };
    nativeProjectAccessContextFromRequest.mockResolvedValue(nativeAccess.current);
    const response = await GET(new NextRequest('https://todo.example/api/kanban/cards', {
      headers: { 'X-Airlock-Todo-Native-Identity': 'verified-test-assertion' },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cards: [allowed, alpha], projects: [projects[0], projects[1], { id: 'board-project', externalKey: 'board', name: 'Олег и Никита' }] });
    expect(forProject.mock.calls.map(([project]) => project)).toEqual(['Олег и Никита', 'ExManager QA', 'Alpha', 'Beta', 'Legacy', 'Empty project']);
    expect(tasksDirForScope).toHaveBeenCalledWith('work');
  });

  it('treats a signed project query only as a filter and still checks its current grant', async () => {
    const forProject = vi.fn(async (project: string) => {
      if (project === 'Beta') throw new Error('native_project_access_denied');
      return { project, team: 'integrator', readAllowed: true as const, writeAllowed: false };
    });
    nativeAccess.current = { userId: 'sdk-user-17', forProject };
    nativeProjectAccessContextFromRequest.mockResolvedValue(nativeAccess.current);
    const response = await GET(new NextRequest('https://todo.example/api/kanban/cards?project=Beta', {
      headers: { 'X-Airlock-Todo-Native-Identity': 'verified-test-assertion' },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cards: [], projects: [] });
    expect(forProject).toHaveBeenCalledTimes(1);
    expect(forProject).toHaveBeenCalledWith('Beta');
  });

  it('does not fall back to public legacy listing when a native assertion is invalid', async () => {
    nativeProjectAccessContextFromRequest.mockRejectedValueOnce(new Error('native_identity_invalid'));
    const response = await GET(new NextRequest('https://todo.example/api/kanban/cards', {
      headers: { 'X-Airlock-Todo-Native-Identity': 'tampered' },
    }));

    expect(response.status).toBe(403);
    expect(getAllCards).not.toHaveBeenCalled();
  });

  it('preserves the existing no-assertion legacy list behavior', async () => {
    identity.current = { username: 'oleg', scope: 'work' };
    authenticated.current = { username: 'oleg', scope: 'work' };
    const response = await GET(new NextRequest('https://todo.example/api/kanban/cards'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cards: [allowed], projects: [{ id: 'board-project', externalKey: 'board', name: 'Олег и Никита' }] });
    expect(nativeProjectAccessContextFromRequest).toHaveBeenCalledTimes(1);
  });
});
