import { NextRequest, NextResponse } from 'next/server';
import { isAllowedRedirectUri, oauthClientId, oauthClientSecret } from '@/lib/auth/config';
import { authStore } from '@/lib/auth/request';

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const clientId = String(form.get('client_id') || '');
  const clientSecret = oauthClientSecret();
  if (clientId !== oauthClientId() || (clientSecret && form.get('client_secret') !== clientSecret)) return NextResponse.json({ error: 'invalid_client' }, { status: 401 });
  if (form.get('grant_type') !== 'authorization_code') return NextResponse.json({ error: 'unsupported_grant_type' }, { status: 400 });
  const redirectUri = String(form.get('redirect_uri') || '');
  if (!isAllowedRedirectUri(redirectUri)) return NextResponse.json({ error: 'invalid_grant' }, { status: 400 });
  const result = authStore().exchangeAuthorizationCode(String(form.get('code') || ''), clientId, redirectUri);
  if (!result) return NextResponse.json({ error: 'invalid_grant' }, { status: 400 });
  return NextResponse.json({ access_token: result.accessToken, token_type: result.tokenType, expires_in: result.expiresIn, scope: `kanban:${result.scope}` });
}
