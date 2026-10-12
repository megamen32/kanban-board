import { NextRequest, NextResponse } from 'next/server';
import { boardHumanIdentityFromRequest } from '@/lib/auth/board-human';

export async function GET(request: NextRequest) {
  const identity = await boardHumanIdentityFromRequest(request);
  if (!identity) return NextResponse.json({ authenticated: false }, { status: 401 });
  return NextResponse.json({ authenticated: true, username: identity.username, scope: identity.scope });
}
