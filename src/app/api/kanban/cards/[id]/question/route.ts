import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { tasksDirForScope } from '../../../../../../lib/auth/data-scope';
import { findCardById } from '../../../../../../lib/kanban/file-store';
import {
  EXECUTOR_KEY_HEADER, executorAttempt, mutateCard, notifyQuestion, ownerActor, parseQuestionBody,
  sweepQuestionTimeout, withAttemptPhase,
} from '../../../../../../lib/kanban/board-questions';
import { automationTokenValid } from '../../../../../../lib/auth/request';
import type { PendingQuestion } from '../../../../../../lib/kanban/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

/** The executor asks the owner one question; the answer comes back into the same native session. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tasksDir = tasksDirForScope('work');
  const card = findCardById(id, tasksDir);
  if (!card) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const attempt = executorAttempt(request, card);
  if (!attempt) return NextResponse.json({ error: 'executor key required' }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  const parsed = parseQuestionBody(body);
  if (typeof parsed === 'string') return NextResponse.json({ error: parsed }, { status: 400 });
  if (card.pendingQuestion && !card.pendingQuestion.answer) {
    return NextResponse.json({ error: 'a question is already pending', questionId: card.pendingQuestion.id }, { status: 409 });
  }
  const question: PendingQuestion = {
    id: randomUUID(), text: parsed.question, choices: parsed.choices,
    ...(parsed.timeoutValue ? { timeoutValue: parsed.timeoutValue } : {}),
    askedAt: new Date().toISOString(), attemptOperationId: attempt.operationId,
  };
  let conflict = false;
  const saved = mutateCard(id, tasksDir, current => {
    if (current.pendingQuestion && !current.pendingQuestion.answer) { conflict = true; return undefined; }
    if (executorAttempt(request, current)?.operationId !== attempt.operationId) { conflict = true; return undefined; }
    const running = current.taskExecutionHistory?.find(item => item.operationId === attempt.operationId);
    return {
      pendingQuestion: question,
      ...(running && (running.phase === 'running' || running.phase === 'waiting' || running.phase === 'dispatch-unknown')
        ? { taskExecutionHistory: withAttemptPhase(current, attempt.operationId, { phase: 'waiting', lastProgress: 'Ожидается ответ владельца на вопрос.', lastProgressAt: question.askedAt }) }
        : {}),
    };
  });
  if (conflict) return NextResponse.json({ error: 'a question is already pending' }, { status: 409 });
  if (!saved) return NextResponse.json({ error: 'question could not be saved' }, { status: 503 });
  await notifyQuestion(saved, question);
  return NextResponse.json({ ok: true, questionId: question.id }, { status: 201, headers: NO_STORE });
}

/** Read the card's question; owner session, automation token or the executor key. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tasksDir = tasksDirForScope('work');
  let card = findCardById(id, tasksDir);
  if (!card) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const allowed = request.headers.has(EXECUTOR_KEY_HEADER) ? !!executorAttempt(request, card)
    : automationTokenValid(request) || !!(await ownerActor(request, card));
  if (!allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  card = await sweepQuestionTimeout(card, tasksDir);
  return NextResponse.json({ question: card.pendingQuestion ?? null }, { headers: NO_STORE });
}

