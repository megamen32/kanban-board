import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterAll, describe, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({ user: null as { username: string; scope: 'work' } | null, root: '' }));
vi.mock('../../../../lib/auth/board-human', () => ({ boardHumanIdentityFromRequest: async () => auth.user }));
vi.mock('../../../../lib/auth/data-scope', () => ({ tasksDirForScope: () => auth.root }));
import { GET, PATCH } from './route';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-layout-route-'));
auth.root = root;
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const url = 'https://board.example.test/api/kanban/graph-layout';
const patch = (body: unknown, origin = 'https://board.example.test') => new NextRequest(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) });

describe('graph layout identity boundary', () => {
  it('requires an authenticated account and saves only that account layout', async () => {
    expect((await GET(new NextRequest(url))).status).toBe(401);
    expect((await PATCH(patch({ expectedVersion: 0, change: { columns: 2 } }))).status).toBe(401);
    auth.user = { username: 'qa-alice', scope: 'work' };
    const saved = await PATCH(patch({ expectedVersion: 0, change: { columns: 4, placement: { direction: 'vertical', values: { 'card-a': { x: 32, y: 320 } } } } }));
    expect(saved.status).toBe(200);
    const read = await GET(new NextRequest(url));
    expect(await read.json()).toMatchObject({ layout: { version: 1, columns: 4, positions: { vertical: { 'card-a': { x: 32, y: 320 } } } } });
    expect(read.headers.get('cache-control')).toContain('no-store');
    auth.user = { username: 'qa-bob', scope: 'work' };
    expect(await (await GET(new NextRequest(url))).json()).toMatchObject({ layout: { version: 0, positions: { vertical: {} } } });
  });
  it('rejects cross-site writes and never accepts a caller-selected username', async () => {
    auth.user = { username: 'qa-alice', scope: 'work' };
    expect((await PATCH(patch({ expectedVersion: 1, change: { columns: 2 } }, 'https://evil.example'))).status).toBe(403);
    expect((await PATCH(patch({ username: 'qa-bob', expectedVersion: 1, change: { columns: 2 } }))).status).toBe(400);
    expect((await PATCH(patch({ expectedVersion: 0, change: { columns: 2 } }))).status).toBe(409);
  });
});
