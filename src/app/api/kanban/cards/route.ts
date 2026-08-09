import { NextRequest, NextResponse } from 'next/server';
import { getAllCards, createCard } from '@/lib/kanban/file-store';

export async function GET() {
  try {
    const cards = getAllCards();
    return NextResponse.json({ cards });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { title, description, column, priority, tags } = body;
    if (!title) return NextResponse.json({ error: 'title is required' }, { status: 400 });
    const card = createCard(title, description, column, priority, tags);
    return NextResponse.json({ card }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}