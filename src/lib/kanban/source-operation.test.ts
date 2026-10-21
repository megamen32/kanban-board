import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAdmittedCard, deleteCard, findCardById, getAllCards, moveCard, updateCard } from './file-store';
import { admitSourceTask, listPendingSourceIntents } from './source-operation';
import type { SourceAdmissionRequest } from './source-operation';

const roots: string[] = [];
function fixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-source-operation-'));
  roots.push(dir);
  return dir;
}

function request(overrides: Partial<SourceAdmissionRequest> = {}): SourceAdmissionRequest {
  return {
    tenant: 'fixture-tenant', sourceOwner: 'fixture-owner', sourceEvent: 'event-17', primaryItem: 'primary',
    sourceRevision: 'rev-1', project: 'alpha', title: 'Check supplier quote', description: 'Compare two lines',
    priority: 'medium', assignees: [], classification: 'explicit-task', evidenceRefs: ['fixture:event-17:span-1'],
    ...overrides,
  };
}

function classifiedRequest(classification: string): SourceAdmissionRequest {
  return request({ classification } as unknown as Partial<SourceAdmissionRequest>);
}

function admit(dir: string, input = request(), hooks = {}) {
  return admitSourceTask(input, dir, id => findCardById(id, dir), card => createAdmittedCard(card, dir), hooks);
}

