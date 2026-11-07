import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ human: vi.fn(), tasksDir: vi.fn() }));
vi.mock('@/lib/auth/board-human', () => ({ boardHumanIdentityFromRequest: mocks.human }));
vi.mock('@/lib/auth/data-scope', () => ({ tasksDirForScope: mocks.tasksDir }));

import { POST } from './route';
import { AIRLOCK_TODO_NATIVE_IDENTITY_HEADER } from '@/lib/auth/airlock-native-identity';
import { listProjects } from '@/lib/kanban/project-store';

const pair = generateKeyPairSync('ed25519');
const domain = Buffer.from('airlock-todo-native-identity-v1\n');
const origin = 'https://todo.example.test';
const endpoint = origin + '/api/kanban/projects';
const input = { externalKey: 'fixture:empty-project', name: 'Проект / QA: empty' };
let root: string;

function request(options: {
  input?: unknown; rawBody?: string; signedBody?: string; userId?: string;
  native?: boolean; origin?: string | null; contentType?: string | null; lifetimeMs?: number;
} = {}): NextRequest {
  const body = options.rawBody ?? JSON.stringify(options.input === undefined ? input : options.input);
  const headers: Record<string, string> = {};
  const contentType = options.contentType === undefined ? 'application/json' : options.contentType;
  const requestOrigin = options.origin === undefined ? origin : options.origin;
  if (contentType !== null) headers['content-type'] = contentType;
  if (requestOrigin !== null) headers.origin = requestOrigin;
  if (options.native !== false) {
    const now = Date.now();
    const payload = {
      v: 1, userId: options.userId ?? 'fixture-owner', method: 'POST', path: '/api/kanban/projects',
      bodySha256: createHash('sha256').update(options.signedBody ?? body).digest('base64url'),
      project: '', issuedAtMs: now, expiresAtMs: now + (options.lifetimeMs ?? 60_000),
    };
    const bytes = Buffer.from(JSON.stringify(payload));
    headers[AIRLOCK_TODO_NATIVE_IDENTITY_HEADER] =
      `${bytes.toString('base64url')}.${sign(null, Buffer.concat([domain, bytes]), pair.privateKey).toString('base64url')}`;
  }
  return new NextRequest(endpoint, { method: 'POST', headers, body });
}

