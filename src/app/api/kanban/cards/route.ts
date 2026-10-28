import { NextRequest, NextResponse } from 'next/server';
import { getAllCards, createCard, updateCard } from '@/lib/kanban/file-store';
import type { KanbanCard, KanbanCardUpdates } from '@/lib/kanban/types';
import { boardIdentityFromRequest, managerRequestAuthorized, nativeProjectAccessContextFromRequest } from '@/lib/auth/request';
import { boardHumanIdentityFromRequest } from '@/lib/auth/board-human';
import { ownerBrowserReadAllowed } from '@/lib/auth/owner-browser-read';
import { tasksDirForScope } from '@/lib/auth/data-scope';
import { listProjects } from '../../../../lib/kanban/project-store';
import { normalizeDueAt } from '@/lib/kanban/due-at';
import { dispatchCardEvent } from '@/lib/notifications/push';
import { startDueReminderScheduler } from '@/lib/notifications/scheduler';
import { validateTransition } from '@/lib/kanban/transition-policy';
import { NIKITA_ACTOR } from '@/lib/kanban/transition-policy';

const VERIFIED_BOARD_PROJECT = 'Олег и Никита';
const QA_BOARD_PROJECT = 'ExManager QA';
const QA_UX_PROJECT = 'UX QA 2026-10-26';
const QA_UX_CARD_ID = '43687640-5245-4ec4-b29c-2b8970cb9d30';
const QA_CARD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function qaUxFixtureIds(): ReadonlySet<string> {
  const configured = (process.env.KANBAN_QA_ALLOWED_FIXTURE_IDS ?? '').split(',')
    .map(id => id.trim().toLowerCase())
    .filter(id => QA_CARD_ID_PATTERN.test(id));
  return new Set([QA_UX_CARD_ID, ...configured]);
}

function boardReadProject(identity: { username: string; scope: 'work' | 'personal' }): string | null {
  if (identity.scope !== 'work') return null;
  if (['qa_exmanager_a', 'qa_exmanager_b'].includes(identity.username)) return QA_BOARD_PROJECT;
  return ['nikita', 'oleg'].includes(identity.username) ? VERIFIED_BOARD_PROJECT : null;
}

function qaRequestHost(req: NextRequest): string {
  const forwardedHost = req.headers.get('x-forwarded-host')?.split(',')[0].trim();
  return forwardedHost || req.nextUrl.host;
}

// The isolated loopback fixture keeps its existing read-only synthetic project view.
function qaLoopbackReadAllowed(req: NextRequest, identity: { username: string; scope: 'work' | 'personal' } | null): boolean {
  const hostAllowed = ['127.0.0.1:43330', 'localhost:43330'].includes(qaRequestHost(req));
  const actorAllowed = identity === null || (identity.scope === 'work' && identity.username === 'testlogin');
  return process.env.KANBAN_QA_ANONYMOUS_READS === '1' && hostAllowed && actorAllowed;
}

