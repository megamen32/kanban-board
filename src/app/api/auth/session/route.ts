import { NextRequest, NextResponse } from 'next/server';
import { identityFromRequest } from '@/lib/auth/request';

export async function GET(request: NextRequest) {
  const identity = identityFromRequest(request);
  if (!identity) return NextResponse.json({ authenticated: false }, { status: 401 });
  return NextResponse.json({ authenticated: true, username: identity.username, scope: identity.scope });
}
