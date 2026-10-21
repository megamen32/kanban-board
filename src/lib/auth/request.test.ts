import { NextRequest } from 'next/server';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AIRLOCK_TODO_NATIVE_IDENTITY_HEADER, requestPathAndQuery } from './airlock-native-identity';
import { boardIdentityFromRequest, identityFromRequest, managerRequestAuthorized, nativeProjectAccessContextFromRequest } from './request';

describe('board request identity', () => {
  const request = () => new NextRequest('http://localhost/api/kanban/cards');

  it('allows anonymous board access in the configured UI scope', () => {
    expect(boardIdentityFromRequest(request())).toEqual({ username: 'anonymous', scope: 'work' });
  });

  it('keeps the strict identity gate for ChatGPT OAuth', () => {
    expect(identityFromRequest(request())).toBeNull();
  });

  it('accepts the dedicated manager credential without turning it into a user session', () => {
    const previous = process.env.KANBAN_MANAGER_TOKEN;
    process.env.KANBAN_MANAGER_TOKEN = 'manager-secret';
    try {
      const managerRequest = new NextRequest('http://localhost/api/kanban/cards', {
        headers: { 'x-kanban-manager-token': 'manager-secret' },
      });
      expect(managerRequestAuthorized(managerRequest)).toBe(true);
      expect(identityFromRequest(managerRequest)).toBeNull();
      expect(managerRequestAuthorized(new NextRequest('http://localhost/api/kanban/cards', {
        headers: { 'x-kanban-manager-token': 'wrong-secret' },
      }))).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.KANBAN_MANAGER_TOKEN;
      else process.env.KANBAN_MANAGER_TOKEN = previous;
    }
  });

  it('keeps native identity absent distinct from invalid or unconfigured signed identity', async () => {
    const previousKey = process.env.AIRLOCK_TODO_NATIVE_IDENTITY_PUBLIC_KEY;
    const previousEndpoint = process.env.EXMANAGER_TODO_PROJECT_SCOPE_URL;
    delete process.env.AIRLOCK_TODO_NATIVE_IDENTITY_PUBLIC_KEY;
    delete process.env.EXMANAGER_TODO_PROJECT_SCOPE_URL;
    try {
      expect(await nativeProjectAccessContextFromRequest(request())).toBeNull();
      const invalid = new NextRequest('https://todo.example/api/kanban/cards/550e8400-e29b-41d4-a716-446655440000');
      invalid.headers.set(AIRLOCK_TODO_NATIVE_IDENTITY_HEADER, 'present-but-invalid');
      await expect(nativeProjectAccessContextFromRequest(invalid)).rejects.toThrow('native_identity_unconfigured');

      const pair = generateKeyPairSync('ed25519');
      const rawPublicKey = pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64url');
      process.env.AIRLOCK_TODO_NATIVE_IDENTITY_PUBLIC_KEY = rawPublicKey;
      process.env.EXMANAGER_TODO_PROJECT_SCOPE_URL = 'https://exmanager.example/internal/todo/project-scope';
      const path = '/api/kanban/cards/550e8400-e29b-41d4-a716-446655440000';
      const native = new NextRequest(`https://todo.example${path}`);
      const issuedAtMs = Date.now();
      const payload = { v: 1, userId: 'sdk-user-17', method: 'GET', path: requestPathAndQuery(native),
        bodySha256: createHash('sha256').update('').digest('base64url'), project: '', issuedAtMs, expiresAtMs: issuedAtMs + 60_000 };
      const bytes = Buffer.from(JSON.stringify(payload));
      native.headers.set(AIRLOCK_TODO_NATIVE_IDENTITY_HEADER,
        `${bytes.toString('base64url')}.${sign(null, Buffer.concat([Buffer.from('airlock-todo-native-identity-v1\n'), bytes]), pair.privateKey).toString('base64url')}`);
      const context = await nativeProjectAccessContextFromRequest(native);
      expect(context?.userId).toBe('sdk-user-17');
    } finally {
      if (previousKey === undefined) delete process.env.AIRLOCK_TODO_NATIVE_IDENTITY_PUBLIC_KEY;
      else process.env.AIRLOCK_TODO_NATIVE_IDENTITY_PUBLIC_KEY = previousKey;
      if (previousEndpoint === undefined) delete process.env.EXMANAGER_TODO_PROJECT_SCOPE_URL;
      else process.env.EXMANAGER_TODO_PROJECT_SCOPE_URL = previousEndpoint;
    }
  });
});
