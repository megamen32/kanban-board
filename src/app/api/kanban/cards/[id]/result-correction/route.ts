import { NextRequest, NextResponse } from 'next/server';
import { boardHumanIdentityFromRequest } from '@/lib/auth/board-human';
import { boardIdentityFromRequest } from '@/lib/auth/request';
import { tasksDirForScope } from '@/lib/auth/data-scope';
import { findCardById, updateCard } from '@/lib/kanban/file-store';
import { canCorrectResult, correctedTaskResult, parseResultCorrectionInput } from '../../../../../../lib/kanban/result-correction';
import { dispatchCardEvent } from '@/lib/notifications/push';

/** Append an owner-authored correction while preserving the result and review history. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const human = await boardHumanIdentityFromRequest(request);
    if (!human) return NextResponse.json({ error: 'human authentication required' }, { status: 401 });
    if (boardIdentityFromRequest(request).scope !== human.scope) return NextResponse.json({ error: 'scope mismatch' }, { status: 403 });
    const input = parseResultCorrectionInput(await request.json());
    if (!input) return NextResponse.json({ error: 'invalid result correction' }, { status: 400 });

    const { id } = await params;
    const tasksDir = tasksDirForScope(human.scope);
    const before = findCardById(id, tasksDir);
    if (!before) return NextResponse.json({ error: 'not found' }, { status: 404 });
    if (!canCorrectResult(before, human.username)) return NextResponse.json({ error: 'card owner correction required' }, { status: 403 });

    const history = [...(before.resultHistory ?? []), correctedTaskResult(input, human.username, new Date().toISOString())];
    const saved = updateCard(id, { resultHistory: history }, input.expectedVersion, tasksDir);
    if ('conflict' in saved) return NextResponse.json({ conflict: true, serverCard: saved.serverCard }, { status: 409 });
    await dispatchCardEvent(human.scope, 'updated', saved).catch(() => undefined);
    return NextResponse.json({ card: saved });
  } catch {
    return NextResponse.json({ error: 'result correction could not be saved' }, { status: 400 });
  }
}
