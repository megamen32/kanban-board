import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, test } from 'vitest';
import { linkTaskToCatalog, type CatalogLinkOwnerContext, type CatalogLinkOwnerReader, type CatalogTaskLinkRequest } from './catalog-link';
import { createCard, findCardById, readCardFile, updateCard } from './file-store';

const roots: string[] = [];
function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-catalog-link-'));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const sourceRef = '2f56316e-c4bd-4d83-b143-d02a1f9b8852';
  const request: CatalogTaskLinkRequest = {
    taskId: '073cae06-840b-44b2-8cca-32d94cfa8211',
    expectedBoardVersion: 4,
    sourceRef,
    sourceRevision: 'source-revision-19',
    projectId: 'P42',
    planIds: ['PLAN-7'],
    gateIds: ['GATE-3'],
    contactIds: ['CONTACT-9'],
    catalogRevision: 'catalog-revision-81',
    operationRef: 'b13-operation-1',
  };
  const context: CatalogLinkOwnerContext = {
    task: { id: request.taskId, version: request.expectedBoardVersion, projectId: request.projectId },
    source: { ref: sourceRef, revision: request.sourceRevision, state: 'DECIDED', projectId: request.projectId },
    catalog: {
      revision: request.catalogRevision,
      project: { id: request.projectId, originRefs: [sourceRef] },
      plans: [{ id: 'PLAN-7', projectId: request.projectId, originRefs: [sourceRef] }],
      gates: [{ id: 'GATE-3', projectId: request.projectId, originRefs: [sourceRef] }],
      contacts: [{ id: 'CONTACT-9', projectId: request.projectId, originRefs: [sourceRef] }],
    },
  };
  let tail = Promise.resolve();
  let revoked = false;
  let beforeCommit: (() => Promise<void>) | undefined;
  let ownerTaskVersion: (() => number) | undefined;
  const owner: CatalogLinkOwnerReader = {
    async withLinkCommitGuard(request, commit) {
      let release!: () => void;
      const prior = tail;
      tail = new Promise<void>(resolve => { release = resolve; });
      await prior;
      try {
        if (revoked) throw new Error('current source/project authorization denied');
        await beforeCommit?.();
        const current = { ...context, task: { ...context.task, version: ownerTaskVersion?.() ?? context.task.version } };
        const link = await commit(current);
        return { operationRef: request.operationRef, link };
      } finally { release(); }
    },
  };
  const mutateOwner = async (mutation: () => void) => {
    let release!: () => void;
    const prior = tail;
    tail = new Promise<void>(resolve => { release = resolve; });
    await prior;
    try { mutation(); } finally { release(); }
  };
  return {
    request, context, owner,
    revoke: () => mutateOwner(() => { revoked = true; }),
    setBeforeCommit: (fn?: () => Promise<void>) => { beforeCommit = fn; },
    setOwnerTaskVersion: (read: () => number) => { ownerTaskVersion = read; },
  };
}