// Public QA SSO is narrower: testlogin sees only the fixed synthetic fixture.
function qaTestLoginCardReadAllowed(req: NextRequest, identity: { username: string; scope: 'work' | 'personal' } | null): boolean {
  return process.env.KANBAN_QA_ANONYMOUS_READS === '1'
    && qaRequestHost(req) === 'qa-board.bezrabotnyi.com'
    && identity?.scope === 'work' && identity.username === 'testlogin';
}
export async function GET(req: NextRequest) {
  try {
    const ownerBrowserRead = await ownerBrowserReadAllowed(req);
    const nativeContext = ownerBrowserRead ? null : await nativeProjectAccessContextFromRequest(req);
    startDueReminderScheduler();
    if (ownerBrowserRead) {
      const tasksDir = tasksDirForScope('work');
      return NextResponse.json({ cards: getAllCards(tasksDir), projects: listProjects(tasksDir) });
    }
    if (nativeContext) {
      const tasksDir = tasksDirForScope('work');
      const cards = getAllCards(tasksDir);
      const projects = listProjects(tasksDir);
      const hint = req.nextUrl.searchParams.get('project')?.trim() ?? '';
      const candidates = [...new Set([
        ...cards.map(card => card.project.trim()),
        ...projects.map(project => project.name.trim()),
      ].filter(Boolean))];
      const readable = new Set<string>();
      for (const project of candidates) {
        if (hint && project !== hint) continue;
        try {
          if ((await nativeContext.forProject(project)).readAllowed) readable.add(project);
        } catch (error) {
          if (error instanceof Error && error.message === 'native_project_access_denied') continue;
          return NextResponse.json({ error: 'project access could not be verified' }, { status: 503 });
        }
      }
      return NextResponse.json({
        cards: cards.filter(card => readable.has(card.project.trim())),
        projects: projects.filter(project => readable.has(project.name.trim())),
      });
    }
    const authenticatedIdentity = await boardHumanIdentityFromRequest(req);
    const allowedProject = authenticatedIdentity ? boardReadProject(authenticatedIdentity) : null;
    if (!allowedProject && qaLoopbackReadAllowed(req, authenticatedIdentity)) {
      const tasksDir = tasksDirForScope('work');
      const cards = getAllCards(tasksDir).filter(card => card.project.trim() === QA_UX_PROJECT);
      const projects = listProjects(tasksDir).filter(project => project.name.trim() === QA_UX_PROJECT);
      return NextResponse.json({ cards, projects });
    }
    if (!allowedProject && qaTestLoginCardReadAllowed(req, authenticatedIdentity)) {
      const tasksDir = tasksDirForScope('work');
      const allowedFixtureIds = qaUxFixtureIds();
      const cards = getAllCards(tasksDir).filter(card => allowedFixtureIds.has(card.id.toLowerCase()) && card.project.trim() === QA_UX_PROJECT);
      const projects = listProjects(tasksDir).filter(project => project.name.trim() === QA_UX_PROJECT);
      return NextResponse.json({ cards, projects });
    }
    if (!allowedProject) return NextResponse.json({ cards: [], projects: [] });
    const tasksDir = tasksDirForScope(authenticatedIdentity!.scope);
    const cards = getAllCards(tasksDir).filter(card => card.project.trim() === allowedProject);
    const projects = listProjects(tasksDir).filter(project => project.name.trim() === allowedProject);
    return NextResponse.json({ cards, projects });
  } catch (e) {
    const reason = e instanceof Error ? e.message : '';
    const status = reason === 'native_identity_unconfigured' ? 503
      : reason === 'native_identity_invalid' || reason === 'native_project_hint_invalid' || reason === 'native_owner_read_mismatch' ? 403
        : reason.startsWith('native_') ? 503 : 500;
    return NextResponse.json({ error: status === 403 ? 'native identity could not be verified' : 'cards could not be read' }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    startDueReminderScheduler();
    const identity = boardIdentityFromRequest(req);
    const authenticatedIdentity = await boardHumanIdentityFromRequest(req);
    const managerAuthorized = identity.scope === 'work' && managerRequestAuthorized(req);
    const body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'request body must be an object' }, { status: 400 });
    }
    const { title, description, column, priority, tags, project, assignees, blockerReason } = body;
    let dueAt: string | undefined;
    try {
      dueAt = normalizeDueAt(body.dueAt) || undefined;
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'dueAt is invalid' }, { status: 400 });
    }
    if (!title) return NextResponse.json({ error: 'title is required' }, { status: 400 });
    if (!project?.trim()) return NextResponse.json({ error: 'project is required' }, { status: 400 });
    if (blockerReason !== undefined && blockerReason !== null
        && (typeof blockerReason !== 'string' || blockerReason.length > 2000)) {
      return NextResponse.json({ error: 'blocker_reason_invalid' }, { status: 400 });
    }
    validatePlanningFields(body);
    const tasksDir = tasksDirForScope(identity.scope);
    const requested: KanbanCardUpdates = {};
    for (const [key, value] of Object.entries({
      title, description, column, priority, tags, project, assignees, dueAt, blockerReason,
      owner: authenticatedIdentity?.username ?? (managerAuthorized ? body.owner : undefined),
      shared: body.shared,
      planningVersion: body.planningVersion,
      type: body.type,
      role: body.role,
      accountable: body.accountable,
      assignee: body.assignee,
      important: body.important,
      urgent: body.urgent,
      week: body.week,
      bigRock: body.bigRock,
      parent: body.parent,
      scheduledAt: body.scheduledAt,
      todayRank: body.todayRank,
      source: body.source,
      needsReview: body.needsReview,
      suggestedAssignee: body.suggestedAssignee,
      waitingFor: body.waitingFor,
      requiresApprovalFrom: body.requiresApprovalFrom,
    })) {
      if (value !== undefined) (requested as Record<string, unknown>)[key] = value;
    }
    const candidate = {
      id: 'new-card', title: '', description: '', column: 'inbox', priority: 'medium', tags: [], order: 0,
      created: new Date(0).toISOString(), updated: new Date(0).toISOString(), fileName: 'new-card.md',
      version: 1, project: '', assignees: [],
    } as KanbanCard;
    const decision = validateTransition(candidate, requested, {
      origin: authenticatedIdentity ? 'human-ui' : 'automation',
      actor: managerAuthorized ? 'manager' : authenticatedIdentity?.username ?? identity.username,
      isCreation: true,
      ...(managerAuthorized && hasRequestedAssignee(body)
        ? {
            ownerAuthorization: {
              actor: NIKITA_ACTOR,
              evidence: { type: 'direct-owner-command', origin: 'manager-service', actor: NIKITA_ACTOR },
            },
          }
        : authenticatedIdentity?.username === NIKITA_ACTOR && hasRequestedAssignee(body)
        ? {
            ownerAuthorization: {
              actor: NIKITA_ACTOR,
              evidence: { type: 'direct-owner-command', origin: 'rest', actor: NIKITA_ACTOR },
            },
          }
        : {}),
    });
    if (decision.kind === 'rejected') {
      return NextResponse.json({ error: decision.reason }, { status: 400 });
    }
    const patch = decision.patch;
    const createOptions = {
      ...(typeof patch.parent === 'string' ? { parent: patch.parent } : {}),
      ...(typeof patch.owner === 'string' ? { owner: patch.owner } : {}),
    };
    const createArgs = [
      String(patch.title ?? title), patch.description as string | undefined, patch.column,
      patch.priority, patch.tags, String(patch.project ?? project), patch.assignees, tasksDir,
      patch.dueAt || undefined,
    ] as const;
    const card = Object.keys(createOptions).length > 0
      ? createCard(...createArgs, createOptions)
      : createCard(...createArgs);
    const policyFields = [
      'column', 'owner', 'blockerReason', 'shared', 'planningVersion', 'type', 'role', 'accountable', 'assignee', 'important', 'urgent',
      'week', 'bigRock', 'parent', 'scheduledAt', 'todayRank', 'source', 'needsReview',
      'suggestedAssignee', 'waitingFor', 'requiresApprovalFrom', 'completedBy', 'completedAt',
      'completionEvidence', 'approvalEvidence',
    ];
    const policyPatch = Object.fromEntries(
      policyFields.filter(key => key in patch
        && !(key === 'parent' && typeof patch.parent === 'string')
        && !(key === 'owner' && typeof patch.owner === 'string'))
        .map(key => [key, (patch as Record<string, unknown>)[key]]),
    ) as KanbanCardUpdates;
    const persisted = Object.keys(policyPatch).length > 0
      ? updateCard(card.id, policyPatch, undefined, tasksDir)
      : card;
    if ('conflict' in persisted) return NextResponse.json({ conflict: true, serverCard: persisted.serverCard }, { status: 409 });
    await dispatchCardEvent(identity.scope, 'created', persisted).catch(() => undefined);
    return NextResponse.json({ card: persisted, policy: decision.kind }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

/**
 * Validate planning metadata before createCard can create a Markdown file.
 *
 * @param body Parsed request body containing camelCase planning fields.
 * @returns Nothing when all supplied planning fields match the v1 contract.
 * @throws Error naming the first malformed planning field.
 */
function validatePlanningFields(body: Record<string, unknown>): void {
  const optionalStrings = [
    'accountable', 'assignee', 'parent', 'source', 'suggestedAssignee', 'completedBy',
  ];
  for (const field of optionalStrings) {
    if (body[field] !== undefined && (typeof body[field] !== 'string' || !(body[field] as string).trim())) {
      throw new Error(`Invalid planning field "${field}": expected a non-empty string`);
    }
  }
  if (body.planningVersion !== undefined && body.planningVersion !== 1) {
    throw new Error('Invalid planning field "planningVersion": only version 1 is supported');
  }
  if (body.type !== undefined && body.type !== 'outcome' && body.type !== 'action') {
    throw new Error('Invalid planning field "type": expected outcome or action');
  }
  if (body.role !== undefined && (typeof body.role !== 'string' || !body.role.trim())) {
    throw new Error('Invalid planning field "role": expected a non-empty role ID');
  }
  if (body.owner !== undefined && (typeof body.owner !== 'string' || !body.owner.trim())) throw new Error('Invalid owner');
  if (body.shared !== undefined && typeof body.shared !== 'boolean') throw new Error('Invalid shared flag');
  for (const field of ['important', 'urgent', 'bigRock', 'needsReview']) {
    if (body[field] !== undefined && typeof body[field] !== 'boolean') {
      throw new Error(`Invalid planning field "${field}": expected a boolean`);
    }
  }
  if (body.week !== undefined && (typeof body.week !== 'string' || !/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/.test(body.week))) {
    throw new Error('Invalid planning field "week": expected an ISO week such as 2026-W33');
  }
  if (body.todayRank !== undefined && (typeof body.todayRank !== 'number' || !Number.isInteger(body.todayRank) || body.todayRank < 1 || body.todayRank > 3)) {
    throw new Error('Invalid planning field "todayRank": expected an integer from 1 to 3');
  }
  for (const field of ['waitingFor', 'requiresApprovalFrom']) {
    if (body[field] !== undefined && (!Array.isArray(body[field]) || body[field].some(item => typeof item !== 'string' || !item.trim()))) {
      throw new Error(`Invalid planning field "${field}": expected an array of non-empty strings`);
    }
  }
  for (const field of ['scheduledAt', 'completedAt']) {
    if (body[field] !== undefined && !isRfc3339WithOffset(body[field])) {
      throw new Error(`Invalid planning field "${field}": expected RFC3339 timestamp with offset`);
    }
  }
  for (const field of ['completionEvidence', 'approvalEvidence']) {
    if (body[field] !== undefined && (!Array.isArray(body[field]) || body[field].some(item => !item || typeof item !== 'object' || Array.isArray(item)))) {
      throw new Error(`Invalid planning field "${field}": expected an array of objects`);
    }
  }
}

/**
 * Check the planning contract's RFC3339 timestamp representation.
 *
 * @param value Candidate timestamp.
 * @returns Whether the value has an offset and is a parseable date.
 */
function isRfc3339WithOffset(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && !Number.isNaN(Date.parse(value));
}

/**
 * Detect an explicit initial assignment request for server-derived owner auth.
 *
 * @param body Parsed create request body.
 * @returns Whether the request contains a non-empty assignee selection.
 */
function hasRequestedAssignee(body: Record<string, unknown>): boolean {
  return (typeof body.assignee === 'string' && body.assignee.trim().length > 0)
    || (Array.isArray(body.assignees) && body.assignees.length > 0);
}
