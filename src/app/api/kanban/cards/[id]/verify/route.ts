import { NextRequest, NextResponse } from 'next/server';
import { boardHumanIdentityFromRequest } from '@/lib/auth/board-human';
import { boardIdentityFromRequest } from '@/lib/auth/request';
import { publicOrigin } from '@/lib/auth/origin';
import { airlockRelayConfig } from '@/lib/auth/airlock-relay';
import { tasksDirForScope } from '@/lib/auth/data-scope';
import { findCardById, updateCard } from '@/lib/kanban/file-store';
import { decideManualVerification, parseManualVerification } from '@/lib/kanban/manual-verification';
import { dispatchCardEvent } from '@/lib/notifications/push';

const headers = {'Cache-Control': 'private, no-store', 'Vary': 'Cookie'};
const reply = (body: unknown, status = 200) => NextResponse.json(body, {status, headers});

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
  // publicOrigin's forwarded-header fallback is not a configured trust grant.
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
      length += chunk.value.length;
      if (length > 32_768) { await reader.cancel(); return null; }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}

/** A single atomic Markdown CAS records the real human, proof and completion. */
export async function POST(request: NextRequest, {params}: {params: Promise<{id: string}>}) {
  try {
    const human = await boardHumanIdentityFromRequest(request);
    if (!human) return reply({error: 'human authentication required'}, 401);
    if (boardIdentityFromRequest(request).scope !== human.scope) return reply({error: 'scope mismatch'}, 403);
    if (!configuredHumanOrigin(request)) return reply({error: 'same-origin human action required'}, 403);
    if (!request.headers.get('content-type')?.startsWith('application/json')) return reply({error: 'JSON required'}, 415);
    const text = await boundedText(request);
    if (text === null) return reply({error: 'verification too large'}, 413);
    let body: unknown;
    try { body = JSON.parse(text); } catch { return reply({error: 'invalid verification JSON'}, 400); }
    const input = parseManualVerification(body);
    if (!input) return reply({error: 'verification_result_evidence_confirmation_required'}, 400);
    const {id} = await params;
    const tasksDir = tasksDirForScope(human.scope);
    const before = findCardById(id, tasksDir);
    if (!before) return reply({error: 'not found'}, 404);
    const decision = decideManualVerification(before, input, human.username);
    if (decision.kind !== 'accepted') return reply({error: decision.reason}, decision.status);
    const saved = updateCard(id, decision.patch, input.expectedVersion, tasksDir);
    if ('conflict' in saved) return reply({conflict: true, serverCard: saved.serverCard}, 409);
    await dispatchCardEvent(human.scope, 'moved', saved).catch(() => undefined);
    return reply({card: saved, decision: 'verified'});
  } catch {
    return reply({error: 'verification could not be saved; refresh before retry'}, 400);
  }
}
