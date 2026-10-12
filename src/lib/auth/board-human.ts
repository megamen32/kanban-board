import type { NextRequest } from 'next/server';
import { uiScope } from './config';
import { identityFromRequest, type RequestIdentity } from './request';

/** Recognize the board's existing shared browser login, not a service/MCP token.
 * The gateway validates its own opaque cookie; no signing key is copied here.
 * Client headers, role selectors and request-body flags never establish identity.
 */
export async function boardHumanIdentityFromRequest(request: NextRequest): Promise<RequestIdentity | null> {
  const local = identityFromRequest(request);
  if (local) return local.accessToken ? null : local;
  // Bearer requests remain service requests, even if they also include a cookie.
  if (request.headers.has('authorization')) return null;
  const cookie = request.cookies.get('gptadmin_auth')?.value;
  if (!cookie) return null;
  try {
    const result = await fetch('https://auth.bezrabotnyi.com/check', {
      headers: { Cookie: `gptadmin_auth=${cookie}` },
      redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(3000),
    });
    if (result.status !== 204) return null;
    const user = result.headers.get('X-GPTAdmin-User')?.trim();
    if (!user) return null;
    // The existing fleet owner login and board owner are the same configured
    // human. Other verified accounts retain their own username, never Nikita's.
    return { username: user === 'roomhacker' ? 'nikita' : user, scope: uiScope() };
  } catch {
    return null;
  }
}
