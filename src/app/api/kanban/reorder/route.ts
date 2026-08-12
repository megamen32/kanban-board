import { NextRequest, NextResponse } from 'next/server';
import { findCardById, reorderColumn } from '@/lib/kanban/file-store';
import { DEFAULT_COLUMNS, type KanbanColumn } from '@/lib/kanban/types';
import { boardIdentityFromRequest, identityFromRequest } from '@/lib/auth/request';
import { tasksDirForScope } from '@/lib/auth/data-scope';
import { dispatchCardEvent } from '@/lib/notifications/push';
import { startDueReminderScheduler } from '@/lib/notifications/scheduler';
import { validateTransition } from '@/lib/kanban/transition-policy';

export async function POST(req: NextRequest) {
  try {
    startDueReminderScheduler();
    const identity = boardIdentityFromRequest(req);
    const authenticatedIdentity = identityFromRequest(req);
    const body = await req.json();
    const { column, cardIds } = body ?? {};
    const validColumn = typeof column === 'string'
      && DEFAULT_COLUMNS.some(item => item.id === column);
    if (!validColumn || !Array.isArray(cardIds)
      || cardIds.length !== new Set(cardIds).size
      || cardIds.some(id => typeof id !== 'string' || !id.trim())) {
      return NextResponse.json({ error: 'column and cardIds required' }, { status: 400 });
    }
    const tasksDir = tasksDirForScope(identity.scope);
    const existingCards = cardIds.map(id => findCardById(id, tasksDir));
    if (existingCards.some(card => !card || card.column !== column)) {
      return NextResponse.json({ error: 'cardIds must reference cards in the requested column' }, { status: 400 });
    }
    const origin = authenticatedIdentity ? 'human-ui' : 'automation';
    const actor = authenticatedIdentity?.username ?? identity.username;
    for (const [index, card] of existingCards.entries()) {
      const decision = validateTransition(card!, { order: index }, { origin, actor });
      if (decision.kind === 'rejected') {
        return NextResponse.json({ error: decision.reason }, { status: 400 });
      }
    }
    const cards = reorderColumn(column as KanbanColumn, cardIds, tasksDir);
    if (cards[0]) await dispatchCardEvent(identity.scope, 'reordered', cards[0]).catch(() => undefined);
    return NextResponse.json({ cards });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
