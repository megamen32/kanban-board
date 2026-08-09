import { NextRequest, NextResponse } from 'next/server';
import { oauthClientId } from '@/lib/auth/config';
import { publicOrigin } from '@/lib/auth/origin';

function metadata(request: NextRequest) {
  const issuer = publicOrigin(request);
  return {
    issuer,
    authorization_endpoint: new URL('/oauth/authorize', issuer).toString(),
    token_endpoint: new URL('/oauth/token', issuer).toString(),
    revocation_endpoint: new URL('/oauth/revoke', issuer).toString(),
    client_id: oauthClientId(),
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    scopes_supported: ['openid', 'kanban:work', 'kanban:personal'],
  };
}

export function GET(request: NextRequest) {
  return NextResponse.json(metadata(request), {
    headers: { 'cache-control': 'no-store' },
  });
}