function expectNoWrite() {
  expect(mocks.tasksDir).not.toHaveBeenCalled();
  expect(fs.readdirSync(root)).toEqual([]);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-project-owner-'));
  mocks.tasksDir.mockReturnValue(root);
  mocks.human.mockResolvedValue({ username: 'nikita', scope: 'work' });
  vi.stubEnv('AIRLOCK_TODO_NATIVE_IDENTITY_PUBLIC_KEY', pair.publicKey.export({ format: 'pem', type: 'spki' }).toString());
  vi.stubEnv('KANBAN_PUBLIC_ORIGIN', 'https://board.example.test');
  vi.stubEnv('KANBAN_AIRLOCK_RELAY_DOMAIN', 'example.test');
  vi.stubEnv('KANBAN_AIRLOCK_RELAY_URL', 'https://airlock.example.test/auth/relay');
  vi.stubEnv('KANBAN_AIRLOCK_AGENT_ORIGIN', origin);
  vi.stubEnv('KANBAN_AIRLOCK_ACCOUNT_MAP', JSON.stringify({ 'fixture-owner': 'nikita', 'fixture-member': 'fixture-member' }));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe('POST /api/kanban/projects owner-only registry writes', () => {
  it('creates one durable empty project and reuses its immutable identity on retry', async () => {
    const first = await POST(request());
    expect(first.status).toBe(201);
    expect(first.headers.get('cache-control')).toBe('private, no-store');
    expect(first.headers.get('vary')).toBe('Cookie');
    const created = await first.json();
    expect(created).toEqual({ project: { ...input, id: expect.any(String) }, created: true });
    expect(mocks.tasksDir).toHaveBeenCalledWith('work');
    const repeated = await POST(request());
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toEqual({ project: created.project, created: false });
    expect(listProjects(root)).toEqual([created.project]);
    expect(fs.readdirSync(root)).toEqual(['.projects']);
    expect(fs.readdirSync(path.join(root, '.projects'))).toHaveLength(1);
  });

  it('returns 409 on an immutable-key name conflict and does not replace the existing project', async () => {
    const first = await (await POST(request())).json();
    const response = await POST(request({ input: { ...input, name: 'Different exact name' } }));
    expect(response.status).toBe(409);
    expect(listProjects(root)).toEqual([first.project]);
  });

  it('does not create tasks or change existing task contents while registering an empty project', async () => {
    const card = path.join(root, 'existing-fixture.md');
    fs.writeFileSync(card, '# Existing synthetic card\nKeep this unchanged.\n');
    const before = fs.readFileSync(card, 'utf8');
    expect((await POST(request())).status).toBe(201);
    expect(fs.readdirSync(root).sort()).toEqual(['.projects', 'existing-fixture.md']);
    expect(fs.readFileSync(card, 'utf8')).toBe(before);
  });

  it('requires the signed native proof even for an owner browser or supplied identity headers', async () => {
    const unsigned = request({ native: false });
    unsigned.headers.set('x-user', 'nikita');
    unsigned.headers.set('x-airlock-caller', 'untrusted-client-identity');
    expect((await POST(unsigned)).status).toBe(403);
    expect(mocks.human).not.toHaveBeenCalled();
    expectNoWrite();
  });

  it('requires the same current Board owner session as the signed caller', async () => {
    for (const human of [null, { username: 'fixture-member', scope: 'work' }, { username: 'nikita', scope: 'personal' }]) {
      mocks.human.mockResolvedValueOnce(human);
      expect((await POST(request())).status).toBe(403);
    }
    expect((await POST(request({ userId: 'fixture-member' }))).status).toBe(403);
    mocks.human.mockResolvedValueOnce({ username: 'fixture-member', scope: 'work' });
    expect((await POST(request({ userId: 'fixture-member' }))).status).toBe(403);
    expectNoWrite();
  });

  it('rejects tampered, expired and body-mismatched proofs before consulting the browser session', async () => {
    const tampered = request();
    const [payload, encoded] = tampered.headers.get(AIRLOCK_TODO_NATIVE_IDENTITY_HEADER)!.split('.');
    const signature = Buffer.from(encoded, 'base64url');
    signature[0] ^= 1;
    tampered.headers.set(AIRLOCK_TODO_NATIVE_IDENTITY_HEADER, `${payload}.${signature.toString('base64url')}`);
    expect((await POST(tampered)).status).toBe(403);
    expect((await POST(request({ lifetimeMs: -1 }))).status).toBe(403);
    expect((await POST(request({ signedBody: JSON.stringify({ ...input, name: 'Other signed payload' }) }))).status).toBe(403);
    expect(mocks.human).not.toHaveBeenCalled();
    expectNoWrite();
  });

  it('fails closed when the verifier or verified browser identity is unavailable', async () => {
    vi.stubEnv('AIRLOCK_TODO_NATIVE_IDENTITY_PUBLIC_KEY', '');
    expect((await POST(request())).status).toBe(503);
    vi.stubEnv('AIRLOCK_TODO_NATIVE_IDENTITY_PUBLIC_KEY', pair.publicKey.export({ format: 'pem', type: 'spki' }).toString());
    mocks.human.mockRejectedValueOnce(new Error('private authentication diagnostics'));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('private');
    expectNoWrite();
  });

  it('rejects missing, cross-site, noncanonical and forwarded-only origins', async () => {
    for (const requestOrigin of [null, 'null', 'https://other.example.test', origin + '/', origin + '/path']) {
      expect((await POST(request({ origin: requestOrigin }))).status).toBe(403);
    }
    vi.stubEnv('KANBAN_PUBLIC_ORIGIN', '');
    vi.stubEnv('KANBAN_AIRLOCK_RELAY_URL', '');
    const forwarded = request();
    forwarded.headers.set('x-forwarded-host', 'todo.example.test');
    forwarded.headers.set('x-forwarded-proto', 'https');
    expect((await POST(forwarded)).status).toBe(403);
    expectNoWrite();
  });

  it('requires JSON content type and enforces the byte limit independently of Content-Length', async () => {
    for (const contentType of [null, 'text/plain', 'application/jsonp']) {
      expect((await POST(request({ contentType }))).status).toBe(415);
    }
    const oversized = request({ input: { ...input, name: '界'.repeat(3_000) } });
    oversized.headers.set('content-length', '1');
    expect((await POST(oversized)).status).toBe(413);
    expectNoWrite();
  });

  it('validates exactly the existing project schema and rejects additional grants or fields', async () => {
    const invalid = [
      null, [], {}, { name: 'Missing key' }, { ...input, externalKey: '' },
      { ...input, name: ' padded ' }, { ...input, name: 'Bad\nname' },
      { ...input, externalKey: 'x'.repeat(513) }, { ...input, name: 'x'.repeat(257) },
      { ...input, scope: 'personal' }, { ...input, teams: ['synthetic-team'] },
      { ...input, owner: 'nikita' }, { ...input, exmanagerScope: { payload: 'fake', signature: 'fake' } },
    ];
    for (const value of invalid) expect((await POST(request({ input: value }))).status).toBe(400);
    expect((await POST(request({ rawBody: '{invalid' }))).status).toBe(400);
    expectNoWrite();
  });
});
