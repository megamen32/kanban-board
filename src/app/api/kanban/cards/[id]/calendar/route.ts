import { isDateOnlyDueAt } from '@/lib/kanban/due-at';
import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { findCardById } from '@/lib/kanban/file-store';
import { boardHumanIdentityFromRequest } from '@/lib/auth/board-human';
import { tasksDirForScope } from '@/lib/auth/data-scope';
import { calendarBridgeUsername, keeperCalendarApiUrl, keeperCalendarEnabled, keeperCalendarPublicUrl } from '@/lib/kanban/keeper-config';
import { KeeperCredentialStoreError, keeperCredentialForUser } from '@/lib/kanban/keeper-credentials';
import { calendarSyncDecision, KeeperApiError, keeperCreateEvent, keeperDeleteEvent, keeperUpdateEvent, ProjectCalendarNotConfiguredError, resolveCalendarId, type CalendarSyncInput } from '@/lib/kanban/keeper-calendar';
import { acquireCalendarSyncLock, keeperBindingStore, withCalendarSyncLock, type CalendarSyncRecord } from '@/lib/kanban/keeper-bindings';
import type { KanbanCard } from '@/lib/kanban/types';

/**
 * User-scoped server bridge to the Keeper calendar.
 *
 * Identity and isolation contract:
 * - Only the board's shared human browser login acts here; service bearers are
 *   rejected with 403 before anything else.
 * - Sync records live per user+card in the protected auth root
 *   (keeper-bindings). The shared card Markdown never carries calendar state,
 *   so no user can see or reuse another user's event id.
 * - A pending marker is persisted BEFORE the upstream call and a duplicate
 *   create is never retried: an uncertain Keeper outcome leaves the record
 *   pending until the user recovers it through GET/DELETE.
 */

const MIN_DURATION_MINUTES = 5;
const MAX_DURATION_MINUTES = 24 * 60;
const DEFAULT_DURATION_MINUTES = 60;

type HumanIdentity = { username: string; scope: 'work' | 'personal' };

async function requireBridgeActor(req: NextRequest): Promise<{ username: string } | { response: NextResponse }> {
  // Bearer requests are service requests even when a cookie rides along.
  if (req.headers.has('authorization')) {
    return { response: NextResponse.json({ error: 'service_bearer_forbidden' }, { status: 403 }) };
  }
  const identity = await boardHumanIdentityFromRequest(req);
  const username = calendarBridgeUsername(identity as HumanIdentity | null);
  if (!username) {
    return { response: NextResponse.json({ error: identity ? 'calendar_bridge_not_available_for_account' : 'authentication required' }, { status: identity ? 403 : 401 }) };
  }
  return { username };
}

function requireEnabled(): NextResponse | null {
  if (!keeperCalendarEnabled()) {
    return NextResponse.json({ error: 'keeper_disabled' }, { status: 503 });
  }
  return null;
}

function loadCard(id: string, identity: HumanIdentity): { card: KanbanCard } | { response: NextResponse } {
  const tasksDir = tasksDirForScope(identity.scope);
  const card = findCardById(id, tasksDir);
  if (!card) return { response: NextResponse.json({ error: 'not found' }, { status: 404 }) };
  return { card };
}

function syncInputFor(card: KanbanCard, durationMinutes: number): { input: CalendarSyncInput } | { response: NextResponse } {
  if (!card.dueAt) return { response: NextResponse.json({ error: 'card_has_no_due_at' }, { status: 400 }) };
  if (isDateOnlyDueAt(card.dueAt)) {
    return { response: NextResponse.json({ error: 'card_due_at_has_no_time' }, { status: 400 }) };
  }
  const startTimeMs = new Date(card.dueAt).getTime();
  if (!Number.isFinite(startTimeMs)) {
    return { response: NextResponse.json({ error: 'card_due_at_invalid' }, { status: 400 }) };
  }
  return {
    input: {
      title: card.title,
      titleHash: createHash('sha256').update(card.title).digest('hex'),
      startTime: new Date(startTimeMs).toISOString(),
      endTime: new Date(startTimeMs + durationMinutes * 60_000).toISOString(),
    },
  };
}

function durationFrom(body: unknown): number | { response: NextResponse } {
  if (body === undefined || body === null) return DEFAULT_DURATION_MINUTES;
  if (typeof body !== 'number' || !Number.isInteger(body) || body < MIN_DURATION_MINUTES || body > MAX_DURATION_MINUTES) {
    return { response: NextResponse.json({ error: 'invalid_duration', min: MIN_DURATION_MINUTES, max: MAX_DURATION_MINUTES }, { status: 400 }) };
  }
  return body;
}

