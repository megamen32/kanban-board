import { NextRequest, NextResponse } from 'next/server';
import { getAllCards, createCard } from '@/lib/kanban/file-store';
import { boardIdentityFromRequest } from '@/lib/auth/request';
import { tasksDirForScope } from '@/lib/auth/data-scope';

export async function GET(req: NextRequest) {
  try {
    const identity = boardIdentityFromRequest(req);
    const cards = getAllCards(tasksDirForScope(identity.scope));
    return NextResponse.json({ cards });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const identity = boardIdentityFromRequest(req);
    const body = await req.json();
    const { title, description, column, priority, tags, project, assignees } = body;
    if (!title) return NextResponse.json({ error: 'title is required' }, { status: 400 });
    if (!project?.trim()) return NextResponse.json({ error: 'project is required' }, { status: 400 });
    const card = createCard(title, description, column, priority, tags, project, assignees, tasksDirForScope(identity.scope));
    return NextResponse.json({ card }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
