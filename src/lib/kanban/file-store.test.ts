import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-store-'));
const isolatedDirs: string[] = [];
process.env.TASKS_DIR = root;
const store = await import('./file-store');
afterAll(() => {
  for (const dir of isolatedDirs) fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
  delete process.env.TASKS_DIR;
});

describe('filesystem kanban contract', () => {
  test('persists nested parents atomically and rejects missing, cross-scope, and cyclic relations without overwriting cards', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-parent-relations-'));
    isolatedDirs.push(dir);
    const project = store.createCard('ForEnergo', '', 'todo', 'medium', [], 'ForEnergo', [], dir);
    const direction = store.createCard('Direction', '', 'todo', 'medium', [], 'ForEnergo', [], dir, undefined,
      { parent: project.id });
    const tender = store.createCard('Tender', '', 'todo', 'medium', [], 'ForEnergo', [], dir, undefined,
      { parent: direction.id });
    const pilot = store.createCard('Pilot', 'Original details', 'todo', 'medium', [], 'ForEnergo', [], dir, undefined,
      { parent: tender.id });

    const hierarchy = Object.fromEntries(store.getAllCards(dir).map(card => [card.title, card.parent]));
    expect(hierarchy).toEqual({ ForEnergo: undefined, Direction: project.id, Tender: direction.id, Pilot: tender.id });

    const initialFiles = store.getAllCards(dir).length;
    expect(() => store.createCard('Missing parent', '', 'todo', 'medium', [], 'ForEnergo', [], dir, undefined,
      { parent: 'not-a-card' })).toThrow('parent_relation_missing');
    expect(store.getAllCards(dir)).toHaveLength(initialFiles);

    const otherProject = store.createCard('Other project', '', 'todo', 'medium', [], 'Other', [], dir);
    const otherOwner = store.createCard('Other owner', '', 'todo', 'medium', [], 'ForEnergo', [], dir, undefined,
      { owner: 'oleg' });
    expect(() => store.updateCard(pilot.id, { parent: otherProject.id, description: 'must not persist' }, pilot.version, dir))
      .toThrow('parent_relation_scope_mismatch');
    expect(() => store.updateCard(pilot.id, { parent: otherOwner.id }, pilot.version, dir))
      .toThrow('parent_relation_scope_mismatch');
    expect(() => store.updateCard(pilot.id, { parent: pilot.id }, pilot.version, dir))
      .toThrow('parent_relation_self');
    expect(() => store.updateCard(project.id, { parent: pilot.id }, project.version, dir))
      .toThrow('parent_relation_cycle');
    expect(() => store.updateCard(project.id, { project: 'Moved project' }, project.version, dir))
      .toThrow('parent_relation_scope_mismatch');
    expect(() => store.deleteCard(tender.id, dir)).toThrow('parent_relation_has_children');

    const unchanged = store.findCardById(pilot.id, dir);
    expect(unchanged).toMatchObject({ parent: tender.id, description: 'Original details', version: pilot.version });
    expect(store.updateCard(pilot.id, { parent: otherProject.id }, pilot.version - 1, dir)).toMatchObject({ conflict: true });
    const cleared = store.updateCard(pilot.id, { parent: null as unknown as string }, pilot.version, dir);
    if (!cleared || 'conflict' in cleared) throw new Error('parent clear failed');
    expect(store.findCardById(pilot.id, dir)?.parent).toBeUndefined();
  });

  test('serializes concurrent parent changes so the accepted graph cannot become cyclic', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-parent-concurrency-'));
    isolatedDirs.push(dir);
    const left = store.createCard('Left', '', 'todo', 'medium', [], 'Concurrent project', [], dir);
    const right = store.createCard('Right', '', 'todo', 'medium', [], 'Concurrent project', [], dir);

    const outcomes = await Promise.allSettled([
      Promise.resolve().then(() => store.updateCard(left.id, { parent: right.id }, left.version, dir)),
      Promise.resolve().then(() => store.updateCard(right.id, { parent: left.id }, right.version, dir)),
    ]);

    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(result => result.status === 'rejected')).toHaveLength(1);
    const saved = store.getAllCards(dir);
    const linked = saved.filter(card => card.parent !== undefined);
    expect(linked).toHaveLength(1);
    expect(saved.find(card => card.parent === linked[0]!.id)).toBeUndefined();
  });

  test('persists an explicit clear for an optional next action through the Markdown round trip', () => {
    const created = store.createCard('Clear next action', 'Task body', 'done', 'medium', [], 'UX QA');
    const set = store.updateCard(created.id, { nextAction: 'Old rework prompt' }, created.version);
    if (!set || 'conflict' in set) throw new Error('initial next action update failed');

    const cleared = store.updateCard(created.id, { nextAction: null }, set.version);
    if (!cleared || 'conflict' in cleared) throw new Error('clear next action update failed');
    const reopened = store.readCardFile(path.join(root, cleared.fileName));

    expect(cleared.nextAction).toBeNull();
    expect(reopened?.nextAction).toBeNull();
    expect(fs.readFileSync(path.join(root, cleared.fileName), 'utf8')).toContain('next_action: null');
    expect(store.deleteCard(created.id)).toBe(true);
  });

  test('persists blocker reason separately from the task description', () => {
    const created = store.createCard('Blocked task', 'Task description', 'todo', 'medium', [], 'alpha');
    const saved = store.updateCard(created.id, { column: 'blocked', blockerReason: 'Ждём Excel от партнёра' }, created.version);
    if (!saved || 'conflict' in saved) throw new Error('blocker reason update failed');
    const reopened = store.readCardFile(path.join(root, saved.fileName));
    expect(reopened).toMatchObject({ column: 'blocked', description: 'Task description', blockerReason: 'Ждём Excel от партнёра' });
    expect(fs.readFileSync(path.join(root, saved.fileName), 'utf8')).toContain('blocker_reason: Ждём Excel от партнёра');
    expect(store.deleteCard(created.id)).toBe(true);
  });

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

  test('round-trips a project-bound OpenCode intent without inventing a harness version', () => {
    const created = store.createCard('Scoped OpenCode execution', 'QA-only task', 'todo', 'medium', [], 'alpha');
    const projectRoot = '/tmp/kanban-qa-project';
    const projectBinding = {
      contract: 'integrator-host-readiness-v1' as const,
      projectId: 'alpha', projectRoot, rootIdentity: '["/tmp/kanban-qa-project",1,2]',
      policyRevision: '"qa-revision"', observedAtMs: 1_797_000_000_000,
      runtimeInstanceId: 'qa-runtime', hostId: 'roomhacker-server-100', harness: 'opencode' as const,
      harnessVersion: '', model: 'omniroute/minimax-combo-m3.1', requiredTools: [], availableTools: [],
      availableModels: ['omniroute/minimax-combo-m3.1'], resourceReady: true as const, cwd: projectRoot,
      pathResolution: { requestedCwd: projectRoot, canonicalCwd: projectRoot, rootPath: projectRoot, contained: true as const, identityMatches: true as const },
    };
    const intent = {
      operationId: '1'.repeat(64), requestHash: '2'.repeat(64), lastBoardVersion: created.version + 1,
      createInputId: '3'.repeat(64), messageInputId: '4'.repeat(64), phase: 'intent' as const,
      hostId: 'roomhacker-server-100', harness: 'opencode' as const, projectBinding,
      startedBy: 'testlogin', createdAt: '2026-10-27T20:00:00.000Z', updatedAt: '2026-10-27T20:00:00.000Z',
    };

    const saved = store.updateCard(created.id, { taskExecutionHistory: [intent] }, created.version);
    if (!saved || 'conflict' in saved) throw new Error('OpenCode execution intent update failed');
    const reopened = store.readCardFile(path.join(root, created.fileName));
    expect(reopened?.taskExecutionHistory?.[0]?.projectBinding).toEqual(projectBinding);

    const invalidCodexIntent = {
      ...intent,
      operationId: '5'.repeat(64), harness: 'codex' as const,
      projectBinding: { ...projectBinding, harness: 'codex' as const, harnessVersion: '', model: 'gpt-6-luna',
        requiredTools: ['web_search'], availableTools: ['web_search'], availableModels: ['gpt-6-luna'] },
    };
    expect(() => store.updateCard(created.id, { taskExecutionHistory: [invalidCodexIntent] }, saved.version))
      .toThrow('task_execution_history');
  });

  test('persists the direct/stop no-replay states on the exact execution receipt', () => {
    const created = store.createCard('Controlled execution', 'Research brief', 'todo', 'medium', [], 'alpha');
    const receipt = {
      operationId: 'a'.repeat(64), requestHash: 'b'.repeat(64), lastBoardVersion: created.version + 1,
      createInputId: 'c'.repeat(64), messageInputId: 'd'.repeat(64), phase: 'running' as const,
      hostId: 'roomhacker-server-100', harness: 'opencode' as const, nativeSessionId: 'native-session-1', nativeTurnId: 'native-turn-1',
      startedBy: 'nikita', createdAt: '2026-10-20T12:00:00.000Z', updatedAt: '2026-10-20T12:00:00.000Z',
      sessionControls: {
        direct: [{ requestHash: 'e'.repeat(64), phase: 'unknown' as const, updatedAt: '2026-10-20T12:01:00.000Z' },
          { requestHash: '9'.repeat(64), phase: 'accepted' as const, updatedAt: '2026-10-20T12:02:00.000Z' }],
        stop: { requestHash: 'f'.repeat(64), phase: 'accepted' as const, updatedAt: '2026-10-20T12:02:00.000Z' },
      },
    };
    const saved = store.updateCard(created.id, { taskExecutionHistory: [receipt] }, created.version);
    if (!saved || 'conflict' in saved) throw new Error('session control receipt save failed');
    const reopened = store.readCardFile(path.join(root, saved.fileName));
    expect(reopened?.taskExecutionHistory?.[0]?.sessionControls).toEqual(receipt.sessionControls);
    expect(fs.readFileSync(path.join(root, saved.fileName), 'utf8')).toContain('sessionControls:');

    expect(() => store.updateCard(created.id, { taskExecutionHistory: [{ ...receipt,
      sessionControls: { direct: [{ ...receipt.sessionControls.direct[0]!, phase: 'replay' }] },
    } as unknown as typeof receipt] }, saved.version)).toThrow('task_execution_history');
    expect(() => store.updateCard(created.id, { taskExecutionHistory: [{ ...receipt,
      sessionControls: { direct: [receipt.sessionControls.direct[0]!, receipt.sessionControls.direct[0]!] },
    }] }, saved.version)).toThrow('task_execution_history');
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

  test('round-trips a typed Herder registry question reference without inventing native registration IDs', () => {
    const created = store.createCard('Deferred OpenCode question', 'QA-only task', 'todo', 'medium', [], 'alpha');
    const operationId = 'a'.repeat(64);
    const inputId = 'b'.repeat(64);
    const nativeInputMessageId = 'msg_17f4466d6001AtmOc1CmXoVyJf';
    const projectBinding = {
      contract: 'integrator-host-readiness-v1' as const, projectId: 'alpha', projectRoot: '/workspace/alpha',
      rootIdentity: 'alpha-root', policyRevision: 'qa-policy-1', observedAtMs: 1792550000000, runtimeInstanceId: 'herder-qa',
      hostId: 'roomhacker-server-100', harness: 'opencode' as const, harnessVersion: '', model: 'omniroute/minimax-combo-m3.1',
      requiredTools: [], availableTools: [], availableModels: ['omniroute/minimax-combo-m3.1'], resourceReady: true as const,
      cwd: '/workspace/alpha', pathResolution: { requestedCwd: '/workspace/alpha', canonicalCwd: '/workspace/alpha',
        rootPath: '/workspace/alpha', contained: true as const, identityMatches: true as const },
    };
    const humanRequestId = '67ce04db-d775-4f81-a86d-31af4bbe1091';
    const contextRef = `exmanager-task:${created.id}:${operationId}`;
    const executorQuestion = {
      humanRequestId, contextRef,
      registrationRef: { kind: 'herder-registry' as const, requestId: humanRequestId, contextRef },
      registrationTarget: { harness: 'opencode' as const, sessionId: 'opencode-qa-session', cwd: projectBinding.cwd },
      sourceMessageId: 'msg_17f4466d6001QuestionQa', sourceMessageHash: 'c'.repeat(64),
      sourceInputMessageId: nativeInputMessageId, sourceJobId: `job_${'d'.repeat(64)}`,
      text: 'Какой формат сводки выбрать?',
      choices: [{ value: 'brief', label: 'Краткая таблица' }, { value: 'total', label: 'Таблица с итоговой строкой' }],
      timeoutValue: 'brief', questionHash: 'e'.repeat(64),
    };
    const receipt = {
      operationId, requestHash: 'f'.repeat(64), lastBoardVersion: created.version + 1,
      createInputId: inputId, messageInputId: inputId, phase: 'running' as const,
      hostId: 'roomhacker-server-100', harness: 'opencode' as const, projectBinding,
      nativeSessionId: 'opencode-qa-session', nativeDispatchJobId: executorQuestion.sourceJobId,
      nativeInputMessageId, startedBy: 'testlogin', createdAt: '2026-10-29T00:00:00Z', updatedAt: '2026-10-29T00:00:00Z',
      executorQuestion,
    };
    const saved = store.updateCard(created.id, { taskExecutionHistory: [receipt] }, created.version);
    if (!saved || 'conflict' in saved) throw new Error('typed registry question receipt save failed');
    expect(store.readCardFile(path.join(root, saved.fileName))?.taskExecutionHistory?.[0]?.executorQuestion).toEqual(executorQuestion);
    expect(() => store.updateCard(created.id, { taskExecutionHistory: [{ ...receipt,
      lastBoardVersion: saved.version + 1,
      executorQuestion: { ...executorQuestion, registrationRef: { ...executorQuestion.registrationRef, contextRef: 'wrong-context' } },
    }] }, saved.version)).toThrow('task_execution_history');

    const legacyDirectQuestion = {
      humanRequestId: executorQuestion.humanRequestId, contextRef: executorQuestion.contextRef,
      registrationTarget: executorQuestion.registrationTarget,
      sourceMessageId: executorQuestion.sourceMessageId, sourceMessageHash: executorQuestion.sourceMessageHash,
      sourceInputMessageId: executorQuestion.sourceInputMessageId, sourceJobId: executorQuestion.sourceJobId,
      text: executorQuestion.text, choices: executorQuestion.choices, timeoutValue: executorQuestion.timeoutValue,
      questionHash: executorQuestion.questionHash,
      registrationMessageId: 'msg_17f4466d6001RegistrationQa', registrationCallId: 'call_17f4466d6001Qa',
    };
    const legacySaved = store.updateCard(created.id, { taskExecutionHistory: [{ ...receipt,
      lastBoardVersion: saved.version + 1, executorQuestion: legacyDirectQuestion,
    }] }, saved.version);
    if (!legacySaved || 'conflict' in legacySaved) throw new Error('legacy native question receipt save failed');
    expect(store.readCardFile(path.join(root, legacySaved.fileName))?.taskExecutionHistory?.[0]?.executorQuestion)
      .toMatchObject({ registrationMessageId: 'msg_17f4466d6001RegistrationQa', registrationCallId: 'call_17f4466d6001Qa' });
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

  test('round-trips turnless OpenCode child delivery proof after an assigned rework', () => {
    const created = store.createCard('OpenCode rework', 'Add a total row', 'todo', 'medium', [], 'alpha');
    const projectBinding = {
      contract: 'integrator-host-readiness-v1' as const, projectId: 'alpha', projectRoot: '/workspace/alpha',
      rootIdentity: 'alpha-root', policyRevision: 'qa-policy-1', observedAtMs: Date.now(), runtimeInstanceId: 'herder-qa',
      hostId: 'roomhacker-server-100', harness: 'opencode' as const, harnessVersion: '', model: 'omniroute/minimax-combo-m3.1',
      requiredTools: [], availableTools: [], availableModels: ['omniroute/minimax-combo-m3.1'], resourceReady: true as const,
      cwd: '/workspace/alpha', pathResolution: { requestedCwd: '/workspace/alpha', canonicalCwd: '/workspace/alpha',
        rootPath: '/workspace/alpha', contained: true as const, identityMatches: true as const },
    };
    const inputId = 'd'.repeat(64);
    const parent = {
      operationId: 'a'.repeat(64), requestHash: 'b'.repeat(64), lastBoardVersion: created.version + 1,
      createInputId: 'c'.repeat(64), messageInputId: inputId, phase: 'result' as const,
      hostId: 'roomhacker-server-100', harness: 'opencode' as const, projectBinding,
      nativeSessionId: 'opencode-qa-session', nativeDispatchJobId: `job_${'1'.repeat(64)}`,
      nativeInputMessageId: 'msg_17f4466d6001AtmOc1CmXoVyJf', startedBy: 'nikita',
      createdAt: '2026-10-28T00:00:00.000Z', updatedAt: '2026-10-28T00:00:00.000Z',
    };
    const rework = store.updateCard(created.id, {
      column: 'in-progress', needsReview: false, requiresApprovalFrom: ['testlogin'],
      resultHistory: [{ summary: 'v1', evidenceRefs: [], submittedBy: 'nikita', submittedAt: parent.updatedAt }],
      reviewHistory: [{ decision: 'rework', actor: 'testlogin', decidedAt: parent.updatedAt, note: 'Add total.' }],
      taskExecutionHistory: [parent],
    }, created.version);
    if (!rework || 'conflict' in rework) throw new Error('OpenCode rework receipt save failed');
    const child = {
      id: 'e'.repeat(64), kind: 'task-follow-up-v1' as const, instruction: 'Add total 2500.', inputId: 'f'.repeat(64),
      requestHash: '2'.repeat(64), requestedBy: 'testlogin', phase: 'running' as const,
      nativeDispatchJobId: `job_${'3'.repeat(64)}`, nativeInputMessageId: 'msg_17f4466d6001ChildQa',
      createdAt: parent.updatedAt, updatedAt: parent.updatedAt,
    };
    const running = { ...parent, lastBoardVersion: rework.version + 1, continuations: [child] };
    const saved = store.updateCard(created.id, { taskExecutionHistory: [running] }, rework.version);
    if (!saved || 'conflict' in saved) throw new Error('turnless OpenCode continuation CAS failed');
    const reopened = store.readCardFile(path.join(root, created.fileName));
    expect(reopened?.taskExecutionHistory?.[0]).toMatchObject({
      phase: 'result', harness: 'opencode', nativeSessionId: 'opencode-qa-session', nativeInputMessageId: parent.nativeInputMessageId,
      continuations: [{ phase: 'running', nativeDispatchJobId: child.nativeDispatchJobId, nativeInputMessageId: child.nativeInputMessageId }],
    });
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
