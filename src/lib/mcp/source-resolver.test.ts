import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createSourceAdmissionVerifier, type SignedSourceAdmissionEnvelope } from './source-resolver';

const sourceRef = '2f25df26-5d80-4ed0-9227-30dbf9e53170';
const request = {
  tenant: 'exmanager-team:team-1', sourceOwner: 'airlock-user-2', sourceEvent: sourceRef, primaryItem: 'primary',
  sourceRevision: 'sha256:decision', project: 'alpha', title: 'Review intake',
  description: 'Check the submitted source', priority: 'medium', assignees: [],
  classification: 'explicit-task', evidenceRefs: [`exmanager-task-source:${sourceRef}#span:1-20`],
} as const;
const DOMAIN = Buffer.from('exmanager-source-admission-v1\n', 'utf8');
const AUTH_NOW = 1_800_000_000_000;

function fixture() {
  const keys = generateKeyPairSync('ed25519');
  const der = keys.publicKey.export({ format: 'der', type: 'spki' });
  const publicKey = Buffer.from(der).subarray(-32).toString('base64url');
  const encode = (value: unknown, issuedAtMs = AUTH_NOW, expiresAtMs = AUTH_NOW + 120_000): SignedSourceAdmissionEnvelope => {
    const payload = Buffer.from(JSON.stringify(value), 'utf8');
    const authorization = Buffer.from(`\nsource-admission\n${issuedAtMs}\n${expiresAtMs}`, 'utf8');
    const signature = sign(null, Buffer.concat([DOMAIN, payload, authorization]), keys.privateKey);
    return { payload: payload.toString('base64url'), purpose: 'source-admission', issuedAtMs, expiresAtMs, signature: signature.toString('base64url') };
  };
  return { publicKey, encode };
}

function decode(envelope: SignedSourceAdmissionEnvelope): unknown {
  return JSON.parse(Buffer.from(envelope.payload, 'base64url').toString('utf8'));
}

describe('signed canonical source envelope', () => {
  it('stays disabled without a valid pinned public verifier', () => {
    expect(createSourceAdmissionVerifier(undefined)).toBeUndefined();
    expect(createSourceAdmissionVerifier('legacy-signed-envelope')).toBeUndefined();
    expect(createSourceAdmissionVerifier('A')).toBeUndefined();
  });

  it('verifies the exact Go payload bytes and returns only the strict canonical request', () => {
    const keys = fixture();
    const envelope = keys.encode({ sourceRef, request });
    const verifier = createSourceAdmissionVerifier(keys.publicKey, { now: () => AUTH_NOW })!;
    expect(verifier(envelope)).toEqual(request);
    expect(verifier(envelope)).toEqual(request);
  });

  it('rejects unsigned or changed raw service payloads before any Board admission', () => {
    const keys = fixture();
    const verifier = createSourceAdmissionVerifier(keys.publicKey, { now: () => AUTH_NOW })!;
    const valid = keys.encode({ sourceRef, request });
    expect(() => verifier({ ...valid, signature: 'A'.repeat(86) })).toThrow(/signature/);
    const alteredPayload = keys.encode({ sourceRef, request: { ...request, sourceOwner: 'forged-user' } });
    expect(() => verifier({ ...alteredPayload, signature: valid.signature })).toThrow(/signature/);
    expect(() => verifier({ ...valid, payload: Buffer.from(JSON.stringify({ sourceRef, request, actorId: 'forged' })).toString('base64url') })).toThrow(/signature/);
  });

  it('rejects signed but malformed protocol/source joins and unknown fields', () => {
    const keys = fixture();
    const verifier = createSourceAdmissionVerifier(keys.publicKey, { now: () => AUTH_NOW })!;
    expect(() => verifier(keys.encode({ sourceRef, request: { ...request, sourceOwner: ' ' } }))).toThrow(/source admission/);
    expect(() => verifier(keys.encode({ sourceRef, request: { ...request, sourceEvent: 'b9a57cf1-4273-4fc7-9b9b-eed1d7f6945f' } }))).toThrow(/does not match/);
    expect(() => verifier(keys.encode({ sourceRef, request, actorId: 'extra-authority' }))).toThrow(/payload/);
    expect(() => verifier(keys.encode({ sourceRef: 'not-a-uuid', request }))).toThrow(/payload/);
  });

  it('preserves idea and ambiguous classifications in the signed canonical request', () => {
    const keys = fixture();
    const verifier = createSourceAdmissionVerifier(keys.publicKey, { now: () => AUTH_NOW })!;
    for (const classification of ['idea', 'ambiguous'] as const) {
      expect(verifier(keys.encode({ sourceRef, request: { ...request, classification } }))).toMatchObject({ classification });
    }
  });

  it('requires fresh bounded purpose-bound authorization while keeping replay identity stable', () => {
    const keys = fixture();
    const verifier = createSourceAdmissionVerifier(keys.publicKey, { now: () => AUTH_NOW })!;
    const valid = keys.encode({ sourceRef, request });
    expect(verifier(valid)).toEqual(request);
    expect(verifier(keys.encode({ sourceRef, request }, AUTH_NOW + 1, AUTH_NOW + 120_001))).toEqual(request);
    expect(() => verifier(keys.encode({ sourceRef, request }, AUTH_NOW - 120_001, AUTH_NOW - 1))).toThrow(/validity/);
    expect(() => verifier(keys.encode({ sourceRef, request }, AUTH_NOW + 30_001, AUTH_NOW + 150_001))).toThrow(/validity/);
    expect(() => verifier(keys.encode({ sourceRef, request }, AUTH_NOW, AUTH_NOW + 120_001))).toThrow(/validity/);
    expect(() => verifier({ ...valid, purpose: 'task-launch' as 'source-admission' })).toThrow(/envelope/);
    expect(() => verifier({ ...valid, expiresAtMs: valid.expiresAtMs - 1 })).toThrow(/signature/);
  });
});
