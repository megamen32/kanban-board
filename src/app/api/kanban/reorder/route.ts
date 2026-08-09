import { NextRequest, NextResponse } from 'next/server';
import { reorderColumn } from '@/lib/kanban/file-store';
import type { KanbanColumn } from '@/lib/kanban/types';

export async function POST(req: NextRequest) {
  try {
    const { column, cardIds } = await req.json();
    if (!column || !Array.isArray(cardIds)) {
      return NextResponse.json({ error: 'column and cardIds required' }, { status: 400 });
    }
    const cards = reorderColumn(column as KanbanColumn, cardIds);
    return NextResponse.json({ cards });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}