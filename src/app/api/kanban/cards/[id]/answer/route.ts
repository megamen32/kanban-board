import { NextRequest, NextResponse } from 'next/server';
import { tasksDirForScope } from '../../../../../../lib/auth/data-scope';
import { findCardById } from '../../../../../../lib/kanban/file-store';
import { applyAnswer, ownerActor } from '../../../../../../lib/kanban/board-questions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Owner (session or automation token) picks one of the pending choices; delivered once into the same session. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tasksDir = tasksDirForScope('work');
  const card = findCardById(id, tasksDir);
  if (!card) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const actor = await ownerActor(request, card);
  if (!actor) return NextResponse.json({ error: 'owner session or automation token required' }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  const value = body && typeof body === 'object' ? (body as Record<string, unknown>).value : undefined;
  if (typeof value !== 'string') return NextResponse.json({ error: 'value required' }, { status: 400 });
  const outcome = await applyAnswer(id, tasksDir, value, actor);
  if (outcome.status !== 'ok') {
    if (outcome.status === 'no_question') return NextResponse.json({ error: 'no pending question' }, { status: 404 });
    if (outcome.status === 'bad_value') return NextResponse.json({ error: 'value is not one of the choices' }, { status: 400 });
    return NextResponse.json({ error: 'answer could not be saved' }, { status: 503 });
  }
  return NextResponse.json({
    ok: true, idempotent: outcome.idempotent, answer: outcome.question.answer,
    deliveredAt: outcome.question.deliveredAt, deliveryError: outcome.question.deliveryError,
  }, { headers: { 'Cache-Control': 'no-store' } });
}