describe('canonical task catalog link storage', () => {
  test('persists exact IDs once and reuses the immutable link on retry', async () => {
    const root = makeRoot();
    const card = createCard('Canonical link', 'body', 'todo', 'medium', [], 'alpha', [], root);
    const f = fixture();
    f.request.taskId = card.id;
    f.request.expectedBoardVersion = card.version;
    f.context.task.id = card.id;
    f.context.task.version = card.version;
    f.setOwnerTaskVersion(() => findCardById(card.id, root)!.version);

    const first = await linkTaskToCatalog(f.request, { owner: f.owner, tasksDir: root });
    const retry = await linkTaskToCatalog(f.request, { owner: f.owner, tasksDir: root });
    expect(first.status).toBe('created');
    expect(retry.status).toBe('reused');
    expect(retry.link).toEqual(first.link);
    expect(retry.link).toMatchObject({ projectId: 'P42', planIds: ['PLAN-7'], gateIds: ['GATE-3'], contactIds: ['CONTACT-9'], sourceRef: f.request.sourceRef, sourceRevision: f.request.sourceRevision, catalogRevision: f.request.catalogRevision, operationRef: f.request.operationRef, boardVersion: card.version });
    expect(findCardById(card.id, root)?.version).toBe(card.version + 1);
  });

  test('reopens current Markdown for exact retry after its own version increment; later edits make replay stale', async () => {
    const root = makeRoot();
    const card = createCard('Replay version', 'body', 'todo', 'medium', [], 'alpha', [], root);
    const f = fixture();
    f.request.taskId = card.id;
    f.request.expectedBoardVersion = card.version;
    f.context.task.id = card.id;
    f.context.task.version = card.version;
    f.setOwnerTaskVersion(() => findCardById(card.id, root)!.version);

    const first = await linkTaskToCatalog(f.request, { owner: f.owner, tasksDir: root });
    const reopened = readCardFile(path.join(root, card.fileName), root)!;
    expect(reopened.version).toBe(card.version + 1);
    expect(reopened.catalogLink).toEqual(first.link);
    const retry = await linkTaskToCatalog(f.request, { owner: f.owner, tasksDir: root });
    expect(retry.status).toBe('reused');
    expect(retry.link).toEqual(first.link);
    expect(findCardById(card.id, root)?.version).toBe(card.version + 1);

    const differentOperation = { ...f.request, operationRef: 'different-operation' };
    await expect(linkTaskToCatalog(differentOperation, { owner: f.owner, tasksDir: root })).rejects.toThrow(/conflict/i);
    const edited = updateCard(card.id, { title: 'Unrelated later edit' }, card.version + 1, root);
    expect('conflict' in edited).toBe(false);
    await expect(linkTaskToCatalog(f.request, { owner: f.owner, tasksDir: root })).rejects.toThrow(/stale/i);
    expect(findCardById(card.id, root)?.catalogLink).toEqual(first.link);
    expect(findCardById(card.id, root)?.version).toBe(card.version + 2);
  });

  test.each([
    ['missing authority', (f: ReturnType<typeof fixture>) => { f.owner = undefined as never; }],
    ['bool-only legacy owner adapter', (f: ReturnType<typeof fixture>) => {
      f.owner = { async readCurrentForWrite() { return { ...f.context, authorized: true }; }, async verifyCurrentForReadback() { return { ...f.context, authorized: true }; } } as unknown as CatalogLinkOwnerReader;
    }],
    ['stale board version', (f: ReturnType<typeof fixture>) => { f.context.task.version++; }],
    ['stale catalog revision', (f: ReturnType<typeof fixture>) => { f.context.catalog.revision = 'older'; }],
    ['project mismatch', (f: ReturnType<typeof fixture>) => { f.context.catalog.project.id = 'P43'; }],
    ['missing ID', (f: ReturnType<typeof fixture>) => { f.context.catalog.plans = []; }],
    ['ambiguous ID', (f: ReturnType<typeof fixture>) => { f.context.catalog.contacts.push({ ...f.context.catalog.contacts[0] }); }],
    ['wrong origin', (f: ReturnType<typeof fixture>) => { f.context.catalog.gates[0].originRefs = ['other-source']; }],
    ['wrong parent project', (f: ReturnType<typeof fixture>) => { f.context.catalog.plans[0].projectId = 'P44'; }],
  ])('%s denies without changing Markdown', async (_name, alter) => {
    const root = makeRoot();
    const card = createCard('Denied link', 'body', 'todo', 'medium', [], 'alpha', [], root);
    const f = fixture();
    f.request.taskId = card.id;
    f.request.expectedBoardVersion = card.version;
    f.context.task.id = card.id;
    f.context.task.version = card.version;
    alter(f);
    await expect(linkTaskToCatalog(f.request, { owner: f.owner, tasksDir: root })).rejects.toThrow();
    expect(findCardById(card.id, root)?.version).toBe(card.version);
    expect(findCardById(card.id, root)?.catalogLink).toBeUndefined();
  });

  test('stale CAS and a different immutable link are no-write conflicts', async () => {
    const root = makeRoot();
    const card = createCard('CAS', 'body', 'todo', 'medium', [], 'alpha', [], root);
    const f = fixture();
    f.request.taskId = card.id;
    f.request.expectedBoardVersion = card.version;
    f.context.task.id = card.id;
    f.context.task.version = card.version;
    await linkTaskToCatalog(f.request, { owner: f.owner, tasksDir: root });

    const stale = { ...f.request, operationRef: 'b13-operation-stale' };
    await expect(linkTaskToCatalog(stale, { owner: f.owner, tasksDir: root })).rejects.toThrow(/conflict|stale/i);
    const changed = { ...f.request, gateIds: ['GATE-OTHER'] };
    await expect(linkTaskToCatalog(changed, { owner: f.owner, tasksDir: root })).rejects.toThrow();
    expect(findCardById(card.id, root)?.version).toBe(card.version + 1);
    expect(findCardById(card.id, root)?.catalogLink?.gateIds).toEqual(['GATE-3']);
  });

  test('revocation before guarded commit denies without a Markdown write', async () => {
    const root = makeRoot();
    const card = createCard('Revoked before commit', 'body', 'todo', 'medium', [], 'alpha', [], root);
    const f = fixture();
    f.request.taskId = card.id;
    f.request.expectedBoardVersion = card.version;
    f.context.task.id = card.id;
    f.context.task.version = card.version;
    f.revoke();
    await expect(linkTaskToCatalog(f.request, { owner: f.owner, tasksDir: root })).rejects.toThrow(/denied/);
    expect(findCardById(card.id, root)?.version).toBe(card.version);
    expect(findCardById(card.id, root)?.catalogLink).toBeUndefined();
  });

  test('a concurrent revoke waits for guarded Markdown CAS and blocks subsequent operations', async () => {
    const root = makeRoot();
    const card = createCard('Guarded revoke', 'body', 'todo', 'medium', [], 'alpha', [], root);
    const f = fixture();
    f.request.taskId = card.id;
    f.request.expectedBoardVersion = card.version;
    f.context.task.id = card.id;
    f.context.task.version = card.version;
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const paused = new Promise<void>(resolve => { release = resolve; });
    f.setBeforeCommit(async () => { enter(); await paused; });
    const writing = linkTaskToCatalog(f.request, { owner: f.owner, tasksDir: root });
    await entered;
    let revokeFinished = false;
    const revoking = f.revoke().then(() => { revokeFinished = true; });
    await Promise.resolve();
    expect(revokeFinished).toBe(false);
    release();
    const first = await writing;
    await revoking;
    expect(first.status).toBe('created');
    expect(findCardById(card.id, root)?.catalogLink).toEqual(first.link);
    const retry = { ...f.request, operationRef: 'new-operation-after-revoke' };
    await expect(linkTaskToCatalog(retry, { owner: f.owner, tasksDir: root })).rejects.toThrow(/denied/);
    expect(findCardById(card.id, root)?.catalogLink).toEqual(first.link);
    expect(findCardById(card.id, root)?.version).toBe(card.version + 1);
  });

  test('legacy Markdown remains intact and link survives a fresh process read', async () => {
    const root = makeRoot();
    const cardId = '073cae06-840b-44b2-8cca-32d94cfa8211';
    const legacyPath = path.join(root, 'legacy.md');
    fs.writeFileSync(legacyPath, `---\nid: ${cardId}\ntitle: Legacy\ncolumn: todo\npriority: medium\nversion: 9\nproject: alpha\ncustom_field: keep-me\n---\nLegacy body\n`);
    const f = fixture();
    f.request.taskId = cardId;
    f.request.expectedBoardVersion = 9;
    f.context.task.version = 9;
    await linkTaskToCatalog(f.request, { owner: f.owner, tasksDir: root });
    const linked = readCardFile(legacyPath, root)!;
    expect(linked.catalogLink?.projectId).toBe('P42');
    expect(linked.rawFrontmatter).toHaveProperty('custom_field', 'keep-me');
    expect(linked.description).toBe('Legacy body');

    const catalogPath = pathToFileURL(fileURLToPath(new URL('./catalog-link.ts', import.meta.url))).href;
    const storePath = pathToFileURL(fileURLToPath(new URL('./file-store.ts', import.meta.url))).href;
    const payload = JSON.stringify({ request: f.request, context: f.context, root });
    const code = `import { linkTaskToCatalog } from ${JSON.stringify(catalogPath)}; import { findCardById } from ${JSON.stringify(storePath)}; const x=JSON.parse(process.argv.at(-1)); const owner={withLinkCommitGuard:async(q,commit)=>{const current={...x.context,task:{...x.context.task,version:findCardById(q.taskId,x.root).version}}; const link=await commit(current); return {operationRef:q.operationRef,link}}}; const result=await linkTaskToCatalog(x.request,{owner,tasksDir:x.root}); if(result.status!=='reused'||result.link.operationRef!==x.request.operationRef) process.exit(3); console.log(result.status+':'+result.link.operationRef);`;
    const restarted = spawnSync('bun', ['-e', code, payload], { encoding: 'utf8', timeout: 10_000 });
    expect(restarted.status, restarted.stderr).toBe(0);
    expect(restarted.stdout.trim()).toBe(`reused:${f.request.operationRef}`);
  });

  test('concurrent processes create one link and all callers read the same receipt', async () => {
    const root = makeRoot();
    const card = createCard('Concurrent', 'body', 'todo', 'medium', [], 'alpha', [], root);
    const f = fixture();
    f.request.taskId = card.id;
    f.request.expectedBoardVersion = card.version;
    f.context.task.id = card.id;
    f.context.task.version = card.version;
    const catalogModule = pathToFileURL(fileURLToPath(new URL('./catalog-link.ts', import.meta.url))).href;
    const payload = JSON.stringify({ request: f.request, context: f.context, root });
    const childCode = `import { linkTaskToCatalog } from ${JSON.stringify(catalogModule)}; import { findCardById } from ${JSON.stringify(pathToFileURL(fileURLToPath(new URL('./file-store.ts', import.meta.url))).href)}; const x=JSON.parse(process.argv.at(-1)); const owner={withLinkCommitGuard:async(q,commit)=>{const current={...x.context,task:{...x.context.task,version:findCardById(q.taskId,x.root).version}}; return {operationRef:q.operationRef,link:await commit(current)}}}; const r=await linkTaskToCatalog(x.request,{owner,tasksDir:x.root}); console.log(r.status+':'+r.link.operationRef);`;
    const runChild = () => new Promise<{ code: number | null; stdout: string; stderr: string }>(resolve => {
      const child = spawn('bun', ['-e', childCode, payload], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
      child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
      child.on('close', code => resolve({ code, stdout, stderr }));
    });
    const results = await Promise.all([runChild(), runChild(), runChild(), runChild()]);
    expect(results.map(x => x.code), results.map(x => x.stderr).join('\n')).toEqual([0, 0, 0, 0]);
    expect(results.map(x => x.stdout.trim().split(':')[0]).sort()).toEqual(['created', 'reused', 'reused', 'reused']);
    expect(results.map(x => x.stdout.trim().split(':')[1])).toEqual(Array(4).fill(f.request.operationRef));
    expect(findCardById(card.id, root)?.version).toBe(card.version + 1);
  });
});
