import { NextRequest, NextResponse } from 'next/server';
import { boardHumanIdentityFromRequest } from '../../../../lib/auth/board-human';
import { tasksDirForScope } from '../../../../lib/auth/data-scope';
import { parseGraphLayoutChange } from '../../../../lib/kanban/graph-layout-preferences';
import { readGraphLayout, updateGraphLayout } from '../../../../lib/kanban/graph-layout-store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'private, no-store' };
const response = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: HEADERS });

/** One personal presentation per authenticated account, shared across its devices. */
export async function GET(request: NextRequest) {
  const identity = await boardHumanIdentityFromRequest(request);
  if (!identity) return response({ error: 'authenticated board session required' }, 401);
  try { return response({ layout: readGraphLayout(tasksDirForScope(identity.scope), identity) }); }
  catch { return response({ error: 'saved layout could not be read' }, 503); }
}
export async function PATCH(request: NextRequest) {
  const identity = await boardHumanIdentityFromRequest(request);
  if (!identity) return response({ error: 'authenticated board session required' }, 401);
  const origin = request.headers.get('origin');
  if (origin) {
    const hosts = new Set([request.nextUrl.host, request.headers.get('host'), request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()]);
    try { if (!hosts.has(new URL(origin).host)) return response({ error: 'cross-origin write denied' }, 403); }
    catch { return response({ error: 'invalid origin' }, 403); }
  }
  if (!request.headers.get('content-type')?.startsWith('application/json')) return response({ error: 'JSON required' }, 415);
  if (Number(request.headers.get('content-length')) > 524288) return response({ error: 'layout too large' }, 413);
  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text) > 524288) return response({ error: 'layout too large' }, 413);
    body = JSON.parse(text);
  } catch { return response({ error: 'invalid JSON' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['expectedVersion', 'change'].includes(key))
    || !Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion) < 0) return response({ error: 'expectedVersion and change required' }, 400);
  const change = parseGraphLayoutChange(body.change);
  if (!change) return response({ error: 'invalid layout change' }, 400);
  try {
    const result = updateGraphLayout(tasksDirForScope(identity.scope), identity, Number(body.expectedVersion), change);
    return response(result, result.conflict ? 409 : 200);
  } catch { return response({ error: 'layout could not be saved' }, 503); }
}