function runChild(dir: string, input: SourceAdmissionRequest): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const sourceOp = path.resolve('src/lib/kanban/source-operation.ts');
  const fileStore = path.resolve('src/lib/kanban/file-store.ts');
  const script = `import { admitSourceTask } from ${JSON.stringify(`file://${sourceOp}`)}; import { createAdmittedCard, findCardById } from ${JSON.stringify(`file://${fileStore}`)}; const dir=process.env.FIXTURE_DIR; const input=JSON.parse(process.env.REQUEST_JSON); const result=admitSourceTask(input,dir,id=>findCardById(id,dir),card=>createAdmittedCard(card,dir)); console.log(JSON.stringify(result));`;
  return new Promise(resolve => {
    const child = spawn(bunExecutable(), ['-e', script], {
      env: { ...process.env, FIXTURE_DIR: dir, REQUEST_JSON: JSON.stringify(input) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.on('close', status => resolve({ status, stdout, stderr }));
  });
}

function runLockChild(dir: string, scriptBody: string, marker?: string): ReturnType<typeof spawn> {
  const modulePath = path.resolve('src/lib/kanban/source-operation.ts');
  const script = `import fs from 'node:fs'; import { withSourceOperationLock } from ${JSON.stringify(`file://${modulePath}`)}; const dir=process.env.FIXTURE_DIR; ${scriptBody}`;
  return spawn(bunExecutable(), ['-e', script], {
    env: { ...process.env, FIXTURE_DIR: dir, ...(marker ? { MARKER_PATH: marker } : {}) },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}

function runCrashChild(dir: string, input: SourceAdmissionRequest, stage: 'afterReserve' | 'beforePublish' | 'afterPublish' | 'afterCommit') {
  const sourceOp = path.resolve('src/lib/kanban/source-operation.ts');
  const fileStore = path.resolve('src/lib/kanban/file-store.ts');
  const marker = path.join(dir, `crash-${stage}.ready`);
  const script = `import fs from 'node:fs'; import { admitSourceTask } from ${JSON.stringify(`file://${sourceOp}`)}; import { createAdmittedCard, findCardById } from ${JSON.stringify(`file://${fileStore}`)}; const dir=process.env.FIXTURE_DIR; const input=JSON.parse(process.env.REQUEST_JSON); const stop=()=>{fs.writeFileSync(process.env.MARKER_PATH,'durable-boundary');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,60000)}; const hooks={[process.env.CRASH_STAGE]:stop}; const result=admitSourceTask(input,dir,id=>findCardById(id,dir),card=>createAdmittedCard(card,dir),hooks); console.log(JSON.stringify(result));`;
  const child = spawn(bunExecutable(), ['-e', script], {
    env: { ...process.env, FIXTURE_DIR: dir, REQUEST_JSON: JSON.stringify(input), MARKER_PATH: marker, CRASH_STAGE: stage },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { child, marker };
}

async function killAtBoundary(dir: string, input: SourceAdmissionRequest, stage: 'afterReserve' | 'beforePublish' | 'afterPublish' | 'afterCommit'): Promise<void> {
  const { child, marker } = runCrashChild(dir, input, stage);
  try {
    await waitForFile(marker);
    const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    expect(child.kill('SIGKILL')).toBe(true);
    expect(await closed).toEqual({ code: null, signal: 'SIGKILL' });
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    throw error;
  }
}

function bunExecutable(): string {
  if (process.env.BUN_BINARY) return process.env.BUN_BINARY;
  const candidates = [...(process.env.PATH ?? '').split(path.delimiter), path.join(process.env.HOME ?? '', 'bin')]
    .filter(Boolean).map(dir => path.join(dir, 'bun'));
  return candidates.find(candidate => {
    try { fs.accessSync(candidate, fs.constants.X_OK); return true; } catch { return false; }
  }) ?? 'bun';
}

function waitForFile(file: string, timeoutMs = 5_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (fs.existsSync(file)) { clearInterval(timer); resolve(); }
      else if (Date.now() - started > timeoutMs) { clearInterval(timer); reject(new Error(`timed out waiting for ${path.basename(file)}`)); }
    }, 10);
  });
}

afterEach(() => {
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('board source admission journal', () => {
  it('serializes independent OS processes and returns one stable card and intent', async () => {
    const dir = fixture();
    const [a, b] = await Promise.all([runChild(dir, request()), runChild(dir, request())]);
    expect([a.status, b.status]).toEqual([0, 0]);
    const results = [JSON.parse(a.stdout), JSON.parse(b.stdout)];
    expect(results.map(result => result.status).sort()).toEqual(['committed', 'replayed']);
    expect(new Set(results.map(result => result.cardId)).size).toBe(1);
    expect(new Set(results.map(result => result.intentId)).size).toBe(1);
    expect(getAllCards(dir)).toHaveLength(1);
  });

  it('rejects cross-process contenders that reuse a source identity with different frozen payloads', async () => {
    const dir = fixture();
    const [a, b] = await Promise.all([
      runChild(dir, request()),
      runChild(dir, request({ project: 'beta', sourceRevision: 'rev-2' })),
    ]);
    expect([a.status, b.status]).toEqual([0, 0]);
    const results = [JSON.parse(a.stdout), JSON.parse(b.stdout)];
    expect(results.map(result => result.status).sort()).toEqual(['committed', 'conflict']);
    expect(new Set(results.map(result => result.cardId)).size).toBe(1);
    expect(getAllCards(dir)).toHaveLength(1);
  });

  it('lets the kernel release a dead owner before independent processes contend', async () => {
    const dir = fixture();
    const marker = path.join(dir, 'holder-entered');
    const holder = runLockChild(dir, `withSourceOperationLock(dir, () => { fs.writeFileSync(process.env.MARKER_PATH, 'entered'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000); });`, marker);
    await waitForFile(marker);
    holder.kill('SIGKILL');
    await new Promise<void>(resolve => holder.once('close', () => resolve()));
    const events = path.join(dir, 'contenders.jsonl');
    const contender = (id: string) => runLockChild(dir, `withSourceOperationLock(dir, () => { fs.appendFileSync(${JSON.stringify(events)}, ${JSON.stringify(`${id}\n`)}); });`);
    const a = contender('a'), b = contender('b');
    const statuses = await Promise.all([a, b].map(child => new Promise<number | null>(resolve => child.once('close', code => resolve(code)))));
    expect(statuses).toEqual([0, 0]);
    expect(fs.readFileSync(events, 'utf8').trim().split('\n').sort()).toEqual(['a', 'b']);
  });

  it('recovers a real child SIGKILL after the durable reservation', async () => {
    const dir = fixture();
    await killAtBoundary(dir, request(), 'afterReserve');
    expect(getAllCards(dir)).toHaveLength(0);
    const retry = await runChild(dir, request());
    expect(retry.status).toBe(0);
    expect(JSON.parse(retry.stdout)).toMatchObject({ status: 'committed' });
    expect(getAllCards(dir)).toHaveLength(1);
  });

  it('keeps a real child SIGKILL after attempted publication pending and cardless', async () => {
    const dir = fixture();
    await killAtBoundary(dir, request(), 'beforePublish');
    const retry = await runChild(dir, request());
    expect(retry.status).toBe(0);
    expect(JSON.parse(retry.stdout)).toMatchObject({ status: 'pending', reason: 'publication_outcome_unknown' });
    expect(getAllCards(dir)).toHaveLength(0);
    expect(listPendingSourceIntents(dir, id => findCardById(id, dir))).toEqual([]);
  });

  it('tombstones a child-killed published PREPARED card before deletion and replay', async () => {
    const dir = fixture();
    await killAtBoundary(dir, request(), 'afterPublish');
    const card = getAllCards(dir)[0]!;
    expect(card).toBeTruthy();
    expect(deleteCard(card.id, dir)).toBe(true);
    const replay = await runChild(dir, request());
    expect(replay.status).toBe(0);
    expect(JSON.parse(replay.stdout)).toMatchObject({ status: 'cancelled', cardId: card.id });
    expect(findCardById(card.id, dir)).toBeNull();
    expect(getAllCards(dir)).toHaveLength(0);
    expect(listPendingSourceIntents(dir, id => findCardById(id, dir))).toEqual([]);
  });

  it('recovers child SIGKILL after COMMITTED as response loss, then preserves deletion tombstone', async () => {
    const dir = fixture();
    await killAtBoundary(dir, request(), 'afterCommit');
    const first = await runChild(dir, request());
    expect(first.status).toBe(0);
    const replay = JSON.parse(first.stdout);
    expect(replay.status).toBe('replayed');
    const card = findCardById(replay.cardId, dir)!;
    expect(card).toBeTruthy();
    expect(listPendingSourceIntents(dir, id => findCardById(id, dir))).toHaveLength(1);
    expect(deleteCard(card.id, dir)).toBe(true);
    const afterDelete = await runChild(dir, request());
    expect(afterDelete.status).toBe(0);
    expect(JSON.parse(afterDelete.stdout)).toMatchObject({ status: 'cancelled', cardId: card.id, intentId: replay.intentId });
    expect(getAllCards(dir)).toHaveLength(0);
    expect(listPendingSourceIntents(dir, id => findCardById(id, dir))).toEqual([]);
  });

  it('conflicts on a changed frozen payload, including project or source revision', () => {
    const dir = fixture();
    const first = admit(dir);
    expect(admit(dir, request({ project: 'beta' }))).toMatchObject({ status: 'conflict', reason: 'same_identity_different_request' });
    expect(admit(dir, request({ sourceRevision: 'rev-2' }))).toMatchObject({ status: 'conflict', reason: 'same_identity_different_request' });
    expect(admit(dir).cardId).toBe(first.cardId);
    expect(getAllCards(dir)).toHaveLength(1);
    expect(listPendingSourceIntents(dir, id => findCardById(id, dir))).toEqual([expect.objectContaining({
      cardId: first.cardId, intentId: first.intentId, requestHash: first.requestHash,
    })]);
    const journal = fs.readFileSync(path.join(dir, '.source-operations', 'source-operations.json'), 'utf8');
    expect(journal).not.toContain('Check supplier quote');
    expect(journal).not.toContain('Compare two lines');
    expect(journal).not.toContain('fixture-owner');
    const stored = Object.values(JSON.parse(journal).operations)[0] as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(['cardId', 'intentId', 'intentState', 'operationKey', 'provenanceHash', 'publication', 'requestHash', 'state', 'updatedAt'].sort());
  });

  it('rejects any item mode other than the fixed primary item', () => {
    const dir = fixture();
    expect(() => admit(dir, request({ primaryItem: 'item-2' } as never))).toThrow('only the fixed primary source item is supported');
    expect(getAllCards(dir)).toHaveLength(0);
  });

  it('rejects caller-shaped or incomplete source decisions before reserving anything', () => {
    const dir = fixture();
    expect(() => admit(dir, request({ classification: 'maybe-task' } as never))).toThrow('invalid source admission classification');
    expect(() => admit(dir, request({ evidenceRefs: [] }))).toThrow('canonical source evidence is required');
    expect(() => admit(dir, { ...request(), sourceIdentity: 'model-authored' } as SourceAdmissionRequest & { sourceIdentity: string })).toThrow('unknown source admission field');
    expect(fs.existsSync(path.join(dir, '.source-operations', 'source-operations.json'))).toBe(false);
    expect(getAllCards(dir)).toHaveLength(0);
  });

  it('persists an idea in the backlog with the same source identity and no launch intent', () => {
    const dir = fixture();
    const idea = classifiedRequest('idea');
    const [a, b] = [runChild(dir, idea), runChild(dir, classifiedRequest('idea'))];
    return Promise.all([a, b]).then(results => {
      expect(results.map(result => result.status)).toEqual([0, 0]);
      const outcomes = results.map(result => JSON.parse(result.stdout));
      expect(outcomes.map(result => result.status).sort()).toEqual(['committed', 'replayed']);
      expect(outcomes.every(result => result.classification === 'idea' && !('intentId' in result))).toBe(true);
      expect(new Set(outcomes.map(result => result.cardId)).size).toBe(1);
      const card = findCardById(outcomes[0].cardId, dir)!;
      expect(card).toMatchObject({ column: 'someday', needsReview: false, sourceAdmission: { classification: 'idea' } });
      expect(listPendingSourceIntents(dir, id => findCardById(id, dir))).toEqual([]);
      expect(getAllCards(dir)).toHaveLength(1);
      const journal = fs.readFileSync(path.join(dir, '.source-operations', 'source-operations.json'), 'utf8');
      const record = Object.values(JSON.parse(journal).operations)[0] as Record<string, unknown>;
      expect(record).toMatchObject({ classification: 'idea', intentState: 'NOT_APPLICABLE' });
      expect(record).not.toHaveProperty('intentId');
      expect(journal).not.toContain('Check supplier quote');
    });
  });

  it('persists an ambiguous source in Inbox for review without making it launchable', async () => {
    const dir = fixture();
    const results = await Promise.all([
      runChild(dir, classifiedRequest('ambiguous')),
      runChild(dir, classifiedRequest('ambiguous')),
    ]);
    expect(results.map(result => result.status)).toEqual([0, 0]);
    const outcomes = results.map(result => JSON.parse(result.stdout));
    expect(outcomes.map(result => result.status).sort()).toEqual(['committed', 'replayed']);
    expect(outcomes.every(result => result.classification === 'ambiguous' && !('intentId' in result))).toBe(true);
    expect(new Set(outcomes.map(result => result.cardId)).size).toBe(1);
    expect(findCardById(outcomes[0].cardId, dir)).toMatchObject({
      column: 'inbox', needsReview: true, sourceAdmission: { classification: 'ambiguous' },
    });
    expect(listPendingSourceIntents(dir, id => findCardById(id, dir))).toEqual([]);
    expect(getAllCards(dir)).toHaveLength(1);
    const record = Object.values(JSON.parse(fs.readFileSync(path.join(dir, '.source-operations', 'source-operations.json'), 'utf8')).operations)[0] as Record<string, unknown>;
    expect(record).toMatchObject({ classification: 'ambiguous', intentState: 'NOT_APPLICABLE' });
    expect(record).not.toHaveProperty('intentId');
  });

  it('conflicts if the same source identity is reclassified after its outcome was committed', () => {
    const dir = fixture();
    const first = admit(dir, classifiedRequest('idea'));
    expect(admit(dir, request())).toMatchObject({
      status: 'conflict', reason: 'same_identity_different_request', cardId: first.cardId,
    });
    expect(getAllCards(dir)).toHaveLength(1);
    expect(listPendingSourceIntents(dir, id => findCardById(id, dir))).toEqual([]);
  });

  it('keeps uncertain idea publication query-only across an identical retry', () => {
    const dir = fixture();
    expect(() => admit(dir, classifiedRequest('idea'), {
      beforePublish: () => { throw new Error('simulated lost publication'); },
    })).toThrow('simulated lost publication');
    const retry = admit(dir, classifiedRequest('idea'));
    expect(retry).toMatchObject({ status: 'pending', reason: 'publication_outcome_unknown', classification: 'idea' });
    expect(retry).not.toHaveProperty('intentId');
    expect(getAllCards(dir)).toHaveLength(0);
    expect(listPendingSourceIntents(dir, id => findCardById(id, dir))).toEqual([]);
  });

  it.each([
    ['idea', 'inbox'],
    ['ambiguous', 'review'],
  ] as const)('allows normal %s movement, edit, replay, and deletion without creating a launch', (classification, nextColumn) => {
    const dir = fixture();
    const admitted = admit(dir, classifiedRequest(classification));
    const original = findCardById(admitted.cardId, dir)!;
    const updated = updateCard(original.id, { column: nextColumn, title: 'Human refined outcome', needsReview: false }, original.version, dir);
    if ('conflict' in updated) throw new Error('unexpected fixture version conflict');
    expect(updated).toMatchObject({ column: nextColumn, title: 'Human refined outcome', sourceAdmission: original.sourceAdmission });

    const replay = admit(dir, classifiedRequest(classification));
    expect(replay).toMatchObject({ status: 'replayed', classification, cardId: original.id });
    expect(replay).not.toHaveProperty('intentId');
    expect(findCardById(original.id, dir)?.title).toBe('Human refined outcome');
    expect(listPendingSourceIntents(dir, id => findCardById(id, dir))).toEqual([]);

    expect(deleteCard(original.id, dir)).toBe(true);
    expect(admit(dir, classifiedRequest(classification))).toMatchObject({
      status: 'cancelled', classification, cardId: original.id,
    });
    expect(getAllCards(dir)).toHaveLength(0);
    expect(listPendingSourceIntents(dir, id => findCardById(id, dir))).toEqual([]);
    const operations = Object.values(JSON.parse(fs.readFileSync(path.join(dir, '.source-operations', 'source-operations.json'), 'utf8')).operations) as Array<Record<string, unknown>>;
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ classification, state: 'CANCELLED', intentState: 'NOT_APPLICABLE' });
    expect(operations[0]).not.toHaveProperty('intentId');
  });

  it('cancels a published PREPARED card before ordinary deletion and replay', () => {
    const dir = fixture();
    expect(() => admit(dir, request(), { afterPublish: () => { throw new Error('simulated process loss'); } })).toThrow('simulated process loss');
    const card = getAllCards(dir)[0]!;
    expect(card.sourceAdmission).toMatchObject({
      tenantId: 'fixture-tenant', sourceOwnerId: 'fixture-owner', sourceEventId: 'event-17', primaryItem: 'primary',
      sourceRevision: 'rev-1', requestedProject: 'alpha', classification: 'explicit-task', evidenceRefs: ['fixture:event-17:span-1'],
    });
    expect(card.description).not.toContain('fixture:event-17:span-1');
    expect(deleteCard(card.id, dir)).toBe(true);
    expect(admit(dir)).toMatchObject({ status: 'cancelled', cardId: card.id });
    expect(listPendingSourceIntents(dir, id => findCardById(id, dir))).toEqual([]);
    expect(findCardById(card.id, dir)).toBeNull();
    expect(getAllCards(dir)).toHaveLength(0);
  });

  it('recovers a published card and preserves its binding across normal edits and archive', () => {
    const dir = fixture();
    expect(() => admit(dir, request(), { afterPublish: () => { throw new Error('simulated response loss'); } })).toThrow('simulated response loss');
    const card = getAllCards(dir)[0]!;
    expect(admit(dir)).toMatchObject({ status: 'replayed', cardId: card.id });
    const moved = moveCard(card.id, 'archived', undefined, dir);
    expect(moved).toMatchObject({ sourceAdmission: card.sourceAdmission });
    expect(findCardById(card.id, dir)?.sourceAdmission).toEqual(card.sourceAdmission);
    const updated = updateCard(card.id, { title: 'Renamed task' }, undefined, dir);
    if ('conflict' in updated) throw new Error('unexpected fixture version conflict');
    expect(updated).toMatchObject({ sourceAdmission: card.sourceAdmission });
    expect(updated.fileName).toBe(card.fileName);
    expect(() => updateCard(card.id, { sourceAdmission: { operationKey: 'forged', requestHash: 'forged', intentId: 'forged' } } as never, undefined, dir)).toThrow('source admission binding is immutable');
    expect(admit(dir)).toMatchObject({ status: 'replayed', cardId: card.id });
  });

  it('retries safely when durable state proves publication never started', () => {
    const dir = fixture();
    expect(() => admit(dir, request(), { afterReserve: () => { throw new Error('simulated pre-publication crash'); } })).toThrow('simulated pre-publication crash');
    expect(admit(dir)).toMatchObject({ status: 'committed' });
    expect(getAllCards(dir)).toHaveLength(1);
  });

  it('leaves an uncertain missing PREPARED publication pending after identical retry', () => {
    const dir = fixture();
    expect(() => admit(dir, request(), { beforePublish: () => { throw new Error('simulated crash before rename'); } })).toThrow('simulated crash before rename');
    expect(getAllCards(dir)).toHaveLength(0);
    expect(admit(dir)).toMatchObject({ status: 'pending', reason: 'publication_outcome_unknown' });
    expect(getAllCards(dir)).toHaveLength(0);
  });

  it('keeps a committed reservation tombstoned if its card is removed outside the board API', () => {
    const dir = fixture();
    const result = admit(dir);
    const card = findCardById(result.cardId, dir)!;
    fs.unlinkSync(path.join(dir, card.fileName));
    expect(admit(dir)).toMatchObject({ status: 'pending', reason: 'committed_card_missing', cardId: card.id });
    expect(getAllCards(dir)).toHaveLength(0);
  });
});
