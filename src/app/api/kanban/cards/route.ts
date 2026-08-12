import { NextRequest, NextResponse } from 'next/server';
import { getAllCards, createCard, updateCard } from '@/lib/kanban/file-store';
import type { KanbanCard, KanbanCardUpdates } from '@/lib/kanban/types';
import { boardIdentityFromRequest, identityFromRequest } from '@/lib/auth/request';
import { tasksDirForScope } from '@/lib/auth/data-scope';
import { normalizeDueAt } from '@/lib/kanban/due-at';
import { dispatchCardEvent } from '@/lib/notifications/push';
import { startDueReminderScheduler } from '@/lib/notifications/scheduler';
import { validateTransition } from '@/lib/kanban/transition-policy';
import { NIKITA_ACTOR } from '@/lib/kanban/transition-policy';

export async function GET(req: NextRequest) {
  try {
    startDueReminderScheduler();
    const identity = boardIdentityFromRequest(req);
    const cards = getAllCards(tasksDirForScope(identity.scope));
    return NextResponse.json({ cards });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    startDueReminderScheduler();
    const identity = boardIdentityFromRequest(req);
    const authenticatedIdentity = identityFromRequest(req);
    const body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'request body must be an object' }, { status: 400 });
    }
    const { title, description, column, priority, tags, project, assignees } = body;
    let dueAt: string | undefined;
    try {
      dueAt = normalizeDueAt(body.dueAt) || undefined;
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'dueAt is invalid' }, { status: 400 });
    }
    if (!title) return NextResponse.json({ error: 'title is required' }, { status: 400 });
    if (!project?.trim()) return NextResponse.json({ error: 'project is required' }, { status: 400 });
    validatePlanningFields(body);
    const tasksDir = tasksDirForScope(identity.scope);
    const requested: KanbanCardUpdates = {};
    for (const [key, value] of Object.entries({
      title, description, column, priority, tags, project, assignees, dueAt,
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
      actor: authenticatedIdentity?.username ?? identity.username,
      isCreation: true,
      ...(authenticatedIdentity?.username === NIKITA_ACTOR && hasRequestedAssignee(body)
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
    const card = createCard(
      String(patch.title ?? title),
      patch.description as string | undefined,
      patch.column,
      patch.priority,
      patch.tags,
      String(patch.project ?? project),
      patch.assignees,
      tasksDir,
      patch.dueAt || undefined,
    );
    const policyFields = [
      'column', 'planningVersion', 'type', 'role', 'accountable', 'assignee', 'important', 'urgent',
      'week', 'bigRock', 'parent', 'scheduledAt', 'todayRank', 'source', 'needsReview',
      'suggestedAssignee', 'waitingFor', 'requiresApprovalFrom', 'completedBy', 'completedAt',
      'completionEvidence', 'approvalEvidence',
    ];
    const policyPatch = Object.fromEntries(
      policyFields.filter(key => key in patch).map(key => [key, (patch as Record<string, unknown>)[key]]),
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
  const roleIds = [
    'product-builder', 'client-integrator', 'team-lead', 'author-public',
    'personal-relationships', 'sharpening-the-saw',
  ] as const;
  if (body.role !== undefined && (typeof body.role !== 'string' || !roleIds.includes(body.role as typeof roleIds[number]))) {
    throw new Error(`Invalid planning field "role": expected one of ${roleIds.join(', ')}`);
  }
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
