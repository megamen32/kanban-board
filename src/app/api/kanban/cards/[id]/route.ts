import { NextRequest, NextResponse } from 'next/server';
import { findCardById, updateCard, deleteCard, moveCard } from '@/lib/kanban/file-store';
import type { KanbanColumn } from '@/lib/kanban/types';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const card = findCardById(id);
  if (!card) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ card });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await req.json();
    const { title, description, column, priority, tags, order, expectedVersion } = body;

    if (column !== undefined && !body.title && !body.description) {
      const result = moveCard(id, column as KanbanColumn, order);
      if ('conflict' in result) return NextResponse.json({ conflict: true, serverCard: result.serverCard }, { status: 409 });
      return NextResponse.json({ card: result });
    }

    const result = updateCard(id, { title, description, column, priority, tags, order }, expectedVersion);
    if ('conflict' in result) return NextResponse.json({ conflict: true, serverCard: result.serverCard }, { status: 409 });
    return NextResponse.json({ card: result });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const ok = deleteCard(id);
    if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}