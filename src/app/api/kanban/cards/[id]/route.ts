import { NextRequest, NextResponse } from 'next/server';
import { findCardById, updateCard, deleteCard } from '@/lib/kanban/file-store';
import type { KanbanCard, KanbanCardUpdates } from '@/lib/kanban/types';
import { boardIdentityFromRequest, identityFromRequest } from '@/lib/auth/request';
import { tasksDirForScope } from '@/lib/auth/data-scope';
import { normalizeDueAt } from '@/lib/kanban/due-at';
import { dispatchCardEvent } from '@/lib/notifications/push';
import { startDueReminderScheduler } from '@/lib/notifications/scheduler';
import { validateTransition } from '@/lib/kanban/transition-policy';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  startDueReminderScheduler();
  const identity = boardIdentityFromRequest(req);
  const tasksDir = tasksDirForScope(identity.scope);
  const { id } = await params;
  const card = findCardById(id, tasksDir);
  if (!card) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ card });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    startDueReminderScheduler();
    const identity = boardIdentityFromRequest(req);
    const authenticatedIdentity = identityFromRequest(req);
    const tasksDir = tasksDirForScope(identity.scope);
    const body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'request body must be an object' }, { status: 400 });
    }
    const { title, description, column, priority, tags, order, project, assignees, expectedVersion } = body;
    let dueAt: string | null | undefined;
    try {
      dueAt = normalizeDueAt(body.dueAt, true);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'dueAt is invalid' }, { status: 400 });
    }
    if (project !== undefined && (typeof project !== 'string' || !project.trim())) {
      return NextResponse.json({ error: 'project is required' }, { status: 400 });
    }
    const existing = findCardById(id, tasksDir);
    if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });
    const updates: KanbanCardUpdates = {};
    for (const [key, value] of Object.entries({
      title, description, column, priority, tags, order, project, assignees, dueAt,
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
      if (value !== undefined) (updates as Record<string, unknown>)[key] = value;
    }
    const decision = validateTransition(existing, updates, {
      origin: authenticatedIdentity ? 'human-ui' : 'automation',
      actor: authenticatedIdentity?.username ?? identity.username,
      ...(authenticatedIdentity?.username === 'nikita'
        && body.reassignmentIntent === 'direct-owner-command'
        && body.reassignmentEvidence
        && typeof body.reassignmentEvidence === 'object'
        && !Array.isArray(body.reassignmentEvidence)
        && Object.keys(body.reassignmentEvidence).length > 0
        ? {
            ownerAuthorization: {
              actor: 'nikita',
              evidence: {
                ...(body.reassignmentEvidence as Record<string, unknown>),
                type: 'direct-owner-command',
                origin: 'rest',
                actor: 'nikita',
              },
            },
          }
        : {}),
    });
    if (decision.kind === 'rejected') {
      return NextResponse.json({ error: decision.reason }, { status: 400 });
    }
    const result = updateCard(id, decision.patch, expectedVersion, tasksDir);
    if ('conflict' in result) return NextResponse.json({ conflict: true, serverCard: result.serverCard }, { status: 409 });
    const kind = existing && existing.column !== result.column ? 'moved' : 'updated';
    await dispatchCardEvent(identity.scope, kind, result).catch(() => undefined);
    return NextResponse.json({ card: result, policy: decision.kind });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    startDueReminderScheduler();
    const identity = boardIdentityFromRequest(req);
    const tasksDir = tasksDirForScope(identity.scope);
    const card = findCardById(id, tasksDir);
    const ok = deleteCard(id, tasksDir);
    if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
    if (card) await dispatchCardEvent(identity.scope, 'deleted', card).catch(() => undefined);
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
