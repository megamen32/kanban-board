import { NextRequest, NextResponse } from 'next/server';
import { isAllowedRedirectUri, oauthClientId } from '@/lib/auth/config';
import { identityFromRequest, authStore } from '@/lib/auth/request';
import { parseScope } from '@/lib/auth/scopes';

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] || character);
}

function redirectError(uri: string, error: string, state: string | null): NextResponse {
  const target = new URL(uri);
  target.searchParams.set('error', error);
  if (state) target.searchParams.set('state', state);
  return NextResponse.redirect(target);
}

function validate(request: NextRequest): { clientId: string; redirectUri: string; state: string | null; scope: string | null } | NextResponse {
  const params = request.nextUrl.searchParams;
  const clientId = params.get('client_id') || '';
  const redirectUri = params.get('redirect_uri') || '';
  const state = params.get('state');
  if (params.get('response_type') !== 'code' || clientId !== oauthClientId() || !isAllowedRedirectUri(redirectUri)) {
    return NextResponse.json({ error: 'invalid OAuth request' }, { status: 400 });
  }
  return { clientId, redirectUri, state, scope: params.get('scope') };
}

export async function GET(request: NextRequest) {
  const validated = validate(request);
  if (validated instanceof NextResponse) return validated;
  const identity = identityFromRequest(request);
  if (!identity) {
    const login = new URL('/auth/login', request.url);
    login.searchParams.set('return_to', request.url);
    return NextResponse.redirect(login);
  }
  let requested = 'work';
  try { requested = parseScope(validated.scope).toString(); } catch { return redirectError(validated.redirectUri, 'invalid_scope', validated.state); }
  const html = `<!doctype html><meta charset="utf-8"><title>Разрешение Kanban</title>
<main style="max-width:36rem;margin:4rem auto;font:16px system-ui;padding:1rem">
<h1>Подключить Kanban к ChatGPT?</h1><p>Пользователь: ${escapeHtml(identity.username)}</p>
<form method="post"><input type="hidden" name="client_id" value="${escapeHtml(validated.clientId)}"><input type="hidden" name="redirect_uri" value="${escapeHtml(validated.redirectUri)}"><input type="hidden" name="state" value="${escapeHtml(validated.state || '')}">
<label>Область доступа <select name="scope"><option value="kanban:work" ${requested === 'work' ? 'selected' : ''}>Рабочие задачи (рекомендуется)</option><option value="kanban:personal" ${requested === 'personal' ? 'selected' : ''}>Личные задачи</option></select></label>
<p><small>ChatGPT получит только выбранную область. Данные другой доски недоступны.</small></p><button name="approve" value="yes" type="submit">Разрешить</button><button name="approve" value="no" type="submit">Отмена</button></form></main>`;
  return new NextResponse(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const clientId = String(form.get('client_id') || '');
  const redirectUri = String(form.get('redirect_uri') || '');
  const state = String(form.get('state') || '');
  if (clientId !== oauthClientId() || !isAllowedRedirectUri(redirectUri)) return NextResponse.json({ error: 'invalid OAuth request' }, { status: 400 });
  const identity = identityFromRequest(request);
  if (!identity) return new NextResponse('authentication required', { status: 401 });
  if (form.get('approve') !== 'yes') return redirectError(redirectUri, 'access_denied', state || null);
  try {
    const code = authStore().createAuthorizationCode(identity.username, clientId, redirectUri, String(form.get('scope') || 'kanban:work'));
    const target = new URL(redirectUri);
    target.searchParams.set('code', code);
    if (state) target.searchParams.set('state', state);
    return NextResponse.redirect(target);
  } catch {
    return redirectError(redirectUri, 'invalid_scope', state || null);
  }
}
