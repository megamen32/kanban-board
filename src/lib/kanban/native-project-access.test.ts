import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { AIRLOCK_TODO_NATIVE_IDENTITY_HEADER, requestPathAndQuery } from '../auth/airlock-native-identity';
import { nativeProjectAccessForRequest } from './native-project-access';

const keyPair = generateKeyPairSync('ed25519');
const prefix = Buffer.from('airlock-todo-native-identity-v1\n');
const cardPath = '/api/kanban/cards/550e8400-e29b-41d4-a716-446655440000/execution';
const endpoint = 'https://exmanager.example/internal/todo/project-scope';

function requestFor(userId: string, project = 'Alpha'): { request: Request; assertion: string } {
  const path = `${cardPath}?project=${encodeURIComponent(project)}`;
  const request = new Request(`https://todo.example${path}`);
  const issuedAtMs = Date.now();
  const payload = { v: 1, userId, method: 'GET', path: requestPathAndQuery(request),
    bodySha256: createHash('sha256').update('').digest('base64url'), project, issuedAtMs, expiresAtMs: issuedAtMs + 60_000 };
  const bytes = Buffer.from(JSON.stringify(payload));
  const assertion = `${bytes.toString('base64url')}.${sign(null, Buffer.concat([prefix, bytes]), keyPair.privateKey).toString('base64url')}`;
  request.headers.set(AIRLOCK_TODO_NATIVE_IDENTITY_HEADER, assertion);
  return { request, assertion };
}

