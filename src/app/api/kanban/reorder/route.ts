import { NextRequest, NextResponse } from 'next/server';
import { reorderColumn } from '@/lib/kanban/file-store';
import type { KanbanColumn } from '@/lib/kanban/types';
import { boardIdentityFromRequest } from '@/lib/auth/request';
import { tasksDirForScope } from '@/lib/auth/data-scope';
import { dispatchCardEvent } from '@/lib/notifications/push';
import { startDueReminderScheduler } from '@/lib/notifications/scheduler';

export async function POST(req: NextRequest) {
  try {
    startDueReminderScheduler();
    const identity = boardIdentityFromRequest(req);
    const { column, cardIds } = await req.json();
    if (!column || !Array.isArray(cardIds)) {
      return NextResponse.json({ error: 'column and cardIds required' }, { status: 400 });
    }
    const cards = reorderColumn(column as KanbanColumn, cardIds, tasksDirForScope(identity.scope));
    if (cards[0]) await dispatchCardEvent(identity.scope, 'reordered', cards[0]).catch(() => undefined);
    return NextResponse.json({ cards });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
