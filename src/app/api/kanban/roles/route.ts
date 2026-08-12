import { NextRequest, NextResponse } from 'next/server';
import { getRoles, saveRoles } from '@/lib/kanban/roles-store';
import type { RoleDefinition } from '@/lib/kanban/types';

function owner(value: string | null) { if (!value?.trim()) throw new Error('owner is required'); return value.trim(); }
export async function GET(request: NextRequest) {
  try { const value = owner(request.nextUrl.searchParams.get('owner')); return NextResponse.json({ owner: value, roles: getRoles(value) }); }
  catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
}
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json() as { owner?: unknown; roles?: unknown };
    const value = owner(typeof body.owner === 'string' ? body.owner : null);
    if (!Array.isArray(body.roles) || body.roles.some(role => !role || typeof role !== 'object' || typeof (role as RoleDefinition).label !== 'string')) throw new Error('roles must be an array');
    return NextResponse.json({ owner: value, roles: saveRoles(value, body.roles as RoleDefinition[]) });
  } catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
}