describe('native project access client', () => {
  it('forwards the exact assertion and resolves current per-member read/write grants without a global cache', async () => {
    const grants = new Map([
      ['member-owner', { project: 'Alpha', team: 'integrator', readAllowed: true, writeAllowed: true }],
      ['member-reviewer', { project: 'Alpha', team: 'integrator', readAllowed: true, writeAllowed: false }],
    ]);
    let revoked = false;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(endpoint);
      expect(init?.method).toBe('POST');
      const sentHeaders = new Headers(init?.headers);
      const assertion = sentHeaders.get(AIRLOCK_TODO_NATIVE_IDENTITY_HEADER);
      expect(assertion).toBeTruthy();
      const body = JSON.parse(String(init?.body)) as { project: string };
      expect(body).toEqual({ project: 'Alpha' });
      const actor = JSON.parse(Buffer.from(assertion!.split('.')[0]!, 'base64url').toString('utf8')).userId as string;
      if (actor === 'member-reviewer' && revoked) return new Response(null, { status: 403 });
      const access = grants.get(actor);
      if (!access) return new Response(null, { status: 403 });
      return Response.json(access);
    });
    const options = { endpoint, publicKey: keyPair.publicKey, fetcher: fetcher as unknown as typeof fetch };

    const owner = requestFor('member-owner');
    const ownerContext = await nativeProjectAccessForRequest(owner.request, options);
    expect(ownerContext?.userId).toBe('member-owner');
    await expect(ownerContext!.forProject('Alpha')).resolves.toEqual({
      project: 'Alpha', team: 'integrator', readAllowed: true, writeAllowed: true,
    });
    await ownerContext!.forProject('Alpha');
    expect(fetcher).toHaveBeenCalledTimes(1); // repeated reads are cached only within this request
    expect(new Headers(fetcher.mock.calls[0]![1]?.headers).get(AIRLOCK_TODO_NATIVE_IDENTITY_HEADER)).toBe(owner.assertion);

    const reviewer = requestFor('member-reviewer');
    const reviewerContext = await nativeProjectAccessForRequest(reviewer.request, options);
    await expect(reviewerContext!.forProject('Alpha')).resolves.toMatchObject({ readAllowed: true, writeAllowed: false });
    revoked = true;
    const afterRevocation = await nativeProjectAccessForRequest(reviewer.request, options);
    await expect(afterRevocation!.forProject('Alpha')).rejects.toThrow('native_project_access_denied');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('allows an empty list hint to query multiple canonical projects and rejects a non-empty mismatch', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const project = (JSON.parse(String(init?.body)) as { project: string }).project;
      return Response.json({ project, team: 'integrator', readAllowed: true, writeAllowed: false });
    });
    const empty = requestFor('member-reviewer', '');
    // An empty hint is valid on the bounded cards-list route.
    const url = 'https://todo.example/api/kanban/cards';
    const request = new Request(url, { headers: { [AIRLOCK_TODO_NATIVE_IDENTITY_HEADER]: empty.assertion } });
    // Re-sign for the no-hint request target and empty project.
    const issuedAtMs = Date.now();
    const payload = { v: 1, userId: 'member-reviewer', method: 'GET', path: requestPathAndQuery(request),
      bodySha256: createHash('sha256').update('').digest('base64url'), project: '', issuedAtMs, expiresAtMs: issuedAtMs + 60_000 };
    const bytes = Buffer.from(JSON.stringify(payload));
    request.headers.set(AIRLOCK_TODO_NATIVE_IDENTITY_HEADER,
      `${bytes.toString('base64url')}.${sign(null, Buffer.concat([prefix, bytes]), keyPair.privateKey).toString('base64url')}`);
    const context = await nativeProjectAccessForRequest(request, { endpoint, publicKey: keyPair.publicKey, fetcher: fetcher as unknown as typeof fetch });
    await expect(context!.forProject('Alpha')).resolves.toMatchObject({ project: 'Alpha' });
    await expect(context!.forProject('Beta')).resolves.toMatchObject({ project: 'Beta' });
    expect(fetcher).toHaveBeenCalledTimes(2);

    const hinted = requestFor('member-reviewer', 'Beta');
    const mismatch = await nativeProjectAccessForRequest(hinted.request, { endpoint, publicKey: keyPair.publicKey, fetcher: fetcher as unknown as typeof fetch });
    await expect(mismatch!.forProject('Alpha')).rejects.toThrow('native_project_access_denied');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('keeps verified request context usable after the route consumes its body', async () => {
    const body = '{"action":"resume","expectedVersion":11,"project":"Alpha"}';
    const path = `${cardPath}`;
    const request = new Request(`https://todo.example${path}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body });
    const issuedAtMs = Date.now();
    const payload = { v: 1, userId: 'member-owner', method: 'PATCH', path: requestPathAndQuery(request),
      bodySha256: createHash('sha256').update(body).digest('base64url'), project: 'Alpha', issuedAtMs, expiresAtMs: issuedAtMs + 60_000 };
    const bytes = Buffer.from(JSON.stringify(payload));
    request.headers.set(AIRLOCK_TODO_NATIVE_IDENTITY_HEADER,
      `${bytes.toString('base64url')}.${sign(null, Buffer.concat([prefix, bytes]), keyPair.privateKey).toString('base64url')}`);
    const fetcher = vi.fn(async () => Response.json({ project: 'Alpha', team: 'integrator', readAllowed: true, writeAllowed: true }));
    const context = await nativeProjectAccessForRequest(request, { endpoint, publicKey: keyPair.publicKey,
      fetcher: fetcher as unknown as typeof fetch });
    expect(await request.json()).toMatchObject({ project: 'Alpha' });
    await expect(context!.forProject('Alpha')).resolves.toMatchObject({ writeAllowed: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps absent legacy identity distinct from a present invalid assertion', async () => {
    const absent = await nativeProjectAccessForRequest(new Request(`https://todo.example${cardPath}`), {
      endpoint, publicKey: keyPair.publicKey, fetcher: fetch as typeof fetch,
    });
    expect(absent).toBeNull();
    const invalid = requestFor('member-owner');
    const [payload, signature] = invalid.assertion.split('.');
    const signatureBytes = Buffer.from(signature!, 'base64url');
    signatureBytes[0] ^= 1;
    invalid.request.headers.set(AIRLOCK_TODO_NATIVE_IDENTITY_HEADER, `${payload}.${signatureBytes.toString('base64url')}`);
    const fetcher = vi.fn(async () => Response.json({ project: 'Alpha', team: 'integrator', readAllowed: true, writeAllowed: true }));
    await expect(nativeProjectAccessForRequest(invalid.request, { endpoint, publicKey: keyPair.publicKey,
      fetcher: fetcher as unknown as typeof fetch })).rejects.toThrow('native_identity_invalid');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
