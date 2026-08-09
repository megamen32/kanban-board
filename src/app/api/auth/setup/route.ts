import { NextRequest, NextResponse } from 'next/server';
import { authStore } from '@/lib/auth/request';
import { generateTotpSecret, otpauthUri } from '@/lib/auth/totp';

export async function POST(request: NextRequest) {
  const expected = process.env.KANBAN_SETUP_TOKEN;
  if (!expected || request.headers.get('x-kanban-setup-token') !== expected) {
    return NextResponse.json({ error: 'setup is not authorized' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const secret = typeof body.totpSecret === 'string' && body.totpSecret ? body.totpSecret : generateTotpSecret();
    if (!username || !password) return NextResponse.json({ error: 'username and password are required' }, { status: 400 });
    authStore().bootstrap(username, password, secret);
    return NextResponse.json({ configured: true, totpSecret: secret, otpauthUri: otpauthUri(secret, username) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'setup failed' }, { status: 400 });
  }
}
