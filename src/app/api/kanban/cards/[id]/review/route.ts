import { NextRequest, NextResponse } from 'next/server';
import { findCardById, updateCard } from '@/lib/kanban/file-store';
import { boardIdentityFromRequest } from '@/lib/auth/request';
import { boardHumanIdentityFromRequest } from '@/lib/auth/board-human';
import { tasksDirForScope } from '@/lib/auth/data-scope';
import { decideHumanReview, type HumanReviewAction } from '@/lib/kanban/transition-policy';
import { dispatchCardEvent } from '@/lib/notifications/push';

const MAX_NOTE_LENGTH = 4000;

/** Apply an explicit accept/rework decision using the existing human session and card CAS. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const human = await boardHumanIdentityFromRequest(request);
    if (!human) return NextResponse.json({ error: 'human authentication required' }, { status: 401 });
    const identity = boardIdentityFromRequest(request);
    if (identity.scope !== human.scope) return NextResponse.json({ error: 'scope mismatch' }, { status: 403 });

    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || !['accept', 'rework'].includes(body.action)
      || !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 1
      || (body.note !== undefined && (typeof body.note !== 'string' || body.note.length > MAX_NOTE_LENGTH))) {
      return NextResponse.json({ error: 'invalid review decision' }, { status: 400 });
    }
    const action = body.action as HumanReviewAction;
    const note = typeof body.note === 'string' ? body.note : '';
    const { id } = await params;
    const tasksDir = tasksDirForScope(human.scope);
    const before = findCardById(id, tasksDir);
    if (!before) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const decision = decideHumanReview(before, action, human.username, note);
    if (decision.kind === 'rejected') {
      const status = decision.reason === 'reviewer_not_authorized' ? 403
        : decision.reason === 'task_not_waiting_for_review' ? 409 : 400;
      return NextResponse.json({ error: decision.reason }, { status });
    }
    const saved = updateCard(id, decision.patch, body.expectedVersion, tasksDir);
    if ('conflict' in saved) return NextResponse.json({ conflict: true, serverCard: saved.serverCard }, { status: 409 });
    await dispatchCardEvent(human.scope, saved.column === 'done' ? 'moved' : 'updated', saved).catch(() => undefined);
    return NextResponse.json({ card: saved, decision: action });
  } catch {
    return NextResponse.json({ error: 'review decision could not be saved' }, { status: 400 });
  }
}
