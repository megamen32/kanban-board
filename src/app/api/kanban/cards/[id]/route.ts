import { NextRequest, NextResponse } from 'next/server';
import { findCardById, updateCard, deleteCard } from '@/lib/kanban/file-store';
import type { KanbanCard } from '@/lib/kanban/types';

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
    const { title, description, column, priority, tags, order, project, assignees, expectedVersion } = body;
    if (project !== undefined && (typeof project !== 'string' || !project.trim())) {
      return NextResponse.json({ error: 'project is required' }, { status: 400 });
    }
    const updates: Partial<Pick<KanbanCard, 'title' | 'description' | 'column' | 'priority' | 'tags' | 'order' | 'project' | 'assignees'>> = {};
    for (const [key, value] of Object.entries({ title, description, column, priority, tags, order, project, assignees })) {
      if (value !== undefined) updates[key] = value;
    }
    const result = updateCard(id, updates, expectedVersion);
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
