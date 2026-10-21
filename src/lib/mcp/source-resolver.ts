import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import {
  validateSourceAdmissionRequest,
  type SourceAdmissionRequest,
} from '../kanban/source-operation';

export interface SignedSourceAdmissionEnvelope {
  payload: string;
  purpose: 'source-admission';
  issuedAtMs: number;
  expiresAtMs: number;
  signature: string;
}

const DOMAIN = Buffer.from('exmanager-source-admission-v1\n', 'utf8');
const SOURCE_REF = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_AUTHORIZATION_TTL_MS = 120_000;
const MAX_FUTURE_SKEW_MS = 30_000;
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function decodeBase64Url(value: unknown, maxBytes: number): Buffer {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid source admission envelope');
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length === 0 || decoded.length > maxBytes || decoded.toString('base64url') !== value) {
    throw new Error('invalid source admission envelope');
  }
  return decoded;
}

function parsePublicKey(value: string | undefined): KeyObject | undefined {
  if (!value?.trim()) return undefined;
  try {
    const raw = decodeBase64Url(value.trim(), 32);
    if (raw.length !== 32) return undefined;
    return createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
      format: 'der',
      type: 'spki',
    });
  } catch {
    return undefined;
  }
}

function parsePayload(payload: Buffer): SourceAdmissionRequest {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload));
  } catch {
    throw new Error('invalid source admission payload');
  }
  if (!isRecord(value) || Object.keys(value).sort().join(',') !== 'request,sourceRef'
      || typeof value.sourceRef !== 'string' || !SOURCE_REF.test(value.sourceRef) || !isRecord(value.request)) {
    throw new Error('invalid source admission payload');
  }
  const requestKeys = Object.keys(value.request).sort();
  const allowed = ['assignees', 'classification', 'description', 'dueAt', 'evidenceRefs', 'primaryItem',
    'priority', 'project', 'sourceEvent', 'sourceOwner', 'sourceRevision', 'tenant', 'title'];
  if (requestKeys.some(key => !allowed.includes(key))
      || requestKeys.filter(key => key !== 'dueAt').join(',') !== allowed.filter(key => key !== 'dueAt').join(',')) {
    throw new Error('invalid source admission payload');
  }
  const request = value.request as unknown as SourceAdmissionRequest;
  validateSourceAdmissionRequest(request);
  if (request.sourceEvent !== value.sourceRef) throw new Error('source admission event does not match its reference');
  return request;
}

/**
 * Verifies the server-only ExManager source envelope. The Board receives only a
 * pinned public key; an authenticated service bearer without this signature is
 * not authority to assert source identity or current grants.
 */
export function createSourceAdmissionVerifier(
  publicKey: string | undefined,
  options: { now?: () => number } = {},
) {
  const key = parsePublicKey(publicKey);
  if (!key) return undefined;

  return (envelope: SignedSourceAdmissionEnvelope): SourceAdmissionRequest => {
    if (!isRecord(envelope) || Object.keys(envelope).sort().join(',') !== 'expiresAtMs,issuedAtMs,payload,purpose,signature'
        || envelope.purpose !== 'source-admission'
        || !Number.isSafeInteger(envelope.issuedAtMs) || !Number.isSafeInteger(envelope.expiresAtMs)) {
      throw new Error('invalid source admission envelope');
    }
    const now = (options.now ?? Date.now)();
    const issuedAtMs = envelope.issuedAtMs as number;
    const expiresAtMs = envelope.expiresAtMs as number;
    if (issuedAtMs > now + MAX_FUTURE_SKEW_MS || expiresAtMs <= now
        || expiresAtMs <= issuedAtMs || expiresAtMs - issuedAtMs > MAX_AUTHORIZATION_TTL_MS) {
      throw new Error('source admission authorization is outside its validity window');
    }
    const payload = decodeBase64Url(envelope.payload, MAX_PAYLOAD_BYTES);
    const signature = decodeBase64Url(envelope.signature, 64);
    const authorization = Buffer.from(`\nsource-admission\n${issuedAtMs}\n${expiresAtMs}`, 'utf8');
    if (signature.length !== 64 || !verify(null, Buffer.concat([DOMAIN, payload, authorization]), key, signature)) {
      throw new Error('source admission signature is invalid');
    }
    return parsePayload(payload);
  };
}

/** Missing or malformed public-key configuration keeps only source admission disabled. */
export function configuredSourceAdmissionVerifier(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  return createSourceAdmissionVerifier(env.EXMANAGER_SOURCE_ADMISSION_PUBLIC_KEY);
}
