import { NextRequest, NextResponse } from 'next/server';
import { tasksDirForScope } from '../../../../../../lib/auth/data-scope';
import { findCardById, updateCard } from '../../../../../../lib/kanban/file-store';
import { executorAttempt, MAX_RESULT_TEXT, sweepQuestionTimeout, withAttemptPhase } from '../../../../../../lib/kanban/board-questions';
import { validateTransition } from '../../../../../../lib/kanban/transition-policy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The executor reports the final result; the card moves to review through the existing executorResult transition. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tasksDir = tasksDirForScope('work');
  let card = findCardById(id, tasksDir);
  if (!card) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const attempt = executorAttempt(request, card);
  if (!attempt) return NextResponse.json({ error: 'executor key required' }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  const text = body && typeof body === 'object' ? (body as Record<string, unknown>).text : undefined;
  if (typeof text !== 'string' || !text.trim() || text.length > MAX_RESULT_TEXT) {
    return NextResponse.json({ error: 'text must be 1-4000 chars' }, { status: 400 });
  }
  card = await sweepQuestionTimeout(card, tasksDir);
  const summary = text.trim();
  const evidenceRefs = [...new Set(summary.match(/https?:\/\/[^\s<>"')\]]+/g)?.map(url => url.replace(/[.,;:!?]+$/u, '')) ?? [])].slice(0, 50);
  for (let tries = 0; tries < 5; tries++) {
    const current = findCardById(id, tasksDir);
    if (!current) return NextResponse.json({ error: 'not found' }, { status: 404 });
    const transition = validateTransition(current, {
      executorResult: { summary, evidenceRefs, nextAction: 'Проверьте результат и источники, затем примите решение.' },
    }, { origin: 'automation', actor: attempt.startedBy });
    if (transition.kind !== 'redirected') return NextResponse.json({ error: 'result did not enter human review' }, { status: 409 });
    const finish = { phase: 'result' as const, lastProgress: 'Результат сохранён и ожидает проверки человека.', lastProgressAt: new Date().toISOString() };
    let saved;
    try {
      saved = updateCard(id, { ...transition.patch, taskExecutionHistory: withAttemptPhase(current, attempt.operationId, finish) }, current.version, tasksDir);
    } catch {
      // The receipt validator can refuse 'result' for a not fully admitted dispatch; the result text must still land.
      saved = updateCard(id, { ...transition.patch }, current.version, tasksDir);
    }
    if (!('conflict' in saved)) return NextResponse.json({ ok: true, column: saved.column }, { headers: { 'Cache-Control': 'no-store' } });
  }
  return NextResponse.json({ error: 'result could not be saved' }, { status: 503 });
}

