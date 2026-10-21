import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-store-'));
process.env.TASKS_DIR = root;
const store = await import('./file-store');
afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
  delete process.env.TASKS_DIR;
});

describe('filesystem kanban contract', () => {
  test('long Cyrillic titles keep complete content and bounded UTF-8 filenames on create and rename', () => {
    const title = 'Русская задача с подробным заголовком '.repeat(6);
    const created = store.createCard(title, 'Details', 'todo', 'medium', [], 'alpha', ['alice']);
    expect(Buffer.byteLength(created.fileName, 'utf8')).toBeLessThanOrEqual(255 - Buffer.byteLength(`.${Number.MAX_SAFE_INTEGER}.${'0'.repeat(36)}.tmp`, 'utf8'));
    expect(store.readCardFile(path.join(root, created.fileName))?.title).toBe(title);
    const history = [{ summary: 'Результат исполнителя', evidenceRefs: ['source:event:1'],
      submittedBy: 'fixture', submittedAt: '2026-10-20T12:00:00Z' }];
    const reviewHistory = [{ decision: 'rework' as const, actor: 'nikita',
      decidedAt: '2026-10-20T12:30:00Z', note: 'Уточнить итог' }];
    const annotated = store.updateCard(created.id, { resultHistory: history, reviewHistory }, created.version);
    if (!annotated || 'conflict' in annotated) throw new Error('history update failed');
    const renamed = title + ' обновлено';
    const updated = store.updateCard(created.id, { title: renamed }, annotated.version);
    if (!updated || 'conflict' in updated) throw new Error('rename failed');
    expect(updated.id).toBe(created.id);
    expect(updated.title).toBe(renamed);
    expect(updated.resultHistory).toEqual(history);
    expect(updated.reviewHistory).toEqual(reviewHistory);
    expect(Buffer.byteLength(updated.fileName, 'utf8')).toBeLessThanOrEqual(255 - Buffer.byteLength(`.${Number.MAX_SAFE_INTEGER}.${'0'.repeat(36)}.tmp`, 'utf8'));
    expect(store.readCardFile(path.join(root, updated.fileName))?.title).toBe(renamed);
    expect(store.readCardFile(path.join(root, updated.fileName))?.id).toBe(created.id);
  });

  test('same long title keeps distinct UUID filename collision keys', () => {
    const title = 'Повторяющийся длинный заголовок '.repeat(8);
    const first = store.createCard(title, 'First body', 'todo', 'medium', [], 'alpha', ['alice']);
    const second = store.createCard(title, 'Second body', 'todo', 'medium', [], 'alpha', ['alice']);
    expect(first.id).not.toBe(second.id);
    expect(first.fileName).not.toBe(second.fileName);
    expect(store.readCardFile(path.join(root, first.fileName))?.description).toBe('First body');
    expect(store.readCardFile(path.join(root, second.fileName))?.description).toBe('Second body');
  });
  test('scans markdown recursively and preserves nested relative files', async () => {
    fs.mkdirSync(path.join(root, 'projects', 'alpha'), { recursive: true });
    fs.writeFileSync(path.join(root, 'projects', 'alpha', 'nested.md'), `---\nid: nested-id\ntitle: Nested\nproject: alpha\n---\nBody`);

    const [card] = store.getAllCards();
    expect(card.id).toBe('nested-id');
    expect(card.fileName).toBe(path.join('projects', 'alpha', 'nested.md'));
  });

  test('does not ingest hidden repository or vault directories', async () => {
    for (const hidden of ['.git', '.obsidian', 'nested/.git']) {
      const directory = path.join(root, hidden);
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, 'hidden.md'), '---\nid: hidden\ntitle: Hidden\n---\nDo not ingest');
    }

    expect(store.getAllCards().some(card => card.id === 'hidden')).toBe(false);
  });

  test('round-trips required project and assignees', async () => {
    const created = store.createCard('Project task', 'Details', 'todo', 'high', ['tag'], 'alpha', ['alice', 'bob']);
    const loaded = store.readCardFile(path.join(store.getTasksDir(), created.fileName));
    expect(loaded?.project).toBe('alpha');
    expect(loaded?.assignees).toEqual(['alice', 'bob']);
  });

  test('persists exact execution intent and native receipt in existing Markdown with version CAS', () => {
    const created = store.createCard('Durable execution', 'Research brief', 'todo', 'medium', [], 'alpha');
    const intent = {
      operationId: 'a'.repeat(64), requestHash: 'b'.repeat(64), lastBoardVersion: created.version + 1, createInputId: 'c'.repeat(64), messageInputId: 'd'.repeat(64),
      phase: 'intent' as const, hostId: 'roomhacker-server-100', harness: 'codex' as const,
      startedBy: 'nikita', createdAt: '2026-10-20T12:00:00.000Z', updatedAt: '2026-10-20T12:00:00.000Z',
    };
    const savedIntent = store.updateCard(created.id, { taskExecutionHistory: [intent] }, created.version);
    if (!savedIntent || 'conflict' in savedIntent) throw new Error('execution intent update failed');
    expect(store.updateCard(created.id, { taskExecutionHistory: [intent] }, created.version)).toMatchObject({ conflict: true });

    const running = { ...intent, phase: 'running' as const, nativeSessionId: 'native-session-1', nativeTurnId: 'native-turn-1', updatedAt: '2026-10-20T12:01:00.000Z' };
    const savedReceipt = store.updateCard(created.id, { taskExecutionHistory: [running] }, savedIntent.version);
    if (!savedReceipt || 'conflict' in savedReceipt) throw new Error('execution receipt update failed');
    const reopened = store.readCardFile(path.join(root, created.fileName));
    expect(reopened?.taskExecutionHistory).toEqual([running]);
    expect(fs.readFileSync(path.join(root, created.fileName), 'utf8')).toContain('task_execution_history:');
  });

  test('persists and reopens the opaque Notice request reference on its exact execution receipt', () => {
    const created = store.createCard('Question-linked execution', 'Research brief', 'todo', 'medium', [], 'alpha');
    const receipt = {
      operationId: 'e'.repeat(64), requestHash: 'f'.repeat(64), lastBoardVersion: created.version + 1,
      createInputId: '1'.repeat(64), messageInputId: '2'.repeat(64), phase: 'running' as const,
      hostId: 'roomhacker-server-100', harness: 'codex' as const, nativeSessionId: 'native-session-q',
      nativeTurnId: 'native-turn-q', startedBy: 'nikita', createdAt: '2026-10-20T12:00:00.000Z',
      updatedAt: '2026-10-20T12:00:00.000Z',
      taskDecisionRequest: { requestId: `td-${'a'.repeat(40)}`, requestHash: '9'.repeat(64), purpose: 'clarify-scope', version: created.version + 1 },
    };
    const saved = store.updateCard(created.id, { taskExecutionHistory: [receipt] }, created.version);
    if (!saved || 'conflict' in saved) throw new Error('question reference update failed');
    const reopened = store.readCardFile(path.join(root, created.fileName));
    expect(reopened?.taskExecutionHistory?.[0]?.taskDecisionRequest).toEqual(receipt.taskDecisionRequest);
    expect(fs.readFileSync(path.join(root, created.fileName), 'utf8')).toContain('taskDecisionRequest:');
    expect(store.updateCard(created.id, { taskExecutionHistory: [receipt] }, created.version)).toMatchObject({ conflict: true });
  });

  test('round-trips a signed native requester on the parent receipt while leaving legacy receipts optional', () => {
    const created = store.createCard('Native actor receipt', 'Research', 'todo', 'medium', [], 'alpha');
    const receipt = {
      operationId:'7'.repeat(64), requestHash:'8'.repeat(64), lastBoardVersion:created.version + 1,
      createInputId:'9'.repeat(64), messageInputId:'a'.repeat(64), phase:'running' as const,
      hostId:'roomhacker-server-100', harness:'codex' as const, nativeSessionId:'native-session', nativeTurnId:'native-turn',
      startedBy:'native-user-42', requestedBy:'native-user-42', createdAt:'2026-10-20T12:00:00Z', updatedAt:'2026-10-20T12:01:00Z',
    };
    const saved = store.updateCard(created.id, {taskExecutionHistory:[receipt]}, created.version);
    if (!saved || 'conflict' in saved) throw new Error('native actor receipt update failed');
    const reopened = store.readCardFile(path.join(root, created.fileName));
    expect(reopened?.taskExecutionHistory?.[0]).toMatchObject({startedBy:'native-user-42',requestedBy:'native-user-42',nativeTurnId:'native-turn'});
  });

  test('persists the exact scoped project and canonical CWD binding on a new execution receipt', () => {
    const created = store.createCard('Scoped execution', 'Bounded task', 'todo', 'medium', [], 'Demo');
    const binding = {
      contract: 'integrator-host-readiness-v1' as const, projectId: 'Demo',
      projectRoot: '/workspace/exmanager-task-workspace', rootIdentity: 'exmanager-workspace-root-v1',
      policyRevision: 'scope-policy-7', observedAtMs: 1792550000000, runtimeInstanceId: 'runtime-readiness-1',
      hostId: 'roomhacker-server-100', harness: 'codex' as const, harnessVersion: 'codex-1',
      model: 'gpt-6-luna' as const, requiredTools: ['web_search'], availableTools: ['web_search'],
      availableModels: ['gpt-6-luna'], resourceReady: true as const,
      cwd: '/workspace/exmanager-task-workspace',
      pathResolution: { requestedCwd: '/workspace/exmanager-task-workspace', canonicalCwd: '/workspace/exmanager-task-workspace',
        rootPath: '/workspace/exmanager-task-workspace', contained: true as const, identityMatches: true as const },
    };
    const receipt = {
      operationId: 'a'.repeat(64), requestHash: 'b'.repeat(64), lastBoardVersion: created.version + 1,
      createInputId: 'c'.repeat(64), messageInputId: 'd'.repeat(64), phase: 'intent' as const,
      hostId: 'roomhacker-server-100', harness: 'codex' as const, projectBinding: binding,
      startedBy: 'nikita', createdAt: '2026-10-20T12:00:00.000Z', updatedAt: '2026-10-20T12:00:00.000Z',
    };
    const saved = store.updateCard(created.id, { taskExecutionHistory: [receipt] }, created.version);
    if (!saved || 'conflict' in saved) throw new Error('scoped execution receipt save failed');
    expect(store.readCardFile(path.join(root, created.fileName))?.taskExecutionHistory?.[0]?.projectBinding).toEqual(binding);
  });

  test('persists a same-session continuation through Markdown CAS and reopen without changing review decisions', () => {
    const created = store.createCard('Same task follow-up', 'Find two integrators', 'review', 'medium', [], 'alpha');
    const originalResult = [{ summary: 'Original result remains', evidenceRefs: ['https://original.example'],
      submittedBy: 'nikita', submittedAt: '2026-10-20T12:00:00.000Z' }];
    const parent = {
      operationId: 'a'.repeat(64), requestHash: 'b'.repeat(64), lastBoardVersion: created.version + 1,
      createInputId: 'c'.repeat(64), messageInputId: 'd'.repeat(64), phase: 'result' as const,
      hostId: 'roomhacker-server-100', harness: 'codex' as const, nativeSessionId: 'native-session-1',
      nativeTurnId: 'original-turn', startedBy: 'nikita', createdAt: '2026-10-20T12:00:00.000Z',
      updatedAt: '2026-10-20T12:00:00.000Z',
    };
    const reviewReady = store.updateCard(created.id, {
      column: 'review', needsReview: true, resultHistory: originalResult, reviewHistory: [], taskExecutionHistory: [parent],
    }, created.version);
    if (!reviewReady || 'conflict' in reviewReady) throw new Error('initial review receipt save failed');
    const child = {
      id: 'e'.repeat(64), kind: 'task-follow-up-v1' as const, instruction: 'Find two integrators from official public sources; no outreach.', inputId: 'f'.repeat(64),
      requestHash: '1'.repeat(64), requestedBy: 'native-manager-b', phase: 'intent' as const,
      createdAt: '2026-10-20T12:01:00.000Z', updatedAt: '2026-10-20T12:01:00.000Z',
    };
    const intent = { ...parent, lastBoardVersion: reviewReady.version + 1, continuations: [child] };
    const persistedIntent = store.updateCard(created.id, { taskExecutionHistory: [intent] }, reviewReady.version);
    if (!persistedIntent || 'conflict' in persistedIntent) throw new Error('continuation intent CAS failed');
    expect(store.updateCard(created.id, { taskExecutionHistory: [intent] }, reviewReady.version)).toMatchObject({ conflict: true });

    const running = { ...intent, lastBoardVersion: persistedIntent.version + 1, continuations: [{
      ...child, phase: 'running' as const, nativeTurnId: 'child-turn', updatedAt: '2026-10-20T12:02:00.000Z',
    }] };
    const persistedRunning = store.updateCard(created.id, { taskExecutionHistory: [running] }, persistedIntent.version);
    if (!persistedRunning || 'conflict' in persistedRunning) throw new Error('continuation admission CAS failed');
    const finalReceipt = { ...running, lastBoardVersion: persistedRunning.version + 1, continuations: [{
      ...running.continuations[0]!, phase: 'result' as const,
      summary: 'Two researched candidates with source links', evidenceRefs: ['https://one.example', 'https://two.example'],
      updatedAt: '2026-10-20T12:03:00.000Z',
    }] };
    const saved = store.updateCard(created.id, {
      taskExecutionHistory: [finalReceipt],
      resultHistory: [...originalResult, { summary: 'Two researched candidates with source links',
        evidenceRefs: ['https://one.example', 'https://two.example'], runRef: `task-continuation:${child.id}`,
        submittedBy: 'nikita', submittedAt: '2026-10-20T12:03:00.000Z' }],
    }, persistedRunning.version);
    if (!saved || 'conflict' in saved) throw new Error('continuation result append failed');

    const reopened = store.readCardFile(path.join(root, created.fileName));
    expect(reopened).toMatchObject({ column: 'review', needsReview: true,
      resultHistory: [...originalResult, { summary: 'Two researched candidates with source links',
        evidenceRefs: ['https://one.example', 'https://two.example'], runRef: `task-continuation:${child.id}`,
        submittedBy: 'nikita', submittedAt: '2026-10-20T12:03:00.000Z' }], reviewHistory: [] });
    expect(reopened?.taskExecutionHistory?.[0]).toMatchObject({
      operationId: parent.operationId, phase: 'result', nativeTurnId: 'original-turn', lastBoardVersion: saved.version,
      continuations: [{ id: child.id, phase: 'result', requestedBy: 'native-manager-b', nativeTurnId: 'child-turn', summary: 'Two researched candidates with source links' }],
    });
    expect(fs.readFileSync(path.join(root, created.fileName), 'utf8')).toContain('continuations:');
  });

  test('rejects malformed or duplicate execution operation receipts', () => {
    const created = store.createCard('Invalid execution', '', 'todo', 'medium', [], 'alpha');
    const malformed = {
      operationId: 'bad', requestHash: 'b'.repeat(64), lastBoardVersion: 1, createInputId: 'c'.repeat(64), messageInputId: 'd'.repeat(64),
      phase: 'intent' as const, hostId: 'server-100', harness: 'codex' as const,
      startedBy: 'nikita', createdAt: '2026-10-20T12:00:00Z', updatedAt: '2026-10-20T12:00:00Z',
    };
    expect(() => store.updateCard(created.id, { taskExecutionHistory: [malformed] }, created.version)).toThrow('task_execution_history');
  });

  test('rejects clearing the required project on update', async () => {
    const created = store.createCard('Required project', '', 'todo', 'medium', [], 'alpha');
    expect(() => store.updateCard(created.id, { project: '   ' }, created.version)).toThrow('project is required');
  });

  test('uses a safe legacy project fallback without inventing assignees', async () => {
    fs.writeFileSync(path.join(root, 'legacy.md'), `---\nid: legacy-id\ntitle: Legacy\ncolumn: inbox\n---\nLegacy body`);
    const card = store.readCardFile(path.join(root, 'legacy.md'));
    expect(card?.project).toBe('legacy');
    expect(card?.assignees).toEqual([]);
  });

  test('keeps legacy cards visible when their old priority label is no longer supported', async () => {
    fs.writeFileSync(path.join(root, 'legacy-priority.md'), `---\nid: legacy-priority\ntitle: Legacy priority\nproject: personal\npriority: someday\n---\nBody`);
    expect(store.readCardFile(path.join(root, 'legacy-priority.md'))?.priority).toBe('medium');
  });
});
