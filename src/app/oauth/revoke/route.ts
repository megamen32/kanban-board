import { NextRequest, NextResponse } from 'next/server';
import { oauthClientId } from '@/lib/auth/config';
import { authStore } from '@/lib/auth/request';

export async function POST(request: NextRequest) {
  const form = await request.formData();
  if (String(form.get('client_id') || oauthClientId()) !== oauthClientId()) return NextResponse.json({ error: 'invalid_client' }, { status: 401 });
  const token = String(form.get('token') || '');
  if (token) authStore().revokeAccessToken(token);
  return new NextResponse(null, { status: 200 });
}
