import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import { createHash } from 'node:crypto';
import type { CatalogTaskLinkRequest } from '../kanban/catalog-link';
import type { TaskResult } from '../kanban/types';

export interface SignedCatalogLinkEnvelope {
  payload: string;
  purpose: 'catalog-link';
  issuedAtMs: number;
  expiresAtMs: number;
  signature: string;
}

export interface CatalogLinkClaims extends CatalogTaskLinkRequest {
  actorId: string;
  subjectEvidenceRef: string;
}

export function catalogSubjectKey(sourceRef: string, subjectEvidenceRef: string): string {
  return createHash('sha256').update(`${sourceRef}\0${subjectEvidenceRef}`, 'utf8').digest('hex');
}

export function catalogResultDigest(result: TaskResult | undefined): string {
  if (!result || typeof result.summary !== 'string' || !Array.isArray(result.evidenceRefs)
      || typeof result.submittedBy !== 'string' || typeof result.submittedAt !== 'string') {
    throw new Error('current persisted Board result is required');
  }
  const canonical = JSON.stringify({ summary: result.summary, evidenceRefs: result.evidenceRefs,
    nextAction: result.nextAction, runRef: result.runRef, submittedBy: result.submittedBy, submittedAt: result.submittedAt });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

const DOMAIN = Buffer.from('exmanager-catalog-link-v1\n', 'utf8');
const MAX_TTL_MS = 120_000;
const MAX_FUTURE_SKEW_MS = 30_000;
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function decode(value: unknown, max: number): Buffer {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid catalog link envelope');
  const bytes = Buffer.from(value, 'base64url');
  if (!bytes.length || bytes.length > max || bytes.toString('base64url') !== value) throw new Error('invalid catalog link envelope');
  return bytes;
}

function keyFromRaw(value: string | undefined): KeyObject | undefined {
  if (!value) return undefined;
  try {
    const raw = decode(value, 32);
    return raw.length === 32 ? createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: 'der', type: 'spki' }) : undefined;
  } catch { return undefined; }
}

function parseClaims(bytes: Buffer): CatalogLinkClaims {
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('invalid catalog link payload'); }
  if (!record(value)) throw new Error('invalid catalog link payload');
  const allowed = ['actorId', 'subjectKey', 'subjectEvidenceRef', 'taskId', 'expectedBoardVersion', 'sourceRef', 'sourceRevision', 'resultDigest', 'boardProject', 'projectId', 'planIds', 'gateIds', 'contactIds', 'catalogRevision', 'operationRef'];
  if (Object.keys(value).sort().join(',') !== [...allowed].sort().join(',')
      || typeof value.actorId !== 'string' || !value.actorId.trim() || value.actorId.length > 256
      || typeof value.taskId !== 'string' || !UUID.test(value.taskId)
      || typeof value.subjectKey !== 'string' || !/^[a-f0-9]{64}$/.test(value.subjectKey)
      || typeof value.subjectEvidenceRef !== 'string' || !value.subjectEvidenceRef.trim() || value.subjectEvidenceRef.length > 2000
      || typeof value.sourceRef !== 'string' || !UUID.test(value.sourceRef)
      || value.subjectKey !== catalogSubjectKey(value.sourceRef, value.subjectEvidenceRef)
      || typeof value.boardProject !== 'string' || !value.boardProject.trim() || value.boardProject.length > 160
      || !Number.isSafeInteger(value.expectedBoardVersion) || (value.expectedBoardVersion as number) < 1
      || typeof value.resultDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.resultDigest)) throw new Error('invalid catalog link payload');
  for (const field of ['sourceRevision', 'projectId', 'catalogRevision', 'operationRef'] as const) {
    if (typeof value[field] !== 'string' || !value[field] || value[field].length > 512 || /\s/.test(value[field])) throw new Error('invalid catalog link payload');
  }
  for (const field of ['planIds', 'gateIds', 'contactIds'] as const) {
    const list = value[field];
    if (!Array.isArray(list) || list.length > 100 || list.some(id => typeof id !== 'string' || !id || id.length > 512 || /\s/.test(id))
        || new Set(list).size !== list.length) throw new Error('invalid catalog link payload');
  }
  return value as unknown as CatalogLinkClaims;
}

/** Verifies the server-only result-to-catalog receipt; missing config disables the consumer. */
export function createCatalogLinkVerifier(publicKey: string | undefined, options: { now?: () => number } = {}) {
  const key = keyFromRaw(publicKey);
  if (!key) return undefined;
  return (envelope: SignedCatalogLinkEnvelope): CatalogLinkClaims => {
    if (!record(envelope) || Object.keys(envelope).sort().join(',') !== 'expiresAtMs,issuedAtMs,payload,purpose,signature'
        || envelope.purpose !== 'catalog-link' || !Number.isSafeInteger(envelope.issuedAtMs) || !Number.isSafeInteger(envelope.expiresAtMs)) {
      throw new Error('invalid catalog link envelope');
    }
    const issued = envelope.issuedAtMs as number;
    const expires = envelope.expiresAtMs as number;
    const now = (options.now ?? Date.now)();
    if (issued > now + MAX_FUTURE_SKEW_MS || expires <= now || expires <= issued || expires - issued > MAX_TTL_MS) {
      throw new Error('catalog link authorization is outside its validity window');
    }
    const payload = decode(envelope.payload, 64 * 1024);
    const signature = decode(envelope.signature, 64);
    const authorization = Buffer.from(`\ncatalog-link\n${issued}\n${expires}`, 'utf8');
    if (signature.length !== 64 || !verify(null, Buffer.concat([DOMAIN, payload, authorization]), key, signature)) {
      throw new Error('catalog link signature is invalid');
    }
    return parseClaims(payload);
  };
}

export function configuredCatalogLinkVerifier(env: Readonly<Record<string, string | undefined>> = process.env) {
  return createCatalogLinkVerifier(env.EXMANAGER_SOURCE_ADMISSION_PUBLIC_KEY);
}