function pendingResponse(record: Extract<CalendarSyncRecord, { state: 'pending' }>): NextResponse {
  return NextResponse.json(
    { error: 'calendar_sync_pending', phase: record.phase, startedAt: record.startedAt },
    { status: 409 },
  );
}

async function credentialFor(username: string): Promise<{ credential: Awaited<ReturnType<typeof keeperCredentialForUser>> } | { response: NextResponse }> {
  try {
    return { credential: await keeperCredentialForUser(username) };
  } catch (error) {
    // A broken protected store must fail closed, never proceed tokenless.
    if (error instanceof KeeperCredentialStoreError) {
      return { response: NextResponse.json({ error: 'keeper_credential_store_unavailable' }, { status: 500 }) };
    }
    throw error;
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireBridgeActor(req);
  if ('response' in guard) return guard.response;
  const loaded = loadCard(id, { username: guard.username, scope: 'work' });
  if ('response' in loaded) return loaded.response;

  const record = keeperBindingStore.get(guard.username, id);
  return NextResponse.json({
    event: record?.state === 'bound' ? record : null,
    pending: record?.state === 'pending' ? { phase: record.phase, startedAt: record.startedAt } : null,
    publicUrl: keeperCalendarPublicUrl(),
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireBridgeActor(req);
  if ('response' in guard) return guard.response;
  const { username } = guard;

  const disabled = requireEnabled();
  if (disabled) return disabled;

  const body = await req.json().catch(() => null);
  if (body !== null && (typeof body !== 'object' || Array.isArray(body))) {
    return NextResponse.json({ error: 'request body must be an object' }, { status: 400 });
  }
  const duration = durationFrom((body as { durationMinutes?: unknown } | null)?.durationMinutes);
  if (typeof duration !== 'number') return duration.response;

  const card = loadCard(id, { username, scope: 'work' });
  if ('response' in card) return card.response;
  const input = syncInputFor(card.card, duration);
  if ('response' in input) return input.response;

  // Serialize per user+card in-process, then across processes: a concurrent
  // second POST must observe the first one's result, never re-run a create.
  return withCalendarSyncLock(username, id, async (): Promise<NextResponse> => {
    const processLock = acquireCalendarSyncLock(username, id);
    if (!processLock.acquired) {
      return NextResponse.json({ error: 'calendar_sync_busy' }, { status: 423 });
    }
    try {
      const existing = keeperBindingStore.get(username, id);
      if (existing?.state === 'pending') return pendingResponse(existing);

      // Credentials and strict project routing are checked BEFORE the reuse
      // fast-path: an unchanged card must never report success after its token
      // is gone or its project was remapped.
      const resolved = await credentialFor(username);
      if ('response' in resolved) return resolved.response;
      const credential = resolved.credential;
      if (!credential) return NextResponse.json({ error: 'keeper_not_connected' }, { status: 409 });

      let targetCalendarId: string;
      try {
        targetCalendarId = resolveCalendarId(credential, card.card.project);
      } catch (error) {
        if (error instanceof ProjectCalendarNotConfiguredError) {
          return NextResponse.json({ error: 'project_calendar_not_configured', project: card.card.project }, { status: 409 });
        }
        throw error;
      }

      const decision = calendarSyncDecision(existing?.state === 'bound' ? existing : undefined, input.input);
      // A bound event lives in ONE calendar under ONE project. A missing or
      // different stored project/calendar (including legacy receipts) must
      // never be silently reused or patched across: explicit proven delete,
      // then the next sync creates it in the right calendar.
      if (decision.action !== 'create') {
        const bound = decision.binding;
        if (bound.project !== card.card.project || bound.calendarId !== targetCalendarId) {
          return NextResponse.json(
            {
              error: 'calendar_rebind_manual_required',
              project: card.card.project,
              ...(bound.project ? { storedProject: bound.project } : {}),
              ...(bound.calendarId ? { storedCalendarId: bound.calendarId } : {}),
            },
            { status: 409 },
          );
        }
      }
      if (decision.action === 'none') {
        return NextResponse.json({ reused: true, event: decision.binding, publicUrl: keeperCalendarPublicUrl() });
      }

      // Persist the pending marker BEFORE any upstream call: a crash or unknown
      // outcome after this point refuses further creates instead of duplicating.
      const pending: CalendarSyncRecord = {
        state: 'pending',
        phase: decision.action === 'create' ? 'create' : 'patch',
        ...(decision.action === 'patch' ? { eventId: decision.binding.eventId } : {}),
        startedAt: new Date().toISOString(),
      };
      keeperBindingStore.set(username, id, pending);

      const baseUrl = keeperCalendarApiUrl()!;
      const eventInput = {
        calendarId: decision.action === 'patch' ? decision.binding.calendarId! : targetCalendarId,
        title: input.input.title,
        startTime: input.input.startTime,
        endTime: input.input.endTime,
      };
      let result;
      try {
        result = decision.action === 'create'
          ? await keeperCreateEvent(baseUrl, credential.bearer, eventInput)
          : await keeperUpdateEvent(baseUrl, credential.bearer, decision.binding.eventId, eventInput);
      } catch (error) {
        // Uncertain outcome: keep the pending marker (never retry-create here).
        const code = error instanceof KeeperApiError ? 'keeper_upstream' : 'keeper_unreachable';
        return NextResponse.json(
          { error: code, upstreamStatus: error instanceof KeeperApiError ? error.status : undefined, pending: { phase: pending.phase } },
          { status: 502 },
        );
      }

      const bound: CalendarSyncRecord = {
        state: 'bound',
        eventId: result.eventId,
        startTime: input.input.startTime,
        endTime: input.input.endTime,
        titleHash: input.input.titleHash,
        project: card.card.project,
        calendarId: targetCalendarId,
        syncedAt: new Date().toISOString(),
      };
      keeperBindingStore.set(username, id, bound);
      return NextResponse.json({
        reused: decision.action === 'patch',
        event: bound,
        eventUrl: result.eventUrl ?? null,
        publicUrl: keeperCalendarPublicUrl(),
      });
    } finally {
      processLock.release();
    }
  });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireBridgeActor(req);
  if ('response' in guard) return guard.response;
  const { username } = guard;

  const card = loadCard(id, { username, scope: 'work' });
  if ('response' in card) return card.response;

  const body = await req.json().catch(() => null);
  const confirmManualReconcile = (body as { confirmManualReconcile?: unknown } | null)?.confirmManualReconcile === true;

  return withCalendarSyncLock(username, id, async (): Promise<NextResponse> => {
    const processLock = acquireCalendarSyncLock(username, id);
    if (!processLock.acquired) {
      return NextResponse.json({ error: 'calendar_sync_busy' }, { status: 423 });
    }
    try {
      const existing = keeperBindingStore.get(username, id);
      // Nothing is stored, so nothing upstream is known to this user+card.
      if (!existing) return NextResponse.json({ removed: true, alreadyClear: true });

      if (existing.state === 'pending' && existing.phase === 'create') {
        // The outcome of the interrupted create is unknown: silently clearing
        // the marker would let the next POST duplicate the orphan event. The
        // user must reconcile events in Keeper first, then confirm explicitly.
        if (!confirmManualReconcile) {
          return NextResponse.json(
            { error: 'calendar_sync_pending_manual_required', phase: 'create', startedAt: existing.startedAt },
            { status: 409 },
          );
        }
        keeperBindingStore.clear(username, id);
        return NextResponse.json({ removed: true, recovered: true, manualReconcile: true });
      }

      // bound or pending-patch: an upstream event may exist. Fail closed — the
      // local receipt is only removed after Keeper PROVES the event is gone
      // (successful delete or upstream 404). Without a working credential or
      // disabled bridge the record stays, so the next POST can never duplicate.
      const disabled = requireEnabled();
      if (disabled) return disabled;

      const resolved = await credentialFor(username);
      if ('response' in resolved) return resolved.response;
      const credential = resolved.credential;
      if (!credential) {
        return NextResponse.json({ error: 'keeper_not_connected' }, { status: 409 });
      }

      const eventId = existing.state === 'pending' && !existing.eventId ? null : existing.eventId;
      if (!eventId) {
        // Pending patch without a known upstream id: reconciliation gate.
        if (!confirmManualReconcile) {
          const pendingPatch = existing as Extract<CalendarSyncRecord, { state: 'pending' }>;
          return NextResponse.json(
            { error: 'calendar_sync_pending_manual_required', phase: pendingPatch.phase, startedAt: pendingPatch.startedAt },
            { status: 409 },
          );
        }
        keeperBindingStore.clear(username, id);
        return NextResponse.json({ removed: true, recovered: true, manualReconcile: true });
      }

      try {
        await keeperDeleteEvent(keeperCalendarApiUrl()!, credential.bearer, eventId);
      } catch (error) {
        // An upstream 404 means the event is already gone; other failures
        // stay retryable by keeping the record in place.
        if (!(error instanceof KeeperApiError && error.status === 404)) {
          return NextResponse.json(
            {
              error: error instanceof KeeperApiError ? 'keeper_upstream' : 'keeper_unreachable',
              upstreamStatus: error instanceof KeeperApiError ? error.status : undefined,
            },
            { status: 502 },
          );
        }
      }

      keeperBindingStore.clear(username, id);
      return NextResponse.json({ removed: true, ...(existing.state === 'pending' ? { recovered: true } : {}) });
    } finally {
      processLock.release();
    }
  });
}
