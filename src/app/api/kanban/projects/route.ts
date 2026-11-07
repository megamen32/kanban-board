import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ownerBrowserReadAllowed } from '@/lib/auth/owner-browser-read';
import { airlockRelayConfig } from '@/lib/auth/airlock-relay';
import { publicOrigin } from '@/lib/auth/origin';
import { tasksDirForScope } from '@/lib/auth/data-scope';
import { ensureProject, projectInput } from '@/lib/kanban/project-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const inputSchema = z.object(projectInput).strict();
const MAX_BODY_BYTES = 8_192;
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

function httpOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || url.pathname !== '/' || url.search || url.hash || url.hostname.includes('*')) return null;
    return url.origin;
  } catch { return null; }
}

function configuredHumanOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin || httpOrigin(origin) !== origin) return false;
  // Forwarded headers alone never establish an allowed origin.
  if (httpOrigin(process.env.KANBAN_PUBLIC_ORIGIN?.trim())
    && httpOrigin(publicOrigin(request)) === origin) return true;
  const relay = airlockRelayConfig();
  return relay.enabled && httpOrigin(relay.agentOrigin) === origin;
}

async function boundedText(request: Request): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > MAX_BODY_BYTES) { await reader.cancel(); return null; }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/** Persist an empty project for the same verified native and Board owner. No task or team is created. */
export async function POST(request: NextRequest) {
  try {
    if (!await ownerBrowserReadAllowed(request)) return reply({ error: 'verified board owner required' }, 403);
  } catch (error) {
    const reason = error instanceof Error ? error.message : '';
    const status = reason === 'native_identity_invalid' || reason === 'native_owner_read_mismatch' ? 403 : 503;
    return reply({ error: status === 403 ? 'owner identity could not be verified' : 'owner verification unavailable' }, status);
  }
  if (!configuredHumanOrigin(request)) return reply({ error: 'same-origin owner action required' }, 403);
  if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    return reply({ error: 'JSON required' }, 415);
  }
  let text: string | null;
  try { text = await boundedText(request); }
  catch { return reply({ error: 'project JSON could not be read' }, 400); }
  if (text === null) return reply({ error: 'project request too large' }, 413);
  let body: unknown;
  try { body = JSON.parse(text); }
  catch { return reply({ error: 'invalid project JSON' }, 400); }
  const input = inputSchema.safeParse(body);
  if (!input.success) return reply({ error: 'exact externalKey and name are required' }, 400);
  try {
    const result = ensureProject(tasksDirForScope('work'), input.data);
    return reply(result, result.created ? 201 : 200);
  } catch (error) {
    if (error instanceof Error && error.message === 'Project conflict: externalKey already has a different name') {
      return reply({ error: 'project key is already bound to a different name' }, 409);
    }
    return reply({ error: 'project result could not be confirmed; retry with the same externalKey' }, 500);
  }
}
