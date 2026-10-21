import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AIRLOCK_TODO_NATIVE_IDENTITY_HEADER,
  requestPathAndQuery,
  verifyAirlockTodoNativeIdentity,
} from './airlock-native-identity';

const pair = generateKeyPairSync('ed25519');
const domain = Buffer.from('airlock-todo-native-identity-v1\n');
const cardPath = '/api/kanban/cards/550e8400-e29b-41d4-a716-446655440000/execution';

function signedRequest({
  userId = 'member-a', method = 'GET', path = `${cardPath}?project=Alpha`, body = '', project = 'Alpha', lifetimeMs = 60_000,
}: { userId?: string; method?: string; path?: string; body?: string; project?: string; lifetimeMs?: number } = {}): { request: Request; token: string } {
  const request = new Request(`https://todo.example${path}`, {
    method,
    ...(body ? { headers: { 'content-type': 'application/json' }, body } : {}),
  });
  const now = Date.now();
  const payload = { v: 1, userId, method, path: requestPathAndQuery(request),
    bodySha256: createHash('sha256').update(body).digest('base64url'), project, issuedAtMs: now, expiresAtMs: now + lifetimeMs };
  const bytes = Buffer.from(JSON.stringify(payload));
  const token = `${bytes.toString('base64url')}.${sign(null, Buffer.concat([domain, bytes]), pair.privateKey).toString('base64url')}`;
  request.headers.set(AIRLOCK_TODO_NATIVE_IDENTITY_HEADER, token);
  return { request, token };
}

describe('Airlock Todo native identity assertion', () => {
  it('distinguishes absent identity from a valid signed, exact-request identity', async () => {
    expect(await verifyAirlockTodoNativeIdentity(new Request(`https://todo.example${cardPath}`), pair.publicKey)).toBeNull();
    const { request } = signedRequest();
    await expect(verifyAirlockTodoNativeIdentity(request, pair.publicKey)).resolves.toMatchObject({
      userId: 'member-a', method: 'GET', path: `${cardPath}?project=Alpha`, project: 'Alpha',
    });
  });

  it('rejects a fake key, tampered signature, and method/path/body mismatch', async () => {
    const { request, token } = signedRequest({ method: 'POST', body: '{"project":"Alpha"}', path: cardPath, project: 'Alpha' });
    const other = generateKeyPairSync('ed25519');
    await expect(verifyAirlockTodoNativeIdentity(request, other.publicKey)).rejects.toThrow('native_identity_invalid');

    const [payload, signature] = token.split('.');
    const damaged = `${payload}.${`${signature!.slice(0, -1)}${signature!.endsWith('A') ? 'B' : 'A'}`}`;
    request.headers.set(AIRLOCK_TODO_NATIVE_IDENTITY_HEADER, damaged);
    await expect(verifyAirlockTodoNativeIdentity(request, pair.publicKey)).rejects.toThrow('native_identity_invalid');

    const { request: original } = signedRequest({ method: 'POST', body: '{"project":"Alpha"}', path: cardPath, project: 'Alpha' });
    const changed = new Request(`https://todo.example${cardPath}?changed=1`, {
      method: 'POST', headers: { 'content-type': 'application/json', [AIRLOCK_TODO_NATIVE_IDENTITY_HEADER]: original.headers.get(AIRLOCK_TODO_NATIVE_IDENTITY_HEADER)! },
      body: '{"project":"Alpha"}',
    });
    await expect(verifyAirlockTodoNativeIdentity(changed, pair.publicKey)).rejects.toThrow('native_identity_invalid');
  });

  it('rejects expired and oversized-TTL payloads', async () => {
    const expired = signedRequest();
    await expect(verifyAirlockTodoNativeIdentity(expired.request, pair.publicKey, Date.now() + 120_000)).rejects.toThrow('native_identity_invalid');
    const oversized = signedRequest({ lifetimeMs: 120_001 });
    await expect(verifyAirlockTodoNativeIdentity(oversized.request, pair.publicKey)).rejects.toThrow('native_identity_invalid');
  });

  it('matches the frozen Go producer vector byte for byte', async () => {
    const assertion = 'eyJ2IjoxLCJ1c2VySWQiOiJxYS11c2VyLTQyIiwibWV0aG9kIjoiUE9TVCIsInBhdGgiOiIvYXBpL2thbmJhbi9jYXJkcy8zOWUwNDEyMC05N2U1LTQzMDItOTc1Ni01MDcyZGUxMGM4NGMvZXhlY3V0aW9uIiwiYm9keVNoYTI1NiI6IjBCTF9Bd1NqZjVaMGkzN3A1d3Z0clVXa0J6MTNsX3NKRTRJMEdKRUxyZzQiLCJwcm9qZWN0IjoiIiwiaXNzdWVkQXRNcyI6MTcwMDAwMDAwMDAwMCwiZXhwaXJlc0F0TXMiOjE3MDAwMDAxMjAwMDB9.9nYzp7Mpv5a12ihcMxh249lsgQ9655SFN6u1Dq2UNsTB2cBJFYLj6X8oSDYS8Zu8fcw9BAiNT5S35gIadDyHBg';
    const rawPublicKey = '7kXsuaygGgq9g-9W3ZhcjIdObn9K687fIL2NiMKgrdc';
    const path = '/api/kanban/cards/39e04120-97e5-4302-9756-5072de10c84c/execution';
    const body = '{"action":"resume","expectedVersion":11}';
    const request = new Request(`https://todo.example${path}`, { method: 'POST',
      headers: { 'content-type': 'application/json', [AIRLOCK_TODO_NATIVE_IDENTITY_HEADER]: assertion }, body });
    await expect(verifyAirlockTodoNativeIdentity(request, rawPublicKey, 1_700_000_000_000)).resolves.toMatchObject({
      userId: 'qa-user-42', method: 'POST', path, project: '', bodySha256: '0BL_AwSjf5Z0i37p5wvtrUWkBz13l_sJE4I0GJELrg4',
    });
  });
});
