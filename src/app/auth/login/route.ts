import { NextRequest, NextResponse } from 'next/server';
import { authStore, SESSION_COOKIE } from '@/lib/auth/request';

function safeReturnTo(request: NextRequest, value: string | null): string {
  if (!value) return '/';
  try {
    const target = new URL(value, request.url);
    return target.origin === new URL(request.url).origin ? `${target.pathname}${target.search}${target.hash}` : '/';
  } catch { return '/'; }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] || character);
}

export async function GET(request: NextRequest) {
  const returnTo = safeReturnTo(request, request.nextUrl.searchParams.get('return_to'));
  const html = `<!doctype html><meta charset="utf-8"><title>Вход в Kanban</title><main style="max-width:28rem;margin:4rem auto;font:16px system-ui;padding:1rem"><h1>Вход в Kanban</h1><form method="post"><input type="hidden" name="return_to" value="${escapeHtml(returnTo)}"><label>Пользователь<br><input name="username" autocomplete="username" required></label><br><label>Пароль<br><input type="password" name="password" autocomplete="current-password" required></label><br><label>Код 2FA<br><input name="totp" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" required></label><br><button type="submit">Войти</button></form></main>`;
  return new NextResponse(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const session = authStore().authenticate(String(form.get('username') || '').trim(), String(form.get('password') || ''), String(form.get('totp') || '').trim());
  if (!session) return new NextResponse('Неверные учётные данные или код 2FA', { status: 401 });
  const response = NextResponse.redirect(new URL(safeReturnTo(request, String(form.get('return_to') || '/')), request.url));
  response.cookies.set(SESSION_COOKIE, session, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 8 * 60 * 60 });
  return response;
}
