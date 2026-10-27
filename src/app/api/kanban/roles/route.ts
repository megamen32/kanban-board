import { NextRequest, NextResponse } from 'next/server';
import { getRoles, saveRoles } from '@/lib/kanban/roles-store';
import type { RoleDefinition } from '@/lib/kanban/types';
import { boardHumanIdentityFromRequest } from '@/lib/auth/board-human';
import { managerRequestAuthorized } from '@/lib/auth/request';
import { NIKITA_ACTOR } from '@/lib/kanban/transition-policy';

function owner(value: string | null) { if (!value?.trim()) throw new Error('owner is required'); return value.trim(); }
async function roleAccess(request: NextRequest, requestedOwner: string): Promise<NextResponse | null> {
  if (managerRequestAuthorized(request)) return null;
  const identity = await boardHumanIdentityFromRequest(request);
  if (!identity) return NextResponse.json({ error: 'authentication required' }, { status: 401 });
  if (identity.username !== NIKITA_ACTOR && identity.username !== requestedOwner) {
    return NextResponse.json({ error: 'cannot access another user’s roles' }, { status: 403 });
  }
  return null;
}

export async function GET(request: NextRequest) {
  try {
    const value = owner(request.nextUrl.searchParams.get('owner'));
    const denied = await roleAccess(request, value);
    if (denied) return denied;
    return NextResponse.json({ owner: value, roles: getRoles(value) });
  }
  catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
}
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json() as { owner?: unknown; roles?: unknown };
    const value = owner(typeof body.owner === 'string' ? body.owner : null);
    const denied = await roleAccess(request, value);
    if (denied) return denied;
    if (!Array.isArray(body.roles) || body.roles.some(role => !role || typeof role !== 'object' || typeof (role as RoleDefinition).label !== 'string')) throw new Error('roles must be an array');
    return NextResponse.json({ owner: value, roles: saveRoles(value, body.roles as RoleDefinition[]) });
  } catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
}
