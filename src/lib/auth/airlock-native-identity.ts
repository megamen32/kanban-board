import { createHash, createPublicKey, timingSafeEqual, verify, type KeyObject } from 'node:crypto';

export const AIRLOCK_TODO_NATIVE_IDENTITY_HEADER = 'X-Airlock-Todo-Native-Identity';
const SIGNING_DOMAIN = Buffer.from('airlock-todo-native-identity-v1\n', 'utf8');
const MAX_ASSERTION_BYTES = 8 * 1024;
const MAX_REQUEST_BODY_BYTES = 2 * 1024 * 1024;
const MAX_CLOCK_SKEW_MS = 30_000;
const MAX_ASSERTION_TTL_MS = 120_000;

export interface AirlockTodoNativeIdentity {
  v: 1;
  userId: string;
  method: string;
  path: string;
  bodySha256: string;
  project: string;
  issuedAtMs: number;
  expiresAtMs: number;
}

/**
 * Returns null only when the signed-native header is absent. A present but
 * malformed, expired, or request-mismatched assertion always throws.
 */
export async function verifyAirlockTodoNativeIdentity(
  request: Request,
  publicKey: string | KeyObject,
  nowMs = Date.now(),
): Promise<AirlockTodoNativeIdentity | null> {
  const token = request.headers.get(AIRLOCK_TODO_NATIVE_IDENTITY_HEADER);
  if (token === null) return null;
  try {
    if (token.length > MAX_ASSERTION_BYTES || token.trim() !== token) throw new Error();
    const parts = token.split('.');
    if (parts.length !== 2) throw new Error();
    const payloadBytes = decodeBase64Url(parts[0]!);
    const signature = decodeBase64Url(parts[1]!);
    if (signature.length !== 64) throw new Error();
    const payloadText = payloadBytes.toString('utf8');
    const parsed: unknown = JSON.parse(payloadText);
    const payload = parsePayload(parsed, payloadText);
    const key = toEd25519PublicKey(publicKey);
    if (key.asymmetricKeyType !== 'ed25519' || key.type !== 'public') throw new Error();
    const signed = Buffer.concat([SIGNING_DOMAIN, payloadBytes]);
    if (!verify(null, signed, key, signature)) throw new Error();

    const actualPath = requestPathAndQuery(request);
    const body = await readRequestBody(request);
    const actualBodyHash = createHash('sha256').update(body).digest();
    const signedBodyHash = decodeBase64Url(payload.bodySha256);
    if (payload.method !== request.method.toUpperCase() || payload.path !== actualPath
      || signedBodyHash.length !== actualBodyHash.length || !timingSafeEqual(signedBodyHash, actualBodyHash)) throw new Error();

    if (!Number.isSafeInteger(nowMs) || !Number.isSafeInteger(payload.issuedAtMs) || !Number.isSafeInteger(payload.expiresAtMs)
      || payload.issuedAtMs > nowMs + MAX_CLOCK_SKEW_MS || nowMs - payload.issuedAtMs > MAX_ASSERTION_TTL_MS
      || payload.expiresAtMs <= nowMs || payload.expiresAtMs <= payload.issuedAtMs
      || payload.expiresAtMs - payload.issuedAtMs > MAX_ASSERTION_TTL_MS) throw new Error();
    if (!isSupportedNativeProjectRoute(payload.method, new URL(request.url).pathname)) throw new Error();
    return payload;
  } catch {
    throw new Error('native_identity_invalid');
  }
}

function toEd25519PublicKey(value: string | KeyObject): KeyObject {
  if (typeof value !== 'string') return value;
  if (value.includes('-----BEGIN PUBLIC KEY-----')) return createPublicKey(value);
  const raw = decodeBase64Url(value);
  if (raw.length !== 32) throw new Error();
  return createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]), format: 'der', type: 'spki' });
}

/** The signed path is the exact original request-target (escaped path plus query). */
export function requestPathAndQuery(request: Request): string {
  const url = new URL(request.url);
  return `${url.pathname}${url.search}`;
}

/** Only the already-agreed card execution routes may carry an empty project hint. */
export function isSupportedNativeProjectRoute(method: string, pathname: string): boolean {
  const verb = method.toUpperCase();
  if (verb === 'GET' && pathname === '/api/kanban/cards') return true;
  if (verb === 'POST' && pathname === '/api/kanban/source-intent/execution') return true;
  if (verb === 'GET' && /^\/api\/kanban\/cards\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(pathname)) return true;
  return ['GET', 'PATCH', 'POST'].includes(verb)
    && /^\/api\/kanban\/cards\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/execution$/i.test(pathname);
}

export async function nativeProjectHintFromRequest(request: Request): Promise<string> {
  const url = new URL(request.url);
  const queryValues = url.searchParams.getAll('project').map(value => value.trim());
  if (queryValues.length > 1 && queryValues.some(value => value !== queryValues[0])) throw new Error('native_project_hint_invalid');

  let bodyHint = '';
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  const rawBody = await readRequestBody(request);
  const hasJsonBody = contentType === 'application/json' || contentType?.endsWith('+json')
    || /^\s*\{/.test(rawBody.toString('utf8'));
  if (hasJsonBody) {
    const body = rawBody;
    if (body.length > 0) {
      let value: unknown;
      try { value = JSON.parse(body.toString('utf8')); } catch { throw new Error('native_project_hint_invalid'); }
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('native_project_hint_invalid');
      const record = value as Record<string, unknown>;
      if (record.project !== undefined) {
        if (typeof record.project !== 'string') throw new Error('native_project_hint_invalid');
        bodyHint = record.project.trim();
      }
    }
  }
  const queryHint = queryValues[0] ?? '';
  if (queryHint && bodyHint && queryHint !== bodyHint) throw new Error('native_project_hint_invalid');
  return bodyHint || queryHint;
}

function parsePayload(value: unknown, raw: string): AirlockTodoNativeIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
  const record = value as Record<string, unknown>;
  const expectedOrder = ['v', 'userId', 'method', 'path', 'bodySha256', 'project', 'issuedAtMs', 'expiresAtMs'];
  if (Object.keys(record).join(',') !== expectedOrder.join(',') || JSON.stringify(record) !== raw
    || record.v !== 1 || typeof record.userId !== 'string' || !record.userId.trim() || record.userId.length > 256
    || record.userId !== record.userId.trim() || typeof record.method !== 'string'
    || !['GET', 'PATCH', 'POST'].includes(record.method) || typeof record.path !== 'string'
    || !record.path.startsWith('/') || record.path.length > 4096 || typeof record.bodySha256 !== 'string'
    || typeof record.bodySha256 !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(record.bodySha256)
    || decodeBase64Url(record.bodySha256).length !== 32 || typeof record.project !== 'string'
    || record.project.length > 512 || record.project !== record.project.trim()
    || typeof record.issuedAtMs !== 'number' || typeof record.expiresAtMs !== 'number') throw new Error();
  return record as unknown as AirlockTodoNativeIdentity;
}

function decodeBase64Url(value: string): Buffer {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value) throw new Error();
  return decoded;
}

async function readRequestBody(request: Request): Promise<Buffer> {
  const stream = request.clone().body;
  if (!stream) return Buffer.alloc(0);
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_REQUEST_BODY_BYTES) throw new Error('native_request_body_limit');
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, length);
}
