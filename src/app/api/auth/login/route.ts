import { NextRequest, NextResponse } from 'next/server';
import { authStore, SESSION_COOKIE } from '@/lib/auth/request';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const totp = typeof body.totp === 'string' ? body.totp.trim() : '';
    const session = authStore().authenticate(username, password, totp);
    if (!session) return NextResponse.json({ error: 'invalid credentials or second factor' }, { status: 401 });
    const response = NextResponse.json({ authenticated: true, scope: process.env.KANBAN_UI_SCOPE === 'personal' ? 'personal' : 'work' });
    response.cookies.set(SESSION_COOKIE, session, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 8 * 60 * 60,
    });
    return response;
  } catch {
    return NextResponse.json({ error: 'invalid request' }, { status: 400 });
  }
}
