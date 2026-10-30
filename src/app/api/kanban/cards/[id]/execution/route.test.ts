import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { AIRLOCK_TODO_NATIVE_IDENTITY_HEADER, requestPathAndQuery } from '../../../../../../lib/auth/airlock-native-identity';
import { nativeProjectAccessForRequest, type NativeProjectAccessContext } from '../../../../../../lib/kanban/native-project-access';
import type { KanbanCard, TaskExecutionProjectBinding } from '@/lib/kanban/types';

const mocks = vi.hoisted(() => ({
  currentCard: { value: undefined as KanbanCard | undefined },
  findCardById: vi.fn(),
  updateCard: vi.fn(),
  tasksDirForScope: vi.fn(),
  identity: { value: { username: 'nikita', scope: 'work' as const } as { username: string; scope: 'work' } | null },
  humanIdentity: { value: undefined as { username: string; scope: 'work' } | null | undefined },
  boardHumanIdentityFromRequest: vi.fn(),
  nativeProjectAccess: { value: null as NativeProjectAccessContext | null },
  nativeProjectAccessContextFromRequest: vi.fn(async (_request: Request) => null as NativeProjectAccessContext | null),
  callOwnerHerderTool: vi.fn(),
  readOwnerHerderResource: vi.fn(),
  validateTransition: vi.fn(),
  taskExecutionSnapshot: vi.fn(),
  sessionInfo: { value: undefined as Record<string, unknown> | undefined },
  projectReadinessOverride: { value: undefined as Record<string, unknown> | undefined },
  projectRouteOverride: { value: undefined as Record<string, unknown> | undefined },
  turnChangesAfterView: { value: false },
  cardChangesAfterView: { value: false },
}));

vi.mock('@/lib/kanban/file-store', () => ({ findCardById: mocks.findCardById, updateCard: mocks.updateCard }));
vi.mock('@/lib/auth/request', () => ({
  boardIdentityFromRequest: () => mocks.identity.value ?? { username: 'anonymous', scope: 'work' },
  identityFromRequest: () => mocks.identity.value,
  automationTokenValid: (request: Request) => {
    const expected = process.env.KANBAN_AUTOMATION_TOKEN?.trim();
    const provided = request.headers.get('x-kanban-automation-token')?.trim();
    return !!expected && provided === expected;
  },
  nativeProjectAccessContextFromRequest: mocks.nativeProjectAccessContextFromRequest,
}));
vi.mock('../../../../../../lib/auth/board-human', () => ({
  boardHumanIdentityFromRequest: mocks.boardHumanIdentityFromRequest,
}));
vi.mock('@/lib/auth/data-scope', () => ({ tasksDirForScope: mocks.tasksDirForScope }));
vi.mock('@/lib/kanban/task-execution', () => ({ taskExecutionSnapshot: mocks.taskExecutionSnapshot }));
vi.mock('@/lib/kanban/task-execution-client', () => ({
  callOwnerHerderTool: mocks.callOwnerHerderTool,
  readOwnerHerderResource: mocks.readOwnerHerderResource,
}));
vi.mock('@/lib/kanban/transition-policy', () => ({ validateTransition: mocks.validateTransition }));

import { GET, PATCH, POST, verifiedQuestionContinuation, taskPrompt } from './route';

const baseCard: KanbanCard = {
  id: 'task-1', title: 'Research candidates', description: 'Find two SMB integrators', column: 'todo',
  priority: 'medium', tags: [], order: 1, created: '2026-10-20T10:00:00.000Z', updated: '2026-10-20T10:00:00.000Z',
  fileName: 'task.md', version: 4, project: 'Demo', assignees: [], owner: 'nikita',
};
const operationId = 'ui-operation-1234567890';
const sessionId = 'native-session-1';
const cwd = '/srv/excode';
const scopedProjectRoot = '/workspace/exmanager-task-workspace';
const questionOperationId = 'question-operation-1234567890';
const canonicalQuestionOperationId = createHash('sha256').update(`${baseCard.id}\0${questionOperationId}`).digest('hex');

function postRequest(body: Record<string, unknown> = { operationId, expectedVersion: 4 }, headers: Record<string, string> = {}) {
  return new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
}

function expectedOpenCodeTaskPrompt(card: KanbanCard, operationId: string, targetSessionId: string, targetCwd: string): string {
  const contextRef = `exmanager-task:${card.id}:${operationId}`;
  return [
    'ПРОТОКОЛ ВОПРОСА (строгий порядок, если задача требует ответа владельца): сначала binding, затем ровно один JSON-объект.',
    `Если для продолжения нужна ясность от ответственного, используй только metadata-only вызов agent-herder_human_request_create с kind="user", harness="opencode", sessionId=${JSON.stringify(targetSessionId)}, cwd=${JSON.stringify(targetCwd)}, contextRef=${JSON.stringify(contextRef)}. Не передавай message, choices или notify: вызов только закрепляет эту задачу и сессию.`,
    'После успешного binding твой следующий ответ должен быть ровно один JSON-объект и ничего больше: {"kind":"question","human_request_id":"<binding.request_id>","question":"<твой точный вопрос>","choices":[{"value":"<value>","label":"<вариант>"},{"value":"<value>","label":"<вариант>"}],"timeoutValue":"<один из value>"}. Никакого Markdown, никакого текста до или после, никаких замечаний, ссылок и сводок. В этом сообщении не пиши результат задачи и не подменяй вопрос ответом.',
    'Запрещено: искать и читать файл карточки на диске (в т.ч. в /home/roomhacker/todo-kanban/work-tasks); читать или анализировать код доски (/home/roomhacker/excode, airlock-agent), чтобы понять, как доставляются вопросы и ответы: доставку и возобновление делает доска сама; использовать sudo; писать результат в файлы. Ответ придёт в этой же сессии, результат задачи - текст финального ответа.',
    'Формат ответа «краткий вывод, публичные ссылки на источники и следующий шаг» относится только к финальному результату задачи после того, как человек ответит на вопрос. Вопрос задаётся сейчас — сейчас нужен только JSON-объект выше.',
    'Не отмечай карточку выполненной.',
    `Выполни задачу канбан карточки ${card.id} из проекта «${card.project}».`,
    `Название: ${card.title}`,
    `Описание задачи:\n${card.description}`,
    'Используй только явно указанный проект и задачу. Не пиши людям, не звони и не выполняй внешние действия, если это прямо не разрешено в тексте задачи.',
  ].join('\n\n');
}

function scopedReadiness(project = 'Demo', overrides: Record<string, unknown> = {}) {
  const pathResolution = {
    requestedCwd: scopedProjectRoot, canonicalCwd: scopedProjectRoot, rootPath: scopedProjectRoot,
    contained: true, identityMatches: true,
  };
  // The host reports the readiness of the route it names: the snapshot carries that harness and model.
  const route = mocks.projectRouteOverride.value ?? { harness: 'codex', model: 'gpt-6-luna', state: 'ready' };
  const harness = typeof route.harness === 'string' ? route.harness : 'codex';
  const model = typeof route.model === 'string' ? route.model : 'gpt-6-luna';
  const codex = harness === 'codex';
  return {
    hostId: 'roomhacker-server-100', nativeUser: 'operator',
    projectReadinessContract: 'integrator-host-readiness-v1',
    projectRoute: route,
    projectReadiness: {
      state: 'ready', projectId: project, projectRoot: scopedProjectRoot,
      rootIdentity: 'exmanager-workspace-root-v1', policyRevision: 'scope-policy-7',
      observedAtMs: Date.now(), runtimeInstanceId: 'herder-runtime-12', hostId: 'roomhacker-server-100',
      harness, harnessVersion: codex ? 'codex-test-1' : '', model,
      requiredTools: codex ? ['web_search'] : [], availableTools: codex ? ['web_search', 'shell_exec'] : [],
      availableModels: [model], resourceReady: true, cwd: scopedProjectRoot, pathResolution,
      ...overrides,
    },
  };
}

const parentOperationId = 'a'.repeat(64);
function researchCard(description = baseCard.description): KanbanCard {
  const card: KanbanCard = {
    ...baseCard, description, column: 'review', needsReview: true, version: 8,
    resultHistory: [{ summary: 'Original result', evidenceRefs: ['https://original.example'], submittedBy: 'nikita', submittedAt: '2026-10-20T10:06:00.000Z' }],
    reviewHistory: [],
  };
  const requestHash = createHash('sha256').update(JSON.stringify({
    id: card.id, title: card.title, description: card.description, project: card.project,
    owner: card.owner ?? 'nikita', assignee: card.assignee ?? null, assignees: card.assignees,
    actor: 'nikita', hostId: 'roomhacker-server-100', harness: 'codex', cwd, model: 'gpt-6-luna',
  })).digest('hex');
  card.taskExecutionHistory = [{
    operationId: parentOperationId, requestHash, lastBoardVersion: card.version,
    createInputId: '1'.repeat(64), messageInputId: '2'.repeat(64), phase: 'result',
    hostId: 'roomhacker-server-100', harness: 'codex', nativeSessionId: sessionId,
    nativeTurnId: 'parent-turn', startedBy: 'nikita', createdAt: card.created, updatedAt: card.updated,
  }];
  return card;
}

function openCodeReworkCard(): KanbanCard {
  const model = 'omniroute/minimax-combo-m3.1';
  mocks.projectRouteOverride.value = { state: 'ready', harness: 'opencode', model };
  const readiness = scopedReadiness('Demo').projectReadiness;
  const projectBinding = {
    contract: 'integrator-host-readiness-v1' as const,
    projectId: readiness.projectId, projectRoot: readiness.projectRoot, rootIdentity: readiness.rootIdentity,
    policyRevision: readiness.policyRevision, observedAtMs: readiness.observedAtMs,
    runtimeInstanceId: readiness.runtimeInstanceId, hostId: readiness.hostId, harness: 'opencode' as const,
    harnessVersion: readiness.harnessVersion, model: readiness.model,
    requiredTools: readiness.requiredTools as string[], availableTools: readiness.availableTools as string[],
    availableModels: readiness.availableModels as string[], resourceReady: true as const, cwd: readiness.cwd,
    pathResolution: { ...readiness.pathResolution, contained: true as const, identityMatches: true as const },
  };
  const card: KanbanCard = {
    ...researchCard(), column: 'in-progress', needsReview: false, version: 29, requiresApprovalFrom: ['testlogin'],
    reviewHistory: [{ decision: 'rework', actor: 'testlogin', decidedAt: '2026-10-28T00:00:00.000Z', note: 'Добавить итоговую строку.' }],
  };
  const parentInputId = '2'.repeat(64);
  const parent = {
    ...card.taskExecutionHistory![0]!, phase: 'result' as const, lastBoardVersion: 8,
    harness: 'opencode' as const, projectBinding, nativeSessionId: sessionId, nativeTurnId: undefined,
    messageInputId: parentInputId,
    nativeDispatchJobId: `job_${createHash('sha256').update(['user-message', 'opencode', sessionId, parentInputId].join('\0')).digest('hex')}`,
    nativeInputMessageId: 'msg_17f4466d6001AtmOc1CmXoVyJf',
  };
  const identity = {
    id: card.id, title: card.title, description: card.description, project: card.project,
    owner: card.owner ?? 'nikita', assignee: card.assignee ?? null, assignees: card.assignees,
    actor: 'nikita', hostId: 'roomhacker-server-100', harness: 'opencode', cwd: projectBinding.cwd, model, projectBinding,
  };
  return { ...card, taskExecutionHistory: [{ ...parent, requestHash: createHash('sha256').update(JSON.stringify(identity)).digest('hex') }] };
}

const continuationText = 'Research two relevant SMB integrators using official public sources; state hypotheses separately and do not contact them.';
function followUpRequest(action: 'continue-task' | 'sync-task-continuation', expectedVersion: number,
  continuationId?: string, text = continuationText, native = false) {
  return new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution', {
    method: 'PATCH', headers: { 'content-type': 'application/json', ...(native ? { 'X-Airlock-Todo-Native-Identity': 'verified-test-assertion' } : {}) }, body: JSON.stringify({
      action, operationId: parentOperationId, expectedVersion,
      ...(action === 'continue-task' ? { continuationText: text } : {}),
      ...(continuationId ? { continuationId } : {}),
    }),
  });
}

const controlCardId = '11111111-2222-4333-8444-555555555555';
const controlOperationId = 'b'.repeat(64);
const controlSessionId = 'opencode-session-1';
const controlInputId = '2'.repeat(64);
const controlNativeInputMessageId = 'msg_17f4466d6001AtmOc1CmXoVyJf';
function opencodeInputMessageId(inputId: string): string { return `msg_${inputId.slice(0, 32)}`; }

function userMessageJobId(sessionId: string, inputId: string): string {
  return 'job_' + createHash('sha256').update(['user-message', 'opencode', sessionId, inputId].join('\0')).digest('hex');
}

function openCodeProjectBinding(): TaskExecutionProjectBinding {
  const model = 'omniroute/minimax-combo-m3.1';
  mocks.projectRouteOverride.value = { state: 'ready', harness: 'opencode', model };
  const readiness = scopedReadiness('Demo').projectReadiness;
  return {
    contract: 'integrator-host-readiness-v1',
    projectId: readiness.projectId as string,
    projectRoot: readiness.projectRoot as string,
    rootIdentity: readiness.rootIdentity as string,
    policyRevision: readiness.policyRevision as string,
    observedAtMs: readiness.observedAtMs as number,
    runtimeInstanceId: readiness.runtimeInstanceId as string,
    hostId: readiness.hostId as string,
    harness: 'opencode', harnessVersion: '', model,
    requiredTools: [], availableTools: [], availableModels: [model], resourceReady: true,
    cwd: scopedProjectRoot,
    pathResolution: { requestedCwd: scopedProjectRoot, canonicalCwd: scopedProjectRoot, rootPath: scopedProjectRoot,
      contained: true, identityMatches: true },
  };
}

function opencodeJobGetResult(jobId: string) {
  const candidates = (mocks.currentCard.value?.taskExecutionHistory ?? []).flatMap(receipt => [
    ...(receipt.nativeSessionId
      ? [{ sessionId: receipt.nativeSessionId, inputId: receipt.messageInputId,
          messageId: receipt.nativeInputMessageId ?? opencodeInputMessageId(receipt.messageInputId) }] : []),
    ...(receipt.sessionControls?.direct ?? []).flatMap(control => control.nativeDispatchJobId
      ? [{ sessionId: receipt.nativeSessionId ?? controlSessionId, inputId: control.requestHash,
          messageId: control.nativeInputMessageId ?? opencodeInputMessageId(control.requestHash) }]
      : []),
    ...(receipt.continuations ?? []).flatMap(child => child.nativeDispatchJobId && child.nativeInputMessageId
      ? [{ sessionId: receipt.nativeSessionId ?? controlSessionId, inputId: child.inputId, messageId: child.nativeInputMessageId }]
      : []),
  ]);
  const match = candidates.find(candidate => userMessageJobId(candidate.sessionId, candidate.inputId) === jobId);
  if (!match) return { structuredContent: { job: { id: jobId, state: 'not_found' } }, content: [] };
  return { structuredContent: { job: {
    id: jobId, state: 'completed', ownerSessionId: match.sessionId,
    onceKey: ['user-message', 'opencode', match.sessionId, match.inputId].join('\0'),
    result: { ok: true, admitted: true, inputId: match.inputId, nativeInputMessageId: match.messageId },
  } }, content: [] };
}

function prepareRegistryExecutorQuestion(input: {
  registryRecord?: Record<string, unknown> | null;
  questionIds?: string[];
  questionPhase?: string;
} = {}) {
  const humanRequestId = '67ce04db-d775-4f81-a86d-31af4bbe1091';
  const project = 'UX QA 2026-10-26';
  const model = 'omniroute/minimax-combo-m3.1';
  mocks.projectRouteOverride.value = { state: 'ready', harness: 'opencode', model };
  mocks.identity.value = { username: 'testlogin', scope: 'work' };
  const readiness = scopedReadiness(project).projectReadiness;
  const projectBinding: TaskExecutionProjectBinding = {
    contract: 'integrator-host-readiness-v1', projectId: project, projectRoot: readiness.projectRoot,
    rootIdentity: readiness.rootIdentity, policyRevision: readiness.policyRevision, observedAtMs: readiness.observedAtMs,
    runtimeInstanceId: readiness.runtimeInstanceId, hostId: readiness.hostId, harness: 'opencode',
    harnessVersion: readiness.harnessVersion, model: readiness.model,
    requiredTools: readiness.requiredTools as string[], availableTools: readiness.availableTools as string[],
    availableModels: readiness.availableModels as string[], resourceReady: true, cwd: readiness.cwd,
    pathResolution: { ...readiness.pathResolution, contained: true, identityMatches: true },
  };
  const inputId = '4'.repeat(64);
  const nativeInputMessageId = opencodeInputMessageId(inputId);
  const nativeDispatchJobId = userMessageJobId(sessionId, inputId);
  const card: KanbanCard = {
    ...baseCard, id: 'f1b6dc21-ddde-4ddf-bd49-2c2a6b867fba', title: 'QA L06: вопрос о варианте тестовой сводки',
    description: 'Синтетическая QA-задача.', project, owner: 'testlogin', column: 'todo', version: 7,
  };
  const attemptIdentity = {
    id: card.id, title: card.title, description: card.description, project: card.project, owner: card.owner,
    assignee: null, assignees: card.assignees, actor: 'testlogin', hostId: 'roomhacker-server-100',
    harness: 'opencode', cwd: projectBinding.cwd, model, projectBinding,
  };
  const operationId = 'a'.repeat(64);
  const requestHash = createHash('sha256').update(JSON.stringify(attemptIdentity)).digest('hex');
  mocks.currentCard.value = { ...card, taskExecutionHistory: [{
    operationId, requestHash, lastBoardVersion: card.version, createInputId: '3'.repeat(64), messageInputId: inputId,
    phase: 'running', hostId: 'roomhacker-server-100', harness: 'opencode', projectBinding, nativeSessionId: sessionId,
    nativeInputMessageId, nativeDispatchJobId, startedBy: 'testlogin', createdAt: card.created, updatedAt: card.updated,
  }] };
  mocks.sessionInfo.value = {
    id: sessionId, harness: 'opencode', hostId: 'roomhacker-server-100', cwd: projectBinding.cwd,
    model, status: 'idle', lastActivity: '2026-10-28T18:00:00.000Z',
    meta: { nativeLastTurn: { status: 'completed' } },
  };
  const contextRef = `exmanager-task:${card.id}:${operationId}`;
  const questionPayload = {
    kind: 'question', human_request_id: humanRequestId, question: 'Какой формат сводки выбрать?',
    choices: [{ value: 'brief', label: 'Краткая таблица' }, { value: 'total', label: 'Таблица с итоговой строкой' }],
    timeoutValue: 'brief',
  };
  const questionIds = input.questionIds ?? [humanRequestId];
  const questionMessages = questionIds.map((requestId, index) => ({
    id: `msg_question_${String(index).padStart(8, '0')}`,
    role: 'assistant', turnId: undefined, phase: input.questionPhase ?? 'completed',
    parts: [{ type: 'text', text: JSON.stringify({ ...questionPayload, human_request_id: requestId }) }],
  }));
  const executeMessage = {
    id: 'msg_execute_1234567890', role: 'assistant', phase: 'tool-calls',
    parts: [{ type: 'tool_call', name: 'execute', input: { code:
      `await tools["agent-herder"].human_request_create({kind:"user",harness:"opencode",sessionId:${JSON.stringify(sessionId)},cwd:${JSON.stringify(projectBinding.cwd)},contextRef:${JSON.stringify(contextRef)}});` } }],
  };
  const fillerMessages = Array.from({ length: Math.max(0, 50 - questionMessages.length - 1) }, (_, index) => ({
    id: `msg_filler_${String(index).padStart(8, '0')}`, role: 'assistant', phase: 'tool-calls',
    parts: [{ type: 'tool_call', name: 'shell', input: { command: 'bounded QA fixture' } }],
  }));
  const messages: Array<Record<string, unknown>> = [...fillerMessages, executeMessage, ...questionMessages];
  const messagesUri = `herder://sessions/opencode/${encodeURIComponent(sessionId)}/messages`;
  const firstUserUri = `herder://sessions/opencode/${encodeURIComponent(sessionId)}/first-user-message`;
  const firstUserMessage = {
    id: nativeInputMessageId, role: 'user',
    parts: [{ type: 'text', text: expectedOpenCodeTaskPrompt(card, operationId, sessionId, projectBinding.cwd) }],
  };
  mocks.readOwnerHerderResource.mockImplementation(async (uri: string) => ({ contents: [{
    uri, mimeType: 'application/json', text: JSON.stringify(uri === firstUserUri ? firstUserMessage : messages),
  }] }));
  const record = input.registryRecord === undefined ? {
    requestId: humanRequestId, kind: 'user',
    target: { harness: 'opencode', sessionId, cwd: projectBinding.cwd }, contextRef,
    status: 'pending', answerSource: 'human_channel', continuation: 'resume', createdAt: '2026-10-29T00:00:00.000Z',
  } : input.registryRecord;
  mocks.callOwnerHerderTool.mockImplementation(async (tool: string, args: Record<string, unknown>) => {
    if (tool === 'human_request_get') return { structuredContent: { request: record }, content: [] };
    return toolResult(tool, args);
  });
  vi.stubEnv('EXMANAGER_NOTICE_PROJECT_TOKEN', 'qa-only');
  vi.stubEnv('NOTIFY_CENTER_RECIPIENT', 'qa-board-only');
  vi.stubEnv('KANBAN_QA_ANONYMOUS_READS', '1');
  vi.stubEnv('EXMANAGER_NOTICE_API_BASE_URL', 'http://192.168.192.1:19450');
  return { humanRequestId, project, model, projectBinding, inputId, nativeInputMessageId, nativeDispatchJobId,
    card, operationId, contextRef, questionPayload, messages, messagesUri, firstUserUri };
}

function addAcceptedDirectContinuation(fixture: ReturnType<typeof prepareRegistryExecutorQuestion>, stop: {
  phase: 'accepted' | 'unknown' | 'intent'; controlEpoch?: string;
} = { phase: 'accepted', controlEpoch: fixture.inputId }) {
  const directInputId = '5'.repeat(64);
  const directNativeInputMessageId = 'msg_direct_1234567890';
  const directJobId = userMessageJobId(sessionId, directInputId);
  const control = {
    requestHash: '6'.repeat(64), phase: stop.phase,
    ...(stop.controlEpoch ? { controlEpoch: stop.controlEpoch } : {}), updatedAt: '2026-10-29T00:01:00.000Z',
  } as const;
  const direct = { requestHash: directInputId, phase: 'accepted' as const,
    nativeDispatchJobId: directJobId, nativeInputMessageId: directNativeInputMessageId,
    updatedAt: '2026-10-29T00:02:00.000Z' };
  const current = mocks.currentCard.value!;
  const attempt = current.taskExecutionHistory![0]!;
  mocks.currentCard.value = { ...current, taskExecutionHistory: [{ ...attempt, phase: 'running', sessionControls: {
    stops: [control], stop: control, direct: [direct],
  } }] };
  fixture.messages.unshift({ id: directNativeInputMessageId, inputId: directInputId, role: 'user',
    parts: [{ type: 'text', text: 'Продолжи задачу и уточни недостающий выбор.' }] });
  return { directInputId, directNativeInputMessageId, directJobId };
}

function fileStoreQuestionRoundTrip(question: NonNullable<KanbanCard['taskExecutionHistory']>[number]['executorQuestion']) {
  const registrationRef = question?.registrationRef;
  if (!question || !registrationRef) throw new Error('registry question proof required');
  return {
    humanRequestId: question.humanRequestId,
    contextRef: question.contextRef,
    registrationTarget: { harness: question.registrationTarget.harness,
      sessionId: question.registrationTarget.sessionId, cwd: question.registrationTarget.cwd },
    sourceMessageId: question.sourceMessageId,
    sourceMessageHash: question.sourceMessageHash,
    sourceInputMessageId: question.sourceInputMessageId,
    sourceJobId: question.sourceJobId,
    text: question.text,
    choices: question.choices.map(choice => ({ value: choice.value, label: choice.label })),
    timeoutValue: question.timeoutValue,
    questionHash: question.questionHash,
    registrationRef: { kind: registrationRef.kind,
      requestId: registrationRef.requestId, contextRef: registrationRef.contextRef },
  };
}

function canonicalJsonForQuestionTest(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJsonForQuestionTest).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJsonForQuestionTest(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function executorQuestionHashForTest(question: NonNullable<KanbanCard['taskExecutionHistory']>[number]['executorQuestion']): string {
  if (!question) throw new Error('question proof missing');
  return createHash('sha256').update(canonicalJsonForQuestionTest({
    humanRequestId: question.humanRequestId,
    sourceMessageId: question.sourceMessageId,
    sourceMessageHash: question.sourceMessageHash,
    sourceInputMessageId: question.sourceInputMessageId,
    sourceJobId: question.sourceJobId,
    text: question.text,
    choices: question.choices,
    timeoutValue: question.timeoutValue,
  })).digest('hex');
}

function legacyQuestionRequestHash(fixture: ReturnType<typeof prepareRegistryExecutorQuestion>, question: NonNullable<KanbanCard['taskExecutionHistory']>[number]['executorQuestion'], version: number): string {
  if (!question) throw new Error('question proof missing');
  return createHash('sha256').update(JSON.stringify({
    taskRef: fixture.card.id, operationId: fixture.operationId, project: fixture.project,
    recipient: 'qa-board-only', purpose: 'clarification', version,
    message: question.text, choices: question.choices, timeoutValue: question.timeoutValue,
    executorQuestion: question,
  })).digest('hex');
}

function controllableOpenCodeCard(): KanbanCard {
  const projectBinding = openCodeProjectBinding();
  mocks.sessionInfo.value = { id: controlSessionId, harness: 'opencode', hostId: 'roomhacker-server-100',
    cwd: projectBinding.cwd, model: projectBinding.model, status: 'running', needsPermission: false };
  return {
    ...baseCard,
    id: controlCardId,
    taskExecutionHistory: [{
      operationId: controlOperationId, requestHash: 'c'.repeat(64), lastBoardVersion: baseCard.version,
      createInputId: '1'.repeat(64), messageInputId: controlInputId, phase: 'running',
      hostId: 'roomhacker-server-100', harness: 'opencode', nativeSessionId: controlSessionId,
      nativeDispatchJobId: userMessageJobId(controlSessionId, controlInputId), nativeInputMessageId: controlNativeInputMessageId,
      projectBinding, startedBy: 'nikita', createdAt: baseCard.created, updatedAt: baseCard.updated,
    }],
  };
}

function sessionControlRequest(body: Record<string, unknown>) {
  return new NextRequest(`https://todo.example.test/api/kanban/cards/${controlCardId}/execution`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

function runningQuestionCard(): KanbanCard {
  return {
    ...baseCard,
    taskExecutionHistory: [{
      operationId: canonicalQuestionOperationId,
      requestHash: 'f'.repeat(64),
      lastBoardVersion: baseCard.version,
      createInputId: '1'.repeat(64), messageInputId: '2'.repeat(64), phase: 'running',
      hostId: 'roomhacker-server-100', harness: 'codex', nativeSessionId: 'question-session',
      nativeTurnId: 'question-turn', startedBy: 'nikita',
      createdAt: baseCard.created, updatedAt: baseCard.updated,
    }],
  };
}

function createQuestionRequest(expectedVersion = baseCard.version, extra: Record<string, unknown> = {}) {
  return new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution', {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      action: 'create-question', expectedVersion, operationId: questionOperationId,
      purpose: 'clarify-scope', message: 'Which source set should I compare?',
      choices: [{ value: 'current', label: 'Current project only' }, { value: 'all', label: 'All available sources' }],
      timeoutValue: 'current', ...extra,
    }),
  });
}

function expectedNoticeRequestId(taskId: string, purpose: string, version: number): string {
  return `td-${createHash('sha256').update(JSON.stringify([taskId, purpose, String(version)])).digest('hex').slice(0, 40)}`;
}

function noticeQuestionView(input: {
  requestId: string; taskRef: string; operationId: string; purpose: string; version: number;
  winner?: { source: 'human' | 'timeout'; value: string; decided_at: number } | null;
  deliveryStatus?: string; idempotent?: boolean;
}) {
  return {
    schema: 'noticeplace.task_decision_view.v1', request_id: input.requestId,
    project: 'Demo', recipient: 'operator-fixture', status: input.winner?.source === 'timeout' ? 'expired'
      : input.winner?.source === 'human' ? 'resolved' : 'pending',
    question: { text: 'Which source set should I compare?', mode: 'choice',
      choices: [{ value: 'current', label: 'Current project only' }, { value: 'all', label: 'All available sources' }],
      expires_at: null, reference: { task_ref: input.taskRef, purpose: input.purpose, version: String(input.version), mandate_ref: input.operationId } },
    notification: { attempt_state: 'sent', receipt: { kind: 'successful_sender_response', confirmed_at: 123, chat_id: 'private-id', message_id: 45 }, deadline_at: 456 },
    winner: input.winner ? input.winner : null,
    ...(input.deliveryStatus ? { delivery_status: input.deliveryStatus } : {}),
    ...(input.idempotent !== undefined ? { idempotent: input.idempotent } : {}),
  };
}

function deferredQuestionNoticeView(fixture: ReturnType<typeof prepareRegistryExecutorQuestion>, input: {
  attemptState: string; delivered?: boolean; deadlineAt?: number | null; deliveryStatus?: string;
}) {
  const attempt = mocks.currentCard.value!.taskExecutionHistory![0]!;
  const reference = attempt.taskDecisionRequest!;
  const question = attempt.executorQuestion!;
  const delivered = input.delivered ?? false;
  return {
    schema: 'noticeplace.task_decision_view.v1', request_id: reference.requestId,
    project: fixture.project, recipient: 'qa-board-only', status: 'pending',
    question: { text: question.text, mode: 'choice', choices: question.choices,
      expires_at: input.deadlineAt ?? null,
      reference: { task_ref: fixture.card.id, purpose: 'clarification',
        version: String(reference.version), mandate_ref: fixture.operationId } },
    notification: { attempt_state: input.attemptState,
      receipt: delivered ? { kind: 'successful_sender_response', confirmed_at: 100 } : null,
      deadline_at: input.deadlineAt ?? null },
    winner: null, control: { state: 'clear' },
    delivery_status: input.deliveryStatus ?? input.attemptState,
    idempotent: true,
  };
}

function noticeResponse(body: unknown, status = 201): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function toolResult(tool: string, args: Record<string, unknown>) {
  if (tool === 'job_get') return opencodeJobGetResult(String(args.jobId));
  if (tool === 'fleet_node_info') {
    const info = typeof args.project === 'string' ? (mocks.projectReadinessOverride.value ?? scopedReadiness(args.project)) : { hostId: 'roomhacker-server-100', nativeUser: 'operator' };
    return { structuredContent: info, content: [{ type: 'text', text: JSON.stringify(info) }] };
  }
  if (tool === 'fleet_create_session') {
    const readiness = args.projectReadiness as Record<string, unknown> | undefined;
    mocks.sessionInfo.value = { ...mocks.sessionInfo.value, cwd: args.cwd,
      harness: readiness?.harness ?? 'codex', model: readiness?.model ?? 'gpt-6-luna',
      hostId: readiness?.hostId ?? 'roomhacker-server-100', status: 'idle', needsPermission: false };
    const requiredTools = readiness?.requiredTools ?? [];
    const projectExecution = readiness ? {
      projectId: readiness.projectId, projectRoot: readiness.projectRoot,
      rootIdentity: readiness.rootIdentity, policyRevision: readiness.policyRevision,
      hostId: readiness.hostId, harness: readiness.harness, model: readiness.model,
      requiredTools, address: { hostId: readiness.hostId, harness: readiness.harness, nativeSessionId: sessionId },
      launchCwd: readiness.cwd,
    } : undefined;
    return { structuredContent: {
      ok: true, created: true, inputId: args.inputId, harness: readiness?.harness ?? 'codex', sessionId, cwd: args.cwd,
      ...(projectExecution ? { projectReadinessContract: args.projectReadinessContract, projectExecution } : {}),
    }, content: [] };
  }
  if (tool === 'fleet_session_view') {
    const binding = mocks.currentCard.value?.taskExecutionHistory?.at(-1)?.projectBinding;
    const receiptCwd = binding?.cwd ?? cwd;
    const result = { structuredContent: {
      hostId: 'roomhacker-server-100', details: {
        session: { id: sessionId, harness: binding?.harness ?? 'codex', cwd: receiptCwd, model: binding?.model ?? 'gpt-6-luna' },
        historyUnavailable: false, messages: [{ role: 'assistant', text: 'Found two candidates' }],
      },
    }, content: [] };
    if (mocks.turnChangesAfterView.value) {
      mocks.turnChangesAfterView.value = false;
      mocks.sessionInfo.value = {
        ...mocks.sessionInfo.value,
        meta: { nativeLastTurn: { turnId: 'new-turn-started-during-read', status: 'inProgress' } },
      };
    }
    if (mocks.cardChangesAfterView.value && mocks.currentCard.value) {
      mocks.cardChangesAfterView.value = false;
      mocks.currentCard.value = { ...mocks.currentCard.value, version: mocks.currentCard.value.version + 1,
        tags: ['edited during transcript read'] };
    }
    return result;
  }
  if (tool === 'agent_info') return { structuredContent: { session: mocks.sessionInfo.value }, content: [] };
  if (tool === 'send_message') {
    return { content: [{ type: 'text', text: `Native admission receipt: ${JSON.stringify({ admitted: true, inputId: args.inputId, turnId: 'turn-1' })}` }] };
  }
  throw new Error(`unexpected tool ${tool}`);
}

function observedHerderDelivery(delivery: string, inputId = 'fixture-input', target = {
  hostId: 'roomhacker-server-100', harness: 'codex', sessionId,
}) {
  return { content: [{ type: 'text', text: JSON.stringify({ delivery, response: {
    jobId: 'fixture-delivery-job', inputId, status: 'completed', target,
  } }) }] };
}

describe('task execution API', () => {
  it('asks the executor for a bare question object instead of a prose result', () => {
    // The board binds a question by parsing the whole final assistant text as
    // one JSON object. A prompt that also asks for a human-review summary in
    // the same message makes the executor answer with prose, and the question
    // can then never be bound.
    const prompt = taskPrompt(baseCard as KanbanCard, {
      operationId: 'op-question-1234567890', harness: 'opencode', sessionId: 'ses_question', cwd: '/srv/excode',
    });

    expect(prompt).toContain('"kind":"question"');
    expect(prompt).toContain('ровно один JSON-объект');
    // The result format belongs to the answer that follows the human reply,
    // never to the message that asks the question.
    const questionInstruction = prompt.indexOf('После успешного binding');
    const resultInstruction = prompt.indexOf('Подготовь результат для проверки человеком');
    expect(questionInstruction).toBeGreaterThan(-1);
    expect(resultInstruction === -1 || resultInstruction > questionInstruction).toBe(true);
    // The bare-JSON rule must come before any mention of the result format.
    expect(prompt.indexOf('Формат ответа')).toBeGreaterThan(questionInstruction);
  });

  it('puts the question protocol and its prohibitions before the card description', () => {
    const prompt = taskPrompt(baseCard as KanbanCard, {
      operationId: 'op-question-1234567890', harness: 'opencode', sessionId: 'ses_question', cwd: '/srv/excode',
    });

    const protocol = prompt.indexOf('ПРОТОКОЛ ВОПРОСА');
    const prohibition = prompt.indexOf('Запрещено: искать и читать файл карточки на диске');
    expect(protocol).toBe(0);
    expect(prohibition).toBeGreaterThan(protocol);
    expect(prohibition).toBeLessThan(prompt.indexOf('Описание задачи:'));
  });

  it('sends the executor the same prompt that the board looks for in the session', () => {
    // The board finds the task message in the native session by matching the
    // prompt text. When the prompt that was sent and the prompt that is
    // matched differ, the message is never found and the result stays
    // unaccepted.
    const prompt = taskPrompt(baseCard as KanbanCard, {
      operationId: 'op-question-1234567890', harness: 'opencode', sessionId: 'ses_question', cwd: '/srv/excode',
    });

    expect(expectedOpenCodeTaskPrompt(baseCard as KanbanCard, 'op-question-1234567890', 'ses_question', '/srv/excode'))
      .toBe(prompt);
  });

  it('accepts the authoritative opaque Herder resume receipt with exact question bindings', () => {
    const requestId = '500a1426-ab7f-4f19-b2fd-c2325ce67963';
    const resultRef = '52cbc5fe-3bed-5c08-b555-b2f16c0ef9cb';
    const idempotencyKey = `human-request:${requestId}:1903aa65-18d4-4a99-8070-af0cdd499ee5`;
    const inputId = `herder-resume-${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 32)}`;
    const attempt = { nativeSessionId: 'ses_e7a71fddcffeCnSQ1JWpaCOSOG', executorQuestion: { humanRequestId: requestId } };
    const view = { continuation: { state: 'accepted', request_id: requestId, result_ref: resultRef,
      idempotency_key: idempotencyKey, input_id: inputId, receipt: 'resume-40f31f996a434867a3f7cd90c1730e80' } };

    expect(verifiedQuestionContinuation(view as never, attempt as never)).toEqual({
      requestId, resultRef, idempotencyKey, inputId, receipt: 'resume-40f31f996a434867a3f7cd90c1730e80',
    });
    expect(verifiedQuestionContinuation({ ...view, continuation: { ...view.continuation, input_id: 'herder-resume-wrong' } } as never,
      attempt as never)).toBeUndefined();
    expect(verifiedQuestionContinuation({ ...view, continuation: { ...view.continuation, receipt: 'resume-short' } } as never,
      attempt as never)).toBeUndefined();
    expect(verifiedQuestionContinuation({ ...view, continuation: { ...view.continuation, request_id: 'different-request' } } as never,
      attempt as never)).toBeUndefined();
    expect(verifiedQuestionContinuation({ ...view, continuation: { ...view.continuation,
      receipt: 'agent-herder://opencode/ses_e7a71fddcffeCnSQ1JWpaCOSOG/' + idempotencyKey } } as never,
      attempt as never)).toEqual(expect.objectContaining({ requestId, resultRef, idempotencyKey, inputId }));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.humanIdentity.value = undefined;
    mocks.boardHumanIdentityFromRequest.mockImplementation(async () =>
      mocks.humanIdentity.value === undefined ? mocks.identity.value : mocks.humanIdentity.value);
    mocks.currentCard.value = { ...baseCard };
    mocks.findCardById.mockImplementation(() => mocks.currentCard.value);
    mocks.updateCard.mockImplementation((_id: string, patch: Partial<KanbanCard>, expectedVersion: number) => {
      const current = mocks.currentCard.value!;
      if (current.version !== expectedVersion) return { conflict: true, serverCard: current };
      mocks.currentCard.value = { ...current, ...patch, version: current.version + 1 };
      return mocks.currentCard.value;
    });
    mocks.tasksDirForScope.mockReturnValue('/tasks/work');
    mocks.identity.value = { username: 'nikita', scope: 'work' };
    mocks.nativeProjectAccess.value = null;
    mocks.nativeProjectAccessContextFromRequest.mockImplementation(async () => mocks.nativeProjectAccess.value);
    mocks.sessionInfo.value = {
      id: sessionId, harness: 'codex', hostId: 'roomhacker-server-100', cwd, model: 'gpt-6-luna', status: 'idle', needsPermission: false,
      lastActivity: '2026-10-20T10:05:00.000Z', lastMessage: 'Found two candidates',
      meta: { nativeLastTurn: { turnId: 'turn-1', status: 'completed' } },
    };
    mocks.turnChangesAfterView.value = false;
    mocks.cardChangesAfterView.value = false;
    mocks.projectReadinessOverride.value = undefined;
    mocks.projectRouteOverride.value = undefined;
    mocks.callOwnerHerderTool.mockImplementation(toolResult);
    mocks.validateTransition.mockReturnValue({ kind: 'accepted', patch: { column: 'in-progress' } });
    mocks.taskExecutionSnapshot.mockImplementation((card: KanbanCard) => ({
      cardId: card.id,
      state: card.taskExecutionHistory?.at(-1)?.phase === 'running' ? 'running'
        : card.taskExecutionHistory?.at(-1)?.phase === 'created' ? 'waiting'
          : card.taskExecutionHistory?.at(-1)?.phase === 'stopped' ? 'stopped' : 'not-started',
    }));
    process.env.EXMANAGER_TASK_EXECUTION_CWD = cwd;
    process.env.AGENT_HERDER_HTTP_TOKEN = 'test-only-protected-ref';
    vi.stubEnv('NOTIFY_CENTER_RECIPIENT', 'operator-fixture');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('returns start readiness without exposing fixed host or project configuration', async () => {
    const response = await GET(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution'), {
      params: Promise.resolve({ id: baseCard.id }),
    });
    if (!response) throw new Error('execution response missing');
    expect(await response.json()).toEqual({ cardId: 'task-1', state: 'not-started', startAvailable: true });
    expect(mocks.callOwnerHerderTool).not.toHaveBeenCalled();
  });

  it('does not advertise start readiness to an anonymous board visitor', async () => {
    mocks.identity.value = null;
    const response = await GET(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution'), {
      params: Promise.resolve({ id: baseCard.id }),
    });
    if (!response) throw new Error('execution response missing');
    expect(await response.json()).toMatchObject({
      cardId: baseCard.id, state: 'not-started', startAvailable: false,
      unavailableReason: expect.stringMatching(/войдите|авториз/i),
    });
    expect(mocks.callOwnerHerderTool).not.toHaveBeenCalled();
    expect(mocks.updateCard).not.toHaveBeenCalled();
  });

  it('uses the verified shared board login for readiness and start', async () => {
    mocks.identity.value = null;
    mocks.humanIdentity.value = { username: 'nikita', scope: 'work' };

    const ready = await GET(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution'), {
      params: Promise.resolve({ id: baseCard.id }),
    });
    if (!ready) throw new Error('execution readiness response missing');
    expect(await ready.json()).toMatchObject({ startAvailable: true });

    const response = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('task execution response missing');
    expect(response.status).toBe(201);
    expect(mocks.updateCard).toHaveBeenCalled();
    expect(mocks.callOwnerHerderTool).toHaveBeenCalledWith('fleet_node_info', { project: baseCard.project });
    expect(mocks.callOwnerHerderTool).toHaveBeenCalledWith('fleet_create_session', expect.objectContaining({ cwd: scopedProjectRoot, model: 'gpt-6-luna', project: baseCard.project }));
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.startedBy).toBe('nikita');
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]).not.toHaveProperty('requestedBy');
  });

  it('uses current native project read membership for execution status without inventing a board username', async () => {
    const forProject = vi.fn(async () => ({ project: 'Demo', team: 'integrator', readAllowed: true as const, writeAllowed: false }));
    mocks.nativeProjectAccess.value = { userId: 'airlock-native-user-42', forProject };
    mocks.taskExecutionSnapshot.mockReturnValue({
      cardId: baseCard.id,
      state: 'not-started',
      operationReceipt: { source: 'card.taskExecutionHistory', status: 'unknown', operationCount: 0, reason: 'history-field-absent' },
    });
    const response = await GET(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution', {
      headers: { 'X-Airlock-Todo-Native-Identity': 'verified-test-assertion' },
    }), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('native execution read response missing');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      cardId: baseCard.id,
      operationReceipt: { source: 'card.taskExecutionHistory', status: 'unknown', operationCount: 0, reason: 'history-field-absent' },
      startAvailable: false,
      unavailableReason: expect.stringMatching(/только для чтения/i),
    });
    expect(forProject).toHaveBeenCalledWith('Demo');
    expect(mocks.callOwnerHerderTool).not.toHaveBeenCalled();
  });

  it('returns the persisted operation and native session IDs through the same read-scoped execution GET', async () => {
    const forProject = vi.fn(async () => ({ project: 'Demo', team: 'integrator', readAllowed: true as const, writeAllowed: false }));
    mocks.nativeProjectAccess.value = { userId: 'airlock-native-user-42', forProject };
    const receipt = {
      source: 'card.taskExecutionHistory', status: 'recorded', operationCount: 1,
      operationId: 'a'.repeat(64), phase: 'running', harness: 'opencode',
      nativeSessionId: 'session-from-saved-receipt', updatedAt: '2026-10-28T18:00:00.000Z',
    };
    mocks.taskExecutionSnapshot.mockReturnValue({ cardId: baseCard.id, state: 'running', operationReceipt: receipt });

    const response = await GET(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution', {
      headers: { 'X-Airlock-Todo-Native-Identity': 'verified-test-assertion' },
    }), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('native execution read response missing');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ cardId: baseCard.id, state: 'running', operationReceipt: receipt });
    expect(forProject).toHaveBeenCalledWith('Demo');
    expect(mocks.callOwnerHerderTool).not.toHaveBeenCalled();
    expect(mocks.updateCard).not.toHaveBeenCalled();
  });

  it('starts and exactly replays one native-manager task with the signed user id as receipt actor', async () => {
    const forProject = vi.fn(async () => ({ project: 'Demo', team: 'integrator', readAllowed: true as const, writeAllowed: true }));
    mocks.nativeProjectAccess.value = { userId: 'airlock-native-user-42', forProject };
    const request = () => postRequest(undefined, { 'X-Airlock-Todo-Native-Identity': 'verified-test-assertion' });
    const response = await POST(request(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('native execution response missing');
    expect(response.status).toBe(201);
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.startedBy).toBe('airlock-native-user-42');
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.requestedBy).toBe('airlock-native-user-42');
    expect(forProject).toHaveBeenCalledWith('Demo');
    const createsAfterFirst = mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'fleet_create_session').length;
    expect(createsAfterFirst).toBe(1);

    const replay = await POST(request(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!replay) throw new Error('native execution replay response missing');
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ replay: true });
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'fleet_create_session')).toHaveLength(1);
  });

  it('denies native execution without current write grant and never falls back from an invalid present assertion', async () => {
    const forProject = vi.fn(async () => ({ project: 'Demo', team: 'integrator', readAllowed: true as const, writeAllowed: false }));
    mocks.nativeProjectAccess.value = { userId: 'airlock-native-user-42', forProject };
    const denied = await POST(postRequest(undefined, { 'X-Airlock-Todo-Native-Identity': 'verified-test-assertion' }), {
      params: Promise.resolve({ id: baseCard.id }),
    });
    if (!denied) throw new Error('native denied response missing');
    expect(denied.status).toBe(404);
    expect(mocks.updateCard).not.toHaveBeenCalled();
    expect(mocks.callOwnerHerderTool).not.toHaveBeenCalled();

    mocks.nativeProjectAccess.value = null;
    const requestModule = await import('@/lib/auth/request');
    vi.mocked(requestModule.nativeProjectAccessContextFromRequest).mockRejectedValueOnce(new Error('native_identity_invalid'));
    const invalid = await POST(postRequest(undefined, { 'X-Airlock-Todo-Native-Identity': 'tampered' }), {
      params: Promise.resolve({ id: baseCard.id }),
    });
    if (!invalid) throw new Error('invalid native assertion response missing');
    expect(invalid.status).toBe(403);
    expect(mocks.updateCard).not.toHaveBeenCalled();
    expect(mocks.callOwnerHerderTool).not.toHaveBeenCalled();
    expect(mocks.boardHumanIdentityFromRequest).not.toHaveBeenCalled();
  });

  it('keeps a native execution read loud on a scope outage and silent only on denial', async () => {
    const getRequest = () => new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution');
    mocks.nativeProjectAccess.value = {
      userId: 'airlock-native-user-42',
      forProject: vi.fn(async () => { throw new Error('native_project_access_unavailable'); }),
    };
    const outage = await GET(getRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!outage) throw new Error('native outage response missing');
    expect(outage.status).toBe(503);
    expect(await outage.json()).toEqual({ error: 'project access could not be verified' });

    mocks.nativeProjectAccess.value = {
      userId: 'airlock-native-user-42',
      forProject: vi.fn(async () => { throw new Error('native_project_access_denied'); }),
    };
    const denied = await GET(getRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!denied) throw new Error('native denied response missing');
    expect(denied.status).toBe(404);
    expect(mocks.updateCard).not.toHaveBeenCalled();
    expect(mocks.callOwnerHerderTool).not.toHaveBeenCalled();
  });

  it('verifies a signed native PATCH after parsing while retaining signature, body, and project checks', async () => {
    const cardId = '550e8400-e29b-41d4-a716-446655440000';
    const pair = generateKeyPairSync('ed25519');
    const domain = Buffer.from('airlock-todo-native-identity-v1\n', 'utf8');
    const body = JSON.stringify({ action: 'sync-result', operationId: '1'.repeat(64), expectedVersion: baseCard.version });
    const pathFor = (project: string) => `/api/kanban/cards/${cardId}/execution?project=${encodeURIComponent(project)}`;
    const signedRequest = (project = 'Demo') => {
      const request = new NextRequest(`https://todo.example.test${pathFor(project)}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body,
      });
      const issuedAtMs = Date.now();
      const payload = { v: 1, userId: 'native-user-1', method: 'PATCH', path: requestPathAndQuery(request),
        bodySha256: createHash('sha256').update(body).digest('base64url'), project, issuedAtMs, expiresAtMs: issuedAtMs + 60_000 };
      const bytes = Buffer.from(JSON.stringify(payload));
      const assertion = `${bytes.toString('base64url')}.${sign(null, Buffer.concat([domain, bytes]), pair.privateKey).toString('base64url')}`;
      request.headers.set(AIRLOCK_TODO_NATIVE_IDENTITY_HEADER, assertion);
      return { request, assertion };
    };
    mocks.currentCard.value = { ...baseCard, id: cardId };
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const project = (JSON.parse(String(init?.body)) as { project: string }).project;
      return project === 'Demo'
        ? Response.json({ project, team: 'integrator', readAllowed: true, writeAllowed: true })
        : new Response(null, { status: 403 });
    });
    mocks.nativeProjectAccessContextFromRequest.mockImplementation(request => nativeProjectAccessForRequest(request, {
      endpoint: 'https://todo.example.test/internal/todo/project-scope', publicKey: pair.publicKey,
      fetcher: fetcher as unknown as typeof fetch,
    }));

    const valid = signedRequest();
    const response = await PATCH(valid.request, { params: Promise.resolve({ id: cardId }) });
    if (!response) throw new Error('signed native PATCH response missing');
    expect(response.status).toBe(404); // Signature and current project grant passed; no matching operation exists.
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(mocks.updateCard).not.toHaveBeenCalled();
    expect(mocks.callOwnerHerderTool).not.toHaveBeenCalled();

    const invalidSignature = signedRequest();
    const [payload, signature] = invalidSignature.assertion.split('.');
    invalidSignature.request.headers.set(AIRLOCK_TODO_NATIVE_IDENTITY_HEADER,
      `${payload}.${`${signature!.slice(0, -1)}${signature!.endsWith('A') ? 'B' : 'A'}`}`);
    const deniedSignature = await PATCH(invalidSignature.request, { params: Promise.resolve({ id: cardId }) });
    if (!deniedSignature) throw new Error('invalid native signature response missing');
    expect(deniedSignature.status).toBe(403);

    const signedBody = signedRequest();
    const mismatchedBody = new NextRequest(signedBody.request.url, {
      method: 'PATCH', headers: signedBody.request.headers,
      body: JSON.stringify({ action: 'sync-result', operationId: '2'.repeat(64), expectedVersion: baseCard.version }),
    });
    const deniedBody = await PATCH(mismatchedBody, { params: Promise.resolve({ id: cardId }) });
    if (!deniedBody) throw new Error('mismatched native body response missing');
    expect(deniedBody.status).toBe(403);

    const wrongProject = signedRequest('Other');
    const deniedProject = await PATCH(wrongProject.request, { params: Promise.resolve({ id: cardId }) });
    if (!deniedProject) throw new Error('wrong native project response missing');
    expect(deniedProject.status).toBe(404);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not map a legacy username receipt onto a native user id during PATCH recovery', async () => {
    const forProject = vi.fn(async () => ({ project: 'Demo', team: 'integrator', readAllowed: true as const, writeAllowed: true }));
    mocks.nativeProjectAccess.value = { userId: 'airlock-native-user-42', forProject };
    mocks.currentCard.value = { ...baseCard, taskExecutionHistory: [{
      operationId: canonicalQuestionOperationId, requestHash: 'f'.repeat(64), lastBoardVersion: baseCard.version,
      createInputId: 'create-input', messageInputId: 'message-input', phase: 'running', hostId: 'roomhacker-server-100',
      harness: 'codex', startedBy: 'nikita', createdAt: baseCard.created, updatedAt: baseCard.updated,
    }] };
    const response = await PATCH(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution', {
      method: 'PATCH', headers: { 'content-type': 'application/json', 'X-Airlock-Todo-Native-Identity': 'verified-test-assertion' },
      body: JSON.stringify({ action: 'sync-result', operationId: questionOperationId, expectedVersion: baseCard.version }),
    }), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('native legacy receipt response missing');
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/receipt owner does not match native identity/i) });
    expect(mocks.updateCard).not.toHaveBeenCalled();
    expect(mocks.callOwnerHerderTool).not.toHaveBeenCalled();
  });

  it('preserves an existing Board OAuth identity without re-resolving it as a human login', async () => {
    mocks.identity.value = { username: 'nikita', scope: 'work', accessToken: { clientId: 'board-client' } } as never;
    mocks.humanIdentity.value = null;
    const response = await GET(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution', {
      headers: { authorization: 'Bearer valid-board-oauth-token' },
    }), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('execution readiness response missing');
    expect(await response.json()).toMatchObject({ startAvailable: true });
    expect(mocks.boardHumanIdentityFromRequest).not.toHaveBeenCalled();
  });

  it('does not advertise start readiness to a verified non-owner', async () => {
    mocks.identity.value = { username: 'oleg', scope: 'work' };
    const response = await GET(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution'), {
      params: Promise.resolve({ id: baseCard.id }),
    });
    if (!response) throw new Error('execution response missing');
    expect(await response.json()).toMatchObject({
      startAvailable: false, unavailableReason: expect.stringMatching(/ответствен|исполнитель|доступ/i),
    });
    expect(mocks.callOwnerHerderTool).not.toHaveBeenCalled();
  });

  describe('automation token', () => {
    const secret = 'automation-secret-1234567890';
    const automationHeader = { 'x-kanban-automation-token': secret };
    const cardParams = () => ({ params: Promise.resolve({ id: baseCard.id }) });
    let previousToken: string | undefined;
    beforeEach(() => {
      previousToken = process.env.KANBAN_AUTOMATION_TOKEN;
      mocks.identity.value = null;
    });
    afterEach(() => {
      if (previousToken === undefined) delete process.env.KANBAN_AUTOMATION_TOKEN;
      else process.env.KANBAN_AUTOMATION_TOKEN = previousToken;
    });

    it('rejects automation requests when the token is unset or empty', async () => {
      delete process.env.KANBAN_AUTOMATION_TOKEN;
      expect((await POST(postRequest(undefined, automationHeader), cardParams())).status).toBe(401);
      process.env.KANBAN_AUTOMATION_TOKEN = '';
      expect((await POST(postRequest(undefined, automationHeader), cardParams())).status).toBe(401);
      expect(mocks.updateCard).not.toHaveBeenCalled();
      expect(mocks.callOwnerHerderTool).not.toHaveBeenCalled();
    });

    it('rejects a wrong or missing automation token', async () => {
      process.env.KANBAN_AUTOMATION_TOKEN = secret;
      expect((await POST(postRequest(undefined, { 'x-kanban-automation-token': 'automation-secret-0000000000' }), cardParams())).status).toBe(401);
      expect((await POST(postRequest(), cardParams())).status).toBe(401);
      expect(mocks.updateCard).not.toHaveBeenCalled();
      expect(mocks.callOwnerHerderTool).not.toHaveBeenCalled();
    });

    it('starts the card as its owner with a valid token', async () => {
      process.env.KANBAN_AUTOMATION_TOKEN = secret;
      mocks.currentCard.value = { ...baseCard, owner: 'testlogin' };
      const response = await POST(postRequest(undefined, automationHeader), cardParams());
      expect(response.status).toBe(201);
      expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.startedBy).toBe('testlogin');
    });

    it('admits a valid token to the answer action only', async () => {
      process.env.KANBAN_AUTOMATION_TOKEN = secret;
      const answer = await PATCH(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution', {
        method: 'PATCH', headers: { 'content-type': 'application/json', ...automationHeader },
        body: JSON.stringify({ action: 'answer-question', operationId: questionOperationId, expectedVersion: 4, value: 'yes' }),
      }), cardParams());
      expect([401, 403]).not.toContain(answer.status);

      const otherAction = await PATCH(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution', {
        method: 'PATCH', headers: { 'content-type': 'application/json', ...automationHeader },
        body: JSON.stringify({ action: 'session-stop', operationId: 'b'.repeat(64), expectedVersion: 4 }),
      }), cardParams());
      expect(otherAction.status).toBe(401);
      expect(mocks.callOwnerHerderTool).not.toHaveBeenCalled();
    });

    it('admits a valid token to the result sync action and still rejects session-stop', async () => {
      process.env.KANBAN_AUTOMATION_TOKEN = secret;
      const sync = await PATCH(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution', {
        method: 'PATCH', headers: { 'content-type': 'application/json', ...automationHeader },
        body: JSON.stringify({ action: 'sync-result', operationId: questionOperationId, expectedVersion: 4 }),
      }), cardParams());
      expect([401, 403]).not.toContain(sync.status);

      const stop = await PATCH(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution', {
        method: 'PATCH', headers: { 'content-type': 'application/json', ...automationHeader },
        body: JSON.stringify({ action: 'session-stop', operationId: 'b'.repeat(64), expectedVersion: 4 }),
      }), cardParams());
      expect(stop.status).toBe(401);
    });
  });

  it('does not start a task from the anonymous display persona alone', async () => {
    mocks.identity.value = null;
    const response = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('task execution response missing');
    expect(response.status).toBe(401);
    expect(mocks.updateCard).not.toHaveBeenCalled();
    expect(mocks.callOwnerHerderTool).not.toHaveBeenCalled();
  });

  it('marks start unavailable when the protected owner channel is missing', async () => {
    delete process.env.AGENT_HERDER_HTTP_TOKEN;
    const response = await GET(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution'), {
      params: Promise.resolve({ id: baseCard.id }),
    });
    if (!response) throw new Error('execution response missing');
    expect(await response.json()).toMatchObject({ startAvailable: false, unavailableReason: expect.any(String) });
  });

  it('denies a new start before any owner call when the retained receipt history is full', async () => {
    mocks.currentCard.value = {
      ...baseCard,
      taskExecutionHistory: Array.from({ length: 32 }, (_, index) => ({
        operationId: `operation-${index}`,
        requestHash: `request-${index}`,
        lastBoardVersion: baseCard.version,
        createInputId: `create-${index}`,
        messageInputId: `dispatch-${index}`,
        phase: 'result' as const,
        hostId: 'roomhacker-server-100',
        harness: 'codex' as const,
        startedBy: 'nikita',
        createdAt: baseCard.created,
        updatedAt: baseCard.updated,
      })),
    };
    const ready = await GET(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution'), {
      params: Promise.resolve({ id: baseCard.id }),
    });
    if (!ready) throw new Error('execution readiness response missing');
    expect(await ready.json()).toMatchObject({ startAvailable: false, unavailableReason: expect.stringMatching(/истори/i) });

    const response = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('task execution response missing');
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/истори/i) });
    expect(mocks.callOwnerHerderTool).not.toHaveBeenCalled();
    expect(mocks.updateCard).not.toHaveBeenCalled();
  });

  it('accepts only stable operation and expected version; host, CWD and project are server derived', async () => {
    mocks.currentCard.value = { ...baseCard, project: 'canonical-project-from-card' };
    const response = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('task execution response missing');
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ state: 'running', operationId: expect.any(String), retryable: false });
    expect(mocks.callOwnerHerderTool.mock.calls.map(([tool]) => tool)).toEqual([
      'fleet_node_info', 'fleet_create_session', 'agent_info', 'send_message',
    ]);
    expect(mocks.callOwnerHerderTool.mock.calls[1]?.[1]).toMatchObject({
      harness: 'codex', cwd: scopedProjectRoot, model: 'gpt-6-luna', project: 'canonical-project-from-card',
      projectReadinessContract: 'integrator-host-readiness-v1',
      projectReadiness: expect.objectContaining({ projectId: 'canonical-project-from-card', projectRoot: scopedProjectRoot, rootIdentity: 'exmanager-workspace-root-v1' }),
    });
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]).toMatchObject({
      hostId: 'roomhacker-server-100', phase: 'running', nativeTurnId: 'turn-1',
      lastBoardVersion: mocks.currentCard.value?.version,
    });
    expect(mocks.currentCard.value?.column).toBe('in-progress');
    expect(mocks.updateCard).toHaveBeenCalledTimes(3);
  });

  it('does not persist intent or create when project-scoped readiness is absent, stale, or mismatched', async () => {
    const invalid = [
      { hostId: 'roomhacker-server-100', nativeUser: 'operator' },
      scopedReadiness('Demo', { state: 'not_ready' }),
      scopedReadiness('another-project'),
      scopedReadiness('Demo', { observedAtMs: Date.now() - 31_000 }),
      scopedReadiness('Demo', { availableTools: [] }),
      scopedReadiness('Demo', { cwd: '/other/root' }),
      scopedReadiness('Demo', { pathResolution: { requestedCwd: '/other/absolute/path', canonicalCwd: scopedProjectRoot, rootPath: scopedProjectRoot, contained: true, identityMatches: true } }),
    ];
    for (const readiness of invalid) {
      mocks.projectReadinessOverride.value = readiness;
      mocks.updateCard.mockClear();
      mocks.callOwnerHerderTool.mockClear();
      const response = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
      if (!response) throw new Error('readiness response missing');
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ state: 'not_attempted' });
      expect(mocks.updateCard).not.toHaveBeenCalled();
      expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'fleet_create_session')).toHaveLength(0);
    }
  });

  it('launches the harness and model of the project route the herder reported', async () => {
    mocks.projectRouteOverride.value = { harness: 'opencode', model: 'omniroute/minimax-combo-m3.1', state: 'ready' };
    const response = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('task execution response missing');
    const creates = mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'fleet_create_session');
    expect(creates).toHaveLength(1);
    expect(creates[0]![1]).toMatchObject({ harness: 'opencode', model: 'omniroute/minimax-combo-m3.1' });
  });

  it('keeps a codex project route on the codex harness and model', async () => {
    const response = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('task execution response missing');
    const creates = mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'fleet_create_session');
    expect(creates).toHaveLength(1);
    expect(creates[0]![1]).toMatchObject({ harness: 'codex', model: 'gpt-6-luna' });
  });

  it('refuses a launch with a concrete reason when the project route is not named', async () => {
    for (const route of [
      { state: 'unavailable', reason: 'project_route_unconfigured' },
      { state: 'ready', harness: 'unknown-harness', model: 'gpt-6-luna' },
    ]) {
      mocks.projectRouteOverride.value = route;
      mocks.updateCard.mockClear();
      mocks.callOwnerHerderTool.mockClear();
      const response = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
      if (!response) throw new Error('task execution response missing');
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ state: 'not_attempted' });
      expect(mocks.updateCard).not.toHaveBeenCalled();
      expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'fleet_create_session')).toHaveLength(0);
    }
  });

  it('rejects extra browser-supplied execution configuration before any write', async () => {
    for (const extra of [
      { hostId: 'forged', cwd },
      { project: 'attacker-controlled-project' },
    ]) {
      const response = await POST(postRequest({ operationId, expectedVersion: 4, ...extra }), {
        params: Promise.resolve({ id: baseCard.id }),
      });
      if (!response) throw new Error('task execution response missing');
      expect(response.status).toBe(400);
    }
    expect(mocks.updateCard).not.toHaveBeenCalled();
    expect(mocks.callOwnerHerderTool).not.toHaveBeenCalled();
  });

  it('keeps an admitted dispatch unknown when the owner receipt lacks its native turn ID', async () => {
    mocks.callOwnerHerderTool.mockImplementation((tool: string, args: Record<string, unknown>) => {
      if (tool === 'send_message') {
        return { content: [{ type: 'text', text: `Native admission receipt: ${JSON.stringify({ admitted: true, inputId: args.inputId })}` }] };
      }
      return toolResult(tool, args);
    });
    const response = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('task execution response missing');
    expect(response.status).toBe(202);
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.phase).toBe('dispatch-unknown');
    expect(mocks.currentCard.value?.column).toBe('todo');
  });

  it('unwraps an observed Herder envelope before accepting the initial dispatch receipt', async () => {
    mocks.callOwnerHerderTool.mockImplementation((tool: string, args: Record<string, unknown>) => tool === 'send_message'
      ? observedHerderDelivery(`Native admission receipt: ${JSON.stringify({ admitted: true, inputId: args.inputId, turnId: 'turn-envelope' })}`, String(args.inputId), {
        hostId: 'roomhacker-server-100', harness: String(args.harness), sessionId: String(args.sessionId),
      })
      : toolResult(tool, args));

    const response = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('initial dispatch response missing');
    expect(response.status).toBe(201);
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]).toMatchObject({
      phase: 'running', nativeTurnId: 'turn-envelope', dispatchReceiptText: expect.stringContaining('Native admission receipt:'),
    });
  });

  it('replays the exact stable operation after its own version writes and refuses a later card edit', async () => {
    const first = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!first) throw new Error('first task execution response missing');
    expect(first.status).toBe(201);
    const writeCount = mocks.updateCard.mock.calls.length;
    const replay = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!replay) throw new Error('task execution replay response missing');
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ replay: true, state: 'running' });
    expect(mocks.updateCard).toHaveBeenCalledTimes(writeCount);
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'fleet_create_session')).toHaveLength(1);

    mocks.currentCard.value = { ...mocks.currentCard.value!, version: mocks.currentCard.value!.version + 1, tags: ['unrelated edit'] };
    const staleReplay = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!staleReplay) throw new Error('stale task execution response missing');
    expect(staleReplay.status).toBe(409);
    expect(mocks.updateCard).toHaveBeenCalledTimes(writeCount);
  });

  it('does not relaunch an existing UNKNOWN receipt to add project scope retroactively', async () => {
    const canonicalOperationId = createHash('sha256').update(`${baseCard.id}\0${operationId}`).digest('hex');
    const requestHash = createHash('sha256').update(JSON.stringify({
      id: baseCard.id, title: baseCard.title, description: baseCard.description, project: baseCard.project,
      owner: baseCard.owner ?? 'nikita', assignee: baseCard.assignee ?? null, assignees: baseCard.assignees,
      actor: 'nikita', hostId: 'roomhacker-server-100', harness: 'codex', cwd, model: 'gpt-6-luna',
    })).digest('hex');
    mocks.currentCard.value = { ...baseCard, taskExecutionHistory: [{
      operationId: canonicalOperationId, requestHash, lastBoardVersion: baseCard.version, createInputId: 'create-input',
      messageInputId: 'dispatch-input', phase: 'create-unknown', hostId: 'roomhacker-server-100',
      harness: 'codex', startedBy: 'nikita', createdAt: baseCard.created, updatedAt: baseCard.updated,
    }] };

    const response = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('UNKNOWN replay response missing');
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ replay: true, operationId: canonicalOperationId });
    expect(mocks.updateCard).not.toHaveBeenCalled();
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'fleet_create_session')).toHaveLength(0);
  });

  it('recovers the same idle native session after a pre-dispatch metadata mismatch without creating another session', async () => {
    let mismatchFirstInfo = true;
    mocks.callOwnerHerderTool.mockImplementation((tool: string, args: Record<string, unknown>) => {
      if (tool === 'agent_info' && mismatchFirstInfo) {
        mismatchFirstInfo = false;
        return { structuredContent: { session: { ...mocks.sessionInfo.value, cwd: '/wrong/qa/path' } }, content: [] };
      }
      return toolResult(tool, args);
    });

    const first = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!first) throw new Error('first task execution response missing');
    expect(first.status).toBe(409);
    expect(await first.json()).toMatchObject({ state: 'stopped', retryable: false });
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]).toMatchObject({
      phase: 'stopped', nativeSessionId: sessionId,
      lastProgress: 'Сессия создана, но её точный проект/model/session readback не совпал; задание не отправлено.',
    });

    const current = mocks.currentCard.value!;
    const recovery = await POST(postRequest({ operationId, expectedVersion: current.version }), { params: Promise.resolve({ id: baseCard.id }) });

    if (!recovery) throw new Error('same-session dispatch response missing');
    expect(recovery.status).toBe(200);
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]).toMatchObject({
      phase: 'running', nativeSessionId: sessionId, nativeTurnId: 'turn-1',
    });
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'fleet_create_session')).toHaveLength(1);
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'send_message')).toHaveLength(1);
    expect(mocks.callOwnerHerderTool.mock.calls.find(([tool]) => tool === 'send_message')?.[1]).toMatchObject({
      inputId: mocks.currentCard.value?.taskExecutionHistory?.[0]?.messageInputId,
      sessionId,
    });
  });

  it('continues the same OpenCode session only after the exact typed not-attempted receipt', async () => {
    mocks.projectRouteOverride.value = { state: 'ready', harness: 'opencode', model: 'omniroute/minimax-combo-m3.1' };
    const sent: Array<Record<string, unknown>> = [];
    mocks.callOwnerHerderTool.mockImplementation((tool: string, args: Record<string, unknown>) => {
      if (tool !== 'send_message') return toolResult(tool, args);
      sent.push(args);
      if (sent.length === 1) return { content: [{ type: 'text', text: JSON.stringify({
        ok: false, delivery: 'not_attempted', inputId: args.inputId, nonRetryable: true,
        error: 'Вставка в текущий ход для этого агента пока не поддерживается. Выберите «После ответа».',
      }) }] };
      return { content: [{ type: 'text', text: `Native admission receipt: ${JSON.stringify({
        admitted: true, inputId: args.inputId, turnId: 'queued-turn-1',
      })}` }] };
    });

    const first = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!first) throw new Error('first typed-refusal response missing');
    expect(first.status).toBe(202);
    const prior = mocks.currentCard.value!.taskExecutionHistory![0]!;
    expect(prior).toMatchObject({ phase: 'dispatch-unknown', nativeSessionId: sessionId, messageInputId: createHash('sha256').update(`${prior.operationId}\0dispatch`).digest('hex') });
    expect(JSON.parse(prior.dispatchReceiptText!)).toMatchObject({ delivery: 'not_attempted', nonRetryable: true, inputId: prior.messageInputId });

    const current = mocks.currentCard.value!;
    const continued = await POST(postRequest({ operationId, expectedVersion: current.version }), { params: Promise.resolve({ id: baseCard.id }) });
    if (!continued) throw new Error('same-session queued continuation response missing');
    expect(await continued.clone().json()).toMatchObject({ state: 'running' });
    expect(continued.status).toBe(200);
    const receipt = mocks.currentCard.value?.taskExecutionHistory?.[0];
    const queueInputId = createHash('sha256').update(`${prior.operationId}\0dispatch-after-not-attempted`).digest('hex');
    expect(receipt).toMatchObject({ phase: 'running', nativeSessionId: sessionId, nativeTurnId: 'queued-turn-1', messageInputId: queueInputId });
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ sessionId, harness: 'opencode', mode: 'queue', humanRequested: true });
    expect(sent[1]).toMatchObject({ sessionId, harness: 'opencode', mode: 'queue', humanRequested: true, inputId: queueInputId });
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'fleet_create_session')).toHaveLength(1);
  });

  it('reconciles a queued OpenCode send from the bound native messages without replay', async () => {
    mocks.projectRouteOverride.value = { state: 'ready', harness: 'opencode', model: 'omniroute/minimax-combo-m3.1' };
    const sent: Array<Record<string, unknown>> = [];
    mocks.callOwnerHerderTool.mockImplementation((tool: string, args: Record<string, unknown>) => {
      if (tool !== 'send_message') return toolResult(tool, args);
      sent.push(args);
      if (sent.length === 1) return { content: [{ type: 'text', text: JSON.stringify({
        ok: false, delivery: 'not_attempted', inputId: args.inputId, nonRetryable: true,
        error: 'Вставка в текущий ход для этого агента пока не поддерживается. Выберите «После ответа».',
      }) }] };
      throw new Error('simulated queue transport outcome unknown');
    });

    const first = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!first) throw new Error('typed-refusal start response missing');
    const currentAfterRefusal = mocks.currentCard.value!;
    const continued = await POST(postRequest({ operationId, expectedVersion: currentAfterRefusal.version }), { params: Promise.resolve({ id: baseCard.id }) });
    if (!continued) throw new Error('queue dispatch response missing');
    expect(continued.status).toBe(202);
    const receiptAfterUnknown = mocks.currentCard.value?.taskExecutionHistory?.[0];
    const queueInputId = createHash('sha256').update(`${receiptAfterUnknown?.operationId}\0dispatch-after-not-attempted`).digest('hex');
    expect(receiptAfterUnknown).toMatchObject({ phase: 'dispatch-unknown', nativeSessionId: sessionId, messageInputId: queueInputId });
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ sessionId, harness: 'opencode', mode: 'queue', humanRequested: true, inputId: queueInputId });

    const taskMessage = String(sent[1]!.message);
    let nativeMessages: Array<Record<string, unknown>> = [
      { id: opencodeInputMessageId(queueInputId), role: 'user', inputId: queueInputId,
        text: taskMessage, parts: [{ type: 'text', text: taskMessage }] },
      { id: 'qa-assistant-progress', role: 'assistant', phase: 'tool-calls', text: 'Читаю только синтетические строки.', parts: [] },
    ];
    const firstUserUri = `herder://sessions/opencode/${sessionId}/first-user-message`;
    const firstUserMessage = { id: opencodeInputMessageId(queueInputId), role: 'user', inputId: queueInputId,
      parts: [{ type: 'text', text: taskMessage }] };
    const messagesUri = `herder://sessions/opencode/${sessionId}/messages`;
    mocks.readOwnerHerderResource.mockImplementation(async (uri: string) => ({ contents: [{ uri, mimeType: 'application/json',
      text: JSON.stringify(uri === firstUserUri ? firstUserMessage : nativeMessages),
    }] }));
    mocks.sessionInfo.value = { ...mocks.sessionInfo.value, status: 'running', meta: {} };
    let current = mocks.currentCard.value!;
    const progress = await PATCH(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'sync-result', operationId, expectedVersion: current.version }),
    }), { params: Promise.resolve({ id: baseCard.id }) });
    if (!progress) throw new Error('same-session progress sync response missing');
    expect(progress.status).toBe(202);
    expect(await progress.json()).toMatchObject({ state: 'running' });
    expect(mocks.currentCard.value?.column).toBe('in-progress');
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]).toMatchObject({
      phase: 'running', nativeSessionId: sessionId,
      lastProgress: 'Подтверждённая доставка связана с точным сообщением этой карточки; исполнитель работает.',
    });

    nativeMessages = [
      nativeMessages[0]!,
      { id: 'qa-assistant-result', role: 'assistant', phase: 'stop',
        text: 'reasoning нельзя показывать\nТаблица A 1200, B 800, C 500. Итог: 2500. Для A ожидается файл; B проверяет участник; C сверяет таблицу.',
        parts: [{ type: 'thinking', text: 'reasoning нельзя показывать' }, { type: 'text', text: 'Таблица A 1200, B 800, C 500. Итог: 2500. Для A ожидается файл; B проверяет участник; C сверяет таблицу.' }] },
    ];
    mocks.sessionInfo.value = { ...mocks.sessionInfo.value, status: 'idle', meta: {} };
    mocks.validateTransition.mockImplementation((_card: KanbanCard, input: { executorResult?: { summary?: string } }) => ({
      kind: 'redirected', patch: { column: 'review', needsReview: true, resultHistory: [{
        summary: input.executorResult?.summary ?? '', evidenceRefs: [], submittedBy: 'nikita', submittedAt: '2026-10-20T10:06:00.000Z',
      }] },
    }));
    current = mocks.currentCard.value!;
    const result = await PATCH(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'sync-result', operationId, expectedVersion: current.version }),
    }), { params: Promise.resolve({ id: baseCard.id }) });
    if (!result) throw new Error('same-session result sync response missing');
    expect(result.status).toBe(200);
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.phase).toBe('result');
    expect(mocks.currentCard.value?.column).toBe('review');
    expect(mocks.currentCard.value?.resultHistory?.at(-1)?.summary).toContain('Итог: 2500');
    expect(mocks.currentCard.value?.resultHistory?.at(-1)?.summary).not.toContain('reasoning нельзя показывать');
    expect(mocks.readOwnerHerderResource).toHaveBeenCalledWith(messagesUri);
    expect(sent).toHaveLength(2);
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'fleet_create_session')).toHaveLength(1);
  });

  it('promotes an OpenCode admission only from its accepted delivery job and matching native user message', async () => {
    mocks.projectRouteOverride.value = { state: 'ready', harness: 'opencode', model: 'omniroute/minimax-combo-m3.1' };
    const nativeInputMessageId = 'msg_17f4466d6001AtmOc1CmXoVyJf';
    let inputId = '';
    let sendCount = 0;
    mocks.callOwnerHerderTool.mockImplementation((tool: string, args: Record<string, unknown>) => {
      if (tool === 'send_message') {
        sendCount += 1;
        inputId = String(args.inputId);
        if (sendCount === 1) return { content: [{ type: 'text', text: JSON.stringify({
          ok: false, delivery: 'not_attempted', nonRetryable: true, inputId,
          error: 'Вставка в текущий ход для этого агента пока не поддерживается. Выберите «После ответа».',
        }) }] };
        return { content: [{ type: 'text', text: `Message accepted by [opencode] ${sessionId}; native turn start is still being verified.` }] };
      }
      if (tool === 'job_get') {
        const exactJobId = `job_${createHash('sha256').update(['user-message', 'opencode', sessionId, inputId].join('\0')).digest('hex')}`;
        expect(args).toEqual({ jobId: exactJobId });
        return { structuredContent: { job: {
          id: exactJobId, kind: 'Доставка сообщения', state: 'completed', ownerSessionId: sessionId,
          onceKey: ['user-message', 'opencode', sessionId, inputId].join('\0'),
          result: { ok: true, admitted: true, admission: 'accepted', inputId, nativeInputMessageId },
        } }, content: [] };
      }
      return toolResult(tool, args);
    });

    const refused = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!refused) throw new Error('OpenCode execution response missing');
    expect(refused.status).toBe(202);
    const beforeQueue = mocks.currentCard.value!;
    const started = await POST(postRequest({ operationId, expectedVersion: beforeQueue.version }), { params: Promise.resolve({ id: baseCard.id }) });
    if (!started) throw new Error('OpenCode queued execution response missing');
    expect(started.status).toBe(202);
    const initial = mocks.currentCard.value!.taskExecutionHistory![0]!;
    const taskMessage = String(mocks.callOwnerHerderTool.mock.calls.find(([tool]) => tool === 'send_message')?.[1]?.message);
    const firstUserUri = `herder://sessions/opencode/${sessionId}/first-user-message`;
    const firstUserMessage = { id: nativeInputMessageId, inputId: initial.messageInputId, role: 'user',
      parts: [{ type: 'text', text: `Поручение пользователя, переданное агентом\n\n${taskMessage}` }] };
    mocks.sessionInfo.value = { ...mocks.sessionInfo.value, status: 'running', harness: 'opencode', model: 'omniroute/minimax-combo-m3.1' };
    const nativeMessages = [{ id: nativeInputMessageId, inputId: initial.messageInputId, role: 'user',
      parts: [{ type: 'text', text: `Поручение пользователя, переданное агентом\n\n${taskMessage}` }] }];
    mocks.readOwnerHerderResource.mockImplementation(async (uri: string) => ({ contents: [{ uri, mimeType: 'application/json',
      text: JSON.stringify(uri === firstUserUri ? firstUserMessage : nativeMessages),
    }] }));
    const response = await PATCH(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'sync-result', operationId, expectedVersion: mocks.currentCard.value!.version }),
    }), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('OpenCode admission readback response missing');

    expect(response.status).toBe(202);
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]).toMatchObject({
      phase: 'running', harness: 'opencode', nativeSessionId: sessionId,
      nativeDispatchJobId: expect.stringMatching(/^job_[a-f0-9]{64}$/), nativeInputMessageId,
    });
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.nativeTurnId).toBeUndefined();

    const recovered = await PATCH(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'sync-result', operationId: initial.operationId, expectedVersion: mocks.currentCard.value!.version }),
    }), { params: Promise.resolve({ id: baseCard.id }) });
    if (!recovered) throw new Error('durable receipt sync response missing');
    expect(recovered.status).toBe(202);
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'fleet_create_session')).toHaveLength(1);
    expect(sendCount).toBe(2);
  });

  it('reconciles an exact accepted OpenCode dispatch while its native session is idle', async () => {
    mocks.projectRouteOverride.value = { state: 'ready', harness: 'opencode', model: 'omniroute/minimax-combo-m3.1' };
    const nativeInputMessageId = 'msg_17f4466d6001AtmOc1CmXoVyJf';
    let sendCount = 0;
    mocks.callOwnerHerderTool.mockImplementation((tool: string, args: Record<string, unknown>) => {
      if (tool === 'send_message') {
        sendCount += 1;
        return { content: [{ type: 'text', text: `Message accepted by [opencode] ${sessionId}; native turn start is still being verified.` }] };
      }
      if (tool === 'job_get') {
        const inputId = mocks.currentCard.value?.taskExecutionHistory?.[0]?.messageInputId;
        if (typeof inputId !== 'string') throw new Error('saved OpenCode input id missing');
        const jobId = userMessageJobId(sessionId, inputId);
        expect(args).toEqual({ jobId });
        return { structuredContent: { job: {
          id: jobId, kind: 'Доставка сообщения', state: 'completed', ownerSessionId: sessionId,
          onceKey: ['user-message', 'opencode', sessionId, inputId].join('\0'),
          result: { ok: true, admitted: true, inputId, nativeInputMessageId },
        } }, content: [] };
      }
      return toolResult(tool, args);
    });

    const started = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!started) throw new Error('OpenCode execution response missing');
    expect(started.status).toBe(202);
    const initial = mocks.currentCard.value!.taskExecutionHistory![0]!;
    expect(initial.phase).toBe('dispatch-unknown');
    expect(initial.messageInputId).toBe(createHash('sha256').update(`${initial.operationId}\0dispatch`).digest('hex'));

    const model = 'omniroute/minimax-combo-m3.1';
    mocks.sessionInfo.value = { ...mocks.sessionInfo.value, status: 'idle', harness: 'opencode', model };
    const taskMessage = String(mocks.callOwnerHerderTool.mock.calls.find(([tool]) => tool === 'send_message')?.[1]?.message);
    const firstUserUri = `herder://sessions/opencode/${sessionId}/first-user-message`;
    const firstUserMessage = { id: nativeInputMessageId, inputId: initial.messageInputId, role: 'user',
      parts: [{ type: 'text', text: `Поручение пользователя, переданное агентом\n\n${taskMessage}` }] };
    const nativeMessages = [{ id: nativeInputMessageId, inputId: initial.messageInputId, role: 'user',
      parts: [{ type: 'text', text: `Поручение пользователя, переданное агентом\n\n${taskMessage}` }] }];
    mocks.readOwnerHerderResource.mockImplementation(async (uri: string) => ({ contents: [{ uri, mimeType: 'application/json',
      text: JSON.stringify(uri === firstUserUri ? firstUserMessage : nativeMessages),
    }] }));

    const response = await PATCH(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'sync-result', operationId, expectedVersion: mocks.currentCard.value!.version }),
    }), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('OpenCode dispatch reconciliation response missing');

    expect(response.status).toBe(202);
    expect(mocks.currentCard.value?.column).toBe('todo');
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]).toMatchObject({
      phase: 'waiting', harness: 'opencode', nativeSessionId: sessionId,
      nativeDispatchJobId: userMessageJobId(sessionId, initial.messageInputId), nativeInputMessageId,
    });
    expect(sendCount).toBe(1);
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'fleet_create_session')).toHaveLength(1);
  });

  it('allows direct only from an exact operation-bound idle admission saved as waiting', async () => {
    const card = controllableOpenCodeCard();
    const receipt = card.taskExecutionHistory![0]!;
    const inputId = createHash('sha256').update(`${receipt.operationId}\0dispatch`).digest('hex');
    const nativeInputMessageId = 'msg_idle_admission_123456';
    const admittedReceipt = {
      ...receipt, phase: 'waiting' as const, messageInputId: inputId,
      nativeDispatchJobId: userMessageJobId(controlSessionId, inputId), nativeInputMessageId,
      lastProgress: 'Исходная доставка подтверждена; нативная сессия простаивает. Результат не принят.',
    };
    mocks.currentCard.value = { ...card, taskExecutionHistory: [admittedReceipt] };
    mocks.sessionInfo.value = { ...mocks.sessionInfo.value, status: 'idle' };
    let nativeMessages: Array<Record<string, unknown>> = [];
    mocks.readOwnerHerderResource.mockImplementation(async (uri: string) => ({ contents: [{
      uri, mimeType: 'application/json', text: JSON.stringify(nativeMessages),
    }] }));
    mocks.callOwnerHerderTool.mockImplementation((tool: string, args: Record<string, unknown>) => {
      if (tool === 'send_message') {
        nativeMessages.push({ id: opencodeInputMessageId(String(args.inputId)), inputId: args.inputId,
          role: 'user', parts: [{ type: 'text', text: String(args.message) }] });
      }
      return toolResult(tool, args);
    });

    const response = await PATCH(sessionControlRequest({ action: 'session-direct', expectedVersion: card.version,
      message: 'Продолжи ту же задачу' }), { params: Promise.resolve({ id: controlCardId }) });
    if (!response) throw new Error('idle admission direct response missing');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ boardOperationId: controlOperationId, action: 'direct', state: 'accepted' });
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.sessionControls?.direct?.[0]).toMatchObject({
      phase: 'accepted', nativeDispatchJobId: expect.stringMatching(/^job_[a-f0-9]{64}$/),
      nativeInputMessageId: expect.stringMatching(/^msg_[A-Za-z0-9_-]{8,256}$/),
    });
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'fleet_create_session')).toHaveLength(0);
  });

  it('keeps an OpenCode dispatch unknown when the accepted job is bound to another input', async () => {
    mocks.projectRouteOverride.value = { state: 'ready', harness: 'opencode', model: 'omniroute/minimax-combo-m3.1' };
    const nativeInputMessageId = 'msg_17f4466d6001AtmOc1CmXoVyJf';
    let sendCount = 0;
    mocks.callOwnerHerderTool.mockImplementation((tool: string, args: Record<string, unknown>) => {
      if (tool === 'send_message') {
        sendCount += 1;
        return { content: [{ type: 'text', text: `Message accepted by [opencode] ${sessionId}; native turn start is still being verified.` }] };
      }
      if (tool === 'job_get') {
        const wrongInputId = 'f'.repeat(64);
        return { structuredContent: { job: {
          id: args.jobId, kind: 'Доставка сообщения', state: 'completed', ownerSessionId: sessionId,
          onceKey: ['user-message', 'opencode', sessionId, wrongInputId].join('\0'),
          result: { ok: true, admitted: true, inputId: wrongInputId, nativeInputMessageId },
        } }, content: [] };
      }
      return toolResult(tool, args);
    });

    const started = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!started) throw new Error('OpenCode execution response missing');
    expect(started.status).toBe(202);
    const initial = mocks.currentCard.value!.taskExecutionHistory![0]!;
    mocks.sessionInfo.value = { ...mocks.sessionInfo.value, status: 'running', harness: 'opencode', model: 'omniroute/minimax-combo-m3.1' };

    const response = await PATCH(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'sync-result', operationId, expectedVersion: mocks.currentCard.value!.version }),
    }), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('OpenCode dispatch readback response missing');

    expect(response.status).toBe(202);
    expect(mocks.currentCard.value?.column).toBe('todo');
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]).toMatchObject({
      phase: 'dispatch-unknown', operationId: initial.operationId, messageInputId: initial.messageInputId,
    });
    expect(mocks.readOwnerHerderResource).not.toHaveBeenCalled();
    expect(sendCount).toBe(1);
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'fleet_create_session')).toHaveLength(1);
  });

  it('does not promote an accepted OpenCode input whose ID was not derived from this board operation', async () => {
    mocks.projectRouteOverride.value = { state: 'ready', harness: 'opencode', model: 'omniroute/minimax-combo-m3.1' };
    const nativeInputMessageId = 'msg_17f4466d6001AtmOc1CmXoVyJf';
    const alternateInputId = 'f'.repeat(64);
    mocks.callOwnerHerderTool.mockImplementation((tool: string, args: Record<string, unknown>) => {
      if (tool === 'send_message') {
        return { content: [{ type: 'text', text: `Message accepted by [opencode] ${sessionId}; native turn start is still being verified.` }] };
      }
      if (tool === 'job_get') {
        const jobId = userMessageJobId(sessionId, alternateInputId);
        expect(args).toEqual({ jobId });
        return { structuredContent: { job: {
          id: jobId, kind: 'Доставка сообщения', state: 'completed', ownerSessionId: sessionId,
          onceKey: ['user-message', 'opencode', sessionId, alternateInputId].join('\0'),
          result: { ok: true, admitted: true, inputId: alternateInputId, nativeInputMessageId },
        } }, content: [] };
      }
      return toolResult(tool, args);
    });

    const started = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!started) throw new Error('OpenCode execution response missing');
    expect(started.status).toBe(202);
    const initialCard = mocks.currentCard.value!;
    const initial = initialCard.taskExecutionHistory![0]!;
    mocks.currentCard.value = { ...initialCard, taskExecutionHistory: [{ ...initial, messageInputId: alternateInputId }] };
    mocks.callOwnerHerderTool.mockClear();

    const response = await PATCH(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'sync-result', operationId, expectedVersion: mocks.currentCard.value!.version }),
    }), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('OpenCode dispatch readback response missing');

    expect(response.status).toBe(409);
    expect(mocks.currentCard.value?.column).toBe('todo');
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]).toMatchObject({
      phase: 'dispatch-unknown', operationId: initial.operationId, messageInputId: alternateInputId,
    });
    expect(mocks.callOwnerHerderTool).not.toHaveBeenCalled();
    expect(mocks.readOwnerHerderResource).not.toHaveBeenCalled();
  });

  it('stops and explicitly continues the same typed OpenCode session through the card control route', async () => {
    const model = 'omniroute/minimax-combo-m3.1';
    mocks.projectRouteOverride.value = { state: 'ready', harness: 'opencode', model };
    const rawProjectReadiness = scopedReadiness(baseCard.project).projectReadiness;
    const rawPaths = rawProjectReadiness.pathResolution;
    const projectBinding: NonNullable<NonNullable<KanbanCard['taskExecutionHistory']>[number]['projectBinding']> = {
      contract: 'integrator-host-readiness-v1', projectId: rawProjectReadiness.projectId,
      projectRoot: rawProjectReadiness.projectRoot, rootIdentity: rawProjectReadiness.rootIdentity,
      policyRevision: rawProjectReadiness.policyRevision, observedAtMs: rawProjectReadiness.observedAtMs,
      runtimeInstanceId: rawProjectReadiness.runtimeInstanceId, hostId: rawProjectReadiness.hostId,
      harness: 'opencode', harnessVersion: rawProjectReadiness.harnessVersion, model: rawProjectReadiness.model,
      requiredTools: rawProjectReadiness.requiredTools as string[], availableTools: rawProjectReadiness.availableTools as string[],
      availableModels: rawProjectReadiness.availableModels as string[], resourceReady: true, cwd: rawProjectReadiness.cwd,
      pathResolution: { ...rawPaths, contained: true, identityMatches: true },
    };
    const boardOperationId = createHash('sha256').update(`${baseCard.id}\0${operationId}`).digest('hex');
    const initialInputId = 'd'.repeat(64);
    const initialNativeInputId = 'msg_17f4466d6001AtmOc1CmXoVyJf';
    const initialJobId = `job_${createHash('sha256').update(['user-message', 'opencode', sessionId, initialInputId].join('\0')).digest('hex')}`;
    const continuationMessage = 'Продолжи эту же задачу после остановки: верни три синтетические строки, сумму 2500 и отдельно укажи, что именно ожидается.';
    const directRequestHash = createHash('sha256').update(JSON.stringify({
      cardId: baseCard.id, operationId: boardOperationId, action: 'direct', message: continuationMessage,
    })).digest('hex');
    const directJobId = `job_${createHash('sha256').update(['user-message', 'opencode', sessionId, directRequestHash].join('\0')).digest('hex')}`;
    const directNativeInputId = 'msg_17f4466d6001AtmOc1CmXoVyK';
    const finalContinuationMessage = 'Только итоговый Markdown: A 1200 ожидает тестовый файл, B 800 готова к проверке, C 500 в сверке таблицы. Итог 2500. Укажи требуемый файл и проверку участником. Не используй инструменты.';
    const finalDirectRequestHash = createHash('sha256').update(JSON.stringify({
      cardId: baseCard.id, operationId: boardOperationId, action: 'direct', message: finalContinuationMessage,
    })).digest('hex');
    const finalDirectJobId = `job_${createHash('sha256').update(['user-message', 'opencode', sessionId, finalDirectRequestHash].join('\0')).digest('hex')}`;
    const finalDirectNativeInputId = 'msg_17f4466d6001FinalQa';
    // The native messages projection is allowed to omit old user history; controls
    // reconcile the durable initial job/input IDs instead of requiring transcript replay.
    let nativeMessages: Array<Record<string, unknown>> = [];
    const messagesUri = `herder://sessions/opencode/${sessionId}/messages`;
    mocks.readOwnerHerderResource.mockImplementation(async (uri: string) => ({ contents: [{
      uri, mimeType: 'application/json', text: JSON.stringify(nativeMessages),
    }] }));
    mocks.currentCard.value = {
      ...baseCard, column: 'in-progress', version: 6,
      taskExecutionHistory: [{
        operationId: boardOperationId, requestHash: 'b'.repeat(64), lastBoardVersion: 6,
        createInputId: 'e'.repeat(64), messageInputId: initialInputId, phase: 'running',
        hostId: 'roomhacker-server-100', harness: 'opencode', projectBinding,
        nativeSessionId: sessionId, nativeDispatchJobId: initialJobId, nativeInputMessageId: initialNativeInputId,
        startedBy: 'nikita', createdAt: baseCard.created, updatedAt: baseCard.updated,
      }],
    };
    mocks.sessionInfo.value = {
      id: sessionId, harness: 'opencode', hostId: 'roomhacker-server-100', cwd: projectBinding.cwd,
      model, status: 'running', needsPermission: false, lastActivity: baseCard.updated,
    };
    mocks.callOwnerHerderTool.mockImplementation((tool: string, args: Record<string, unknown>) => {
      if (tool === 'job_get') {
        const initial = args.jobId === initialJobId;
        const final = args.jobId === finalDirectJobId;
        const inputId = initial ? initialInputId : final ? finalDirectRequestHash : directRequestHash;
        const nativeInputMessageId = initial ? initialNativeInputId : final ? finalDirectNativeInputId : directNativeInputId;
        const exactJobId = initial ? initialJobId : final ? finalDirectJobId : directJobId;
        return { structuredContent: { job: {
          id: exactJobId, kind: 'Доставка сообщения', state: 'completed', ownerSessionId: sessionId,
          onceKey: ['user-message', 'opencode', sessionId, inputId].join('\0'),
          result: { ok: true, admitted: true, admission: 'accepted', inputId, nativeInputMessageId },
        } }, content: [] };
      }
      if (tool === 'stop_agent') {
        mocks.sessionInfo.value = { ...mocks.sessionInfo.value, status: 'stopped' };
        return { content: [{ type: 'text', text: `Stopped agent [opencode] ${sessionId} on host 'roomhacker-server-100'.` }] };
      }
      if (tool === 'send_message') {
        const final = args.message === finalContinuationMessage;
        expect(args).toMatchObject({ sessionId, harness: 'opencode', inputId: final ? finalDirectRequestHash : directRequestHash, mode: 'queue', humanRequested: true });
        nativeMessages = [...nativeMessages, {
          id: final ? finalDirectNativeInputId : directNativeInputId,
          inputId: final ? finalDirectRequestHash : directRequestHash, role: 'user',
          parts: [{ type: 'text', text: final ? finalContinuationMessage : continuationMessage }],
        }];
        mocks.sessionInfo.value = { ...mocks.sessionInfo.value, status: 'running' };
        return { content: [{ type: 'text', text: `Message accepted by [opencode] ${sessionId}; native turn start is still being verified.` }] };
      }
      return toolResult(tool, args);
    });

    const stop = await PATCH(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'session-stop', expectedVersion: mocks.currentCard.value!.version }),
    }), { params: Promise.resolve({ id: baseCard.id }) });
    if (!stop) throw new Error('OpenCode stop response missing');
    if (stop.status !== 200) throw new Error(`OpenCode stop was refused: ${JSON.stringify(await stop.clone().json())}`);
    expect(stop.status).toBe(200);
    expect(await stop.json()).toMatchObject({ state: 'accepted', action: 'stop', boardOperationId });
    expect(mocks.readOwnerHerderResource).not.toHaveBeenCalled();
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]).toMatchObject({
      phase: 'stopped', nativeSessionId: sessionId,
      sessionControls: { stop: { phase: 'accepted' } },
    });
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.nativeTurnId).toBeUndefined();

    const continuation = await PATCH(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'session-direct', expectedVersion: mocks.currentCard.value!.version, message: continuationMessage }),
    }), { params: Promise.resolve({ id: baseCard.id }) });
    if (!continuation) throw new Error('same-session explicit continuation response missing');
    expect(continuation.status).toBe(200);
    expect(await continuation.json()).toMatchObject({ state: 'accepted', action: 'direct', boardOperationId });
    const receipt = mocks.currentCard.value?.taskExecutionHistory?.[0];
    expect(receipt).toMatchObject({ phase: 'running', nativeSessionId: sessionId });
    expect(receipt?.nativeTurnId).toBeUndefined();
    expect(receipt?.sessionControls?.direct?.[0]).toMatchObject({
      requestHash: directRequestHash, phase: 'accepted', nativeDispatchJobId: directJobId,
      nativeInputMessageId: directNativeInputId,
    });

    const repeatedStop = await PATCH(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'session-stop', expectedVersion: mocks.currentCard.value!.version }),
    }), { params: Promise.resolve({ id: baseCard.id }) });
    if (!repeatedStop) throw new Error('second OpenCode stop response missing');
    expect(repeatedStop.status).toBe(200);
    expect(await repeatedStop.json()).toMatchObject({ state: 'accepted', action: 'stop', boardOperationId });
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.sessionControls?.stops).toHaveLength(2);
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.sessionControls?.stops?.[0]?.requestHash)
      .not.toBe(mocks.currentCard.value?.taskExecutionHistory?.[0]?.sessionControls?.stops?.[1]?.requestHash);

    const finalContinuation = await PATCH(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'session-direct', expectedVersion: mocks.currentCard.value!.version, message: finalContinuationMessage }),
    }), { params: Promise.resolve({ id: baseCard.id }) });
    if (!finalContinuation) throw new Error('final same-session table instruction response missing');
    expect(finalContinuation.status).toBe(200);
    expect(await finalContinuation.json()).toMatchObject({ state: 'accepted', action: 'direct', boardOperationId });
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.sessionControls?.direct).toHaveLength(2);
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'fleet_create_session')).toHaveLength(0);
    expect(mocks.readOwnerHerderResource).toHaveBeenCalledWith(messagesUri);

    nativeMessages = [...nativeMessages, {
      id: 'msg_17f446789001PIjyje1dWmeMyw', role: 'assistant', phase: 'stop',
      nativeParentMessageId: finalDirectNativeInputId,
      parts: [
        { type: 'thinking', text: 'Скрытая мысль не должна попасть в карточку.' },
        { type: 'text', text: '| Заявка | Сумма | Состояние |\n| A | 1200 | ожидается файл |\n| B | 800 | ожидает проверки |\n| C | 500 | сверка таблицы |\n\nИтого: 2500.' },
      ],
    }];
    mocks.sessionInfo.value = { ...mocks.sessionInfo.value, status: 'idle' };
    mocks.validateTransition.mockImplementation((_card: KanbanCard, input: { executorResult?: { summary?: string } }) => ({
      kind: 'redirected', patch: { column: 'review', needsReview: true, resultHistory: [{
        summary: input.executorResult?.summary ?? '', evidenceRefs: [], submittedBy: 'nikita', submittedAt: '2026-10-28T00:00:00.000Z',
      }] },
    }));
    const result = await PATCH(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'sync-result', operationId, expectedVersion: mocks.currentCard.value!.version }),
    }), { params: Promise.resolve({ id: baseCard.id }) });
    if (!result) throw new Error('same-card continuation result readback missing');
    expect(result.status).toBe(200);
    expect(mocks.currentCard.value).toMatchObject({ column: 'review', needsReview: true });
    expect(mocks.currentCard.value?.resultHistory?.at(-1)?.summary).toContain('Итого: 2500');
    expect(mocks.currentCard.value?.resultHistory?.at(-1)?.summary).not.toContain('Скрытая мысль');
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]).toMatchObject({ phase: 'result', nativeSessionId: sessionId });
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.nativeTurnId).toBeUndefined();
  });

  it('does not attach a completed assistant message after another user input to the earlier card task', async () => {
    mocks.projectRouteOverride.value = { state: 'ready', harness: 'opencode', model: 'omniroute/minimax-combo-m3.1' };
    const first = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!first) throw new Error('first task execution response missing');
    const current = mocks.currentCard.value!;
    const taskMessage = String(mocks.callOwnerHerderTool.mock.calls.find(([tool]) => tool === 'send_message')?.[1]?.message);
    const messagesUri = `herder://sessions/opencode/${sessionId}/messages`;
    mocks.sessionInfo.value = { ...mocks.sessionInfo.value, status: 'idle', meta: {} };
    mocks.readOwnerHerderResource.mockResolvedValue({ contents: [{
      uri: messagesUri, mimeType: 'application/json', text: JSON.stringify([
        { id: 'qa-user-input', role: 'user', parts: [{ type: 'text', text: `Поручение пользователя, переданное агентом\n\n${taskMessage}` }] },
        { id: 'later-user-input', role: 'user', parts: [{ type: 'text', text: 'Другой пользовательский запрос' }] },
        { id: 'later-assistant-result', role: 'assistant', phase: 'stop', parts: [{ type: 'text', text: 'Ответ на другой запрос' }] },
      ]),
    }] });

    const response = await PATCH(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'sync-result', operationId, expectedVersion: current.version }),
    }), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('same-session result sync response missing');
    expect(response.status).toBe(202);
    expect(mocks.currentCard.value?.column).not.toBe('review');
    expect(mocks.currentCard.value?.resultHistory).toBeUndefined();
  });

  it('does not promote stale idle commentary while the exact admitted turn is still running', async () => {
    const first = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!first) throw new Error('first task execution response missing');
    mocks.callOwnerHerderTool.mockClear();
    mocks.sessionInfo.value = {
      ...mocks.sessionInfo.value,
      status: 'running', lastMessage: 'Я проверю это сейчас',
      meta: { nativeLastTurn: { turnId: 'older-turn', status: 'completed' } },
    };
    const current = mocks.currentCard.value!;
    const response = await PATCH(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'sync-result', operationId, expectedVersion: current.version }),
    }), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('task sync response missing');

    expect(response.status).toBe(202);
    expect(mocks.currentCard.value?.column).toBe('in-progress');
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.phase).toBe('running');
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'fleet_session_view')).toHaveLength(0);
  });

  it('keeps the execution unresolved when idle belongs to a different native turn', async () => {
    const first = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!first) throw new Error('first task execution response missing');
    mocks.callOwnerHerderTool.mockClear();
    mocks.sessionInfo.value = {
      ...mocks.sessionInfo.value,
      status: 'idle', lastMessage: 'Stale prior result',
      meta: { nativeLastTurn: { turnId: 'different-turn', status: 'completed' } },
    };
    const current = mocks.currentCard.value!;
    const response = await PATCH(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'sync-result', operationId, expectedVersion: current.version }),
    }), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('task sync response missing');

    expect(response.status).toBe(202);
    expect(mocks.currentCard.value?.column).toBe('in-progress');
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.phase).toBe('running');
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'fleet_session_view')).toHaveLength(0);
  });

  it('uses the native final message when agent_info.lastMessage is a stale prefixed summary', async () => {
    const first = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!first) throw new Error('first task execution response missing');
    mocks.validateTransition.mockReturnValue({
      kind: 'redirected', patch: { column: 'review', needsReview: true, resultHistory: [{
        summary: 'Found two candidates', evidenceRefs: [], submittedBy: 'nikita', submittedAt: '2026-10-20T10:06:00.000Z',
      }] },
    });
    mocks.callOwnerHerderTool.mockClear();
    mocks.sessionInfo.value = {
      ...mocks.sessionInfo.value,
      status: 'idle', lastMessage: 'assistant: The push succeeded. A fresh origin/main readback confirms…',
      meta: { nativeLastTurn: { turnId: 'turn-1', status: 'completed' } },
    };
    const current = mocks.currentCard.value!;
    const response = await PATCH(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'sync-result', operationId, expectedVersion: current.version }),
    }), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('task sync response missing');

    expect(response.status).toBe(200);
    expect(mocks.currentCard.value?.column).toBe('review');
    expect(mocks.currentCard.value?.resultHistory?.at(-1)?.summary).toBe('Found two candidates');
  });

  it('reconciles the same accepted OpenCode operation when its first user message is outside the recent messages window', async () => {
    const projectBinding = openCodeProjectBinding();
    const exactOperationId = 'd'.repeat(64);
    const exactInputId = createHash('sha256').update(`${exactOperationId}\0dispatch`).digest('hex');
    const firstUserUri = `herder://sessions/opencode/${sessionId}/first-user-message`;
    const messagesUri = `herder://sessions/opencode/${sessionId}/messages`;
    const exactTaskPrompt = expectedOpenCodeTaskPrompt(baseCard, exactOperationId, sessionId, projectBinding.cwd);
    const originalUserMessage = {
      id: 'msg_first_user_message_123456', role: 'user', inputId: exactInputId,
      parts: [{ type: 'text', text: `Поручение пользователя, переданное агентом\n\n${exactTaskPrompt}` }],
    };
    const requestHash = createHash('sha256').update(JSON.stringify({
      id: baseCard.id, title: baseCard.title, description: baseCard.description, project: baseCard.project,
      owner: baseCard.owner ?? 'nikita', assignee: baseCard.assignee ?? null, assignees: baseCard.assignees,
      actor: 'nikita', hostId: 'roomhacker-server-100', harness: 'opencode',
      cwd: projectBinding.cwd, model: projectBinding.model, projectBinding,
    })).digest('hex');
    mocks.currentCard.value = {
      ...baseCard, column: 'in-progress', version: 5,
      taskExecutionHistory: [{
        operationId: exactOperationId, requestHash, lastBoardVersion: 5,
        createInputId: '1'.repeat(64), messageInputId: exactInputId, phase: 'dispatch-unknown',
        hostId: 'roomhacker-server-100', harness: 'opencode', nativeSessionId: sessionId,
        projectBinding, startedBy: 'nikita', createdAt: baseCard.created, updatedAt: baseCard.updated,
      }],
    };
    mocks.sessionInfo.value = {
      id: sessionId, harness: 'opencode', hostId: 'roomhacker-server-100', cwd: projectBinding.cwd,
      model: projectBinding.model, status: 'idle', needsPermission: false,
      meta: { nativeLastTurn: { turnId: 'turn-2', status: 'completed' } },
    };
    let recentMessages: Record<string, unknown>[] = [{
      id: 'msg_later_assistant_123456', role: 'assistant', turnId: 'turn-2', phase: 'completed',
      nativeParentMessageId: 'msg_later_user_123456',
      parts: [{ type: 'text', text: 'A later user task result; must not be attached to the original card.' }],
    }];
    mocks.callOwnerHerderTool.mockImplementation((tool: string, args: Record<string, unknown>) => {
      if (tool === 'job_get') return { structuredContent: { job: {
        id: args.jobId, state: 'completed', ownerSessionId: sessionId,
        onceKey: ['user-message', 'opencode', sessionId, exactInputId].join('\0'),
        result: { ok: true, admitted: true, inputId: exactInputId, nativeInputMessageId: originalUserMessage.id },
      } }, content: [] };
      return toolResult(tool, args);
    });
    mocks.readOwnerHerderResource.mockImplementation(async (uri: string) => ({ contents: [{
      uri, mimeType: 'application/json', text: JSON.stringify(uri === firstUserUri
        ? originalUserMessage
        : uri === messagesUri
          ? recentMessages
          : null),
    }] }));
    mocks.validateTransition.mockImplementation((_card: KanbanCard, updates: { executorResult?: { summary?: string } }) => ({
      kind: 'redirected', patch: { column: 'review', needsReview: true, resultHistory: [{
        summary: updates.executorResult?.summary ?? '', evidenceRefs: [], submittedBy: 'nikita', submittedAt: '2026-10-28T00:00:00.000Z',
      }] },
    }));

    const request = () => new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'sync-result', operationId: exactOperationId, expectedVersion: mocks.currentCard.value?.version ?? 5 }),
    });
    const writesBefore = mocks.updateCard.mock.calls.length;
    const hiddenLaterUser = await PATCH(request(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!hiddenLaterUser) throw new Error('OpenCode hidden later-user result response missing');
    expect(hiddenLaterUser.status, JSON.stringify(await hiddenLaterUser.clone().json())).toBe(202);
    expect(mocks.updateCard).toHaveBeenCalledTimes(writesBefore + 1);
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]).toMatchObject({
      phase: 'waiting', nativeSessionId: sessionId,
      nativeDispatchJobId: userMessageJobId(sessionId, exactInputId),
      nativeInputMessageId: originalUserMessage.id,
      lastProgress: expect.stringMatching(/простаивает.*результат.*не принят/i),
    });
    expect(mocks.currentCard.value?.resultHistory).toBeUndefined();

    recentMessages = [{
      id: 'msg_final_assistant_123456', role: 'assistant', turnId: 'turn-1', phase: 'completed',
      nativeParentMessageId: originalUserMessage.id,
      parts: [{ type: 'text', text: 'QA result saved from the original task; total 2500.' }],
    }];
    mocks.sessionInfo.value = { ...mocks.sessionInfo.value, meta: { nativeLastTurn: { turnId: 'turn-1', status: 'completed' } } };
    const response = await PATCH(request(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('OpenCode result reconciliation response missing');

    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    expect(mocks.readOwnerHerderResource).toHaveBeenCalledWith(firstUserUri);
    expect(mocks.currentCard.value?.resultHistory?.at(-1)?.summary).toBe('QA result saved from the original task; total 2500.');
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]).toMatchObject({
      operationId: exactOperationId, phase: 'result', nativeSessionId: sessionId,
      nativeDispatchJobId: userMessageJobId(sessionId, exactInputId),
      nativeInputMessageId: originalUserMessage.id,
    });
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'send_message' || tool === 'fleet_create_session')).toHaveLength(0);
  });

  it('creates the question only from a completed metadata binding and typed question in the same exact OpenCode input', async () => {
    const humanRequestId = '67ce04db-d775-4f81-a86d-31af4bbe1091';
    const project = 'UX QA 2026-10-26';
    const model = 'omniroute/minimax-combo-m3.1';
    mocks.projectRouteOverride.value = { state: 'ready', harness: 'opencode', model };
    mocks.identity.value = { username: 'testlogin', scope: 'work' };
    const readiness = scopedReadiness(project).projectReadiness;
    const projectBinding: TaskExecutionProjectBinding = {
      contract: 'integrator-host-readiness-v1', projectId: project, projectRoot: readiness.projectRoot,
      rootIdentity: readiness.rootIdentity, policyRevision: readiness.policyRevision, observedAtMs: readiness.observedAtMs,
      runtimeInstanceId: readiness.runtimeInstanceId, hostId: readiness.hostId, harness: 'opencode',
      harnessVersion: readiness.harnessVersion, model: readiness.model,
      requiredTools: readiness.requiredTools as string[], availableTools: readiness.availableTools as string[],
      availableModels: readiness.availableModels as string[], resourceReady: true, cwd: readiness.cwd,
      pathResolution: { ...readiness.pathResolution, contained: true, identityMatches: true },
    };
    const inputId = '4'.repeat(64);
    const nativeInputMessageId = opencodeInputMessageId(inputId);
    const nativeDispatchJobId = userMessageJobId(sessionId, inputId);
    const card: KanbanCard = {
      ...baseCard, id: 'f1b6dc21-ddde-4ddf-bd49-2c2a6b867fba', title: 'QA L06: вопрос о варианте тестовой сводки',
      description: 'Синтетическая QA-задача.', project, owner: 'testlogin', column: 'todo', version: 7,
    };
    const attemptIdentity = {
      id: card.id, title: card.title, description: card.description, project: card.project, owner: card.owner,
      assignee: null, assignees: card.assignees, actor: 'testlogin', hostId: 'roomhacker-server-100',
      harness: 'opencode', cwd: projectBinding.cwd, model, projectBinding,
    };
    const operationId = 'a'.repeat(64);
    const requestHash = createHash('sha256').update(JSON.stringify(attemptIdentity)).digest('hex');
    mocks.currentCard.value = { ...card, taskExecutionHistory: [{
      operationId, requestHash, lastBoardVersion: card.version, createInputId: '3'.repeat(64), messageInputId: inputId,
      phase: 'running', hostId: 'roomhacker-server-100', harness: 'opencode', projectBinding, nativeSessionId: sessionId,
      nativeInputMessageId, nativeDispatchJobId, startedBy: 'testlogin', createdAt: card.created, updatedAt: card.updated,
    }] };
    mocks.sessionInfo.value = {
      id: sessionId, harness: 'opencode', hostId: 'roomhacker-server-100', cwd: projectBinding.cwd,
      model, status: 'idle', lastActivity: '2026-10-28T18:00:00.000Z',
      meta: { nativeLastTurn: { turnId: 'turn-question', status: 'completed' } },
    };
    const contextRef = `exmanager-task:${card.id}:${operationId}`;
    const questionPayload = {
      kind: 'question', human_request_id: humanRequestId, question: 'Какой формат сводки выбрать?',
      choices: [{ value: 'brief', label: 'Краткая таблица' }, { value: 'total', label: 'Таблица с итоговой строкой' }],
      timeoutValue: 'brief',
    };
    const rawQuestion = JSON.stringify(questionPayload);
    const messagesUri = `herder://sessions/opencode/${encodeURIComponent(sessionId)}/messages`;
    const exactInput = { id: nativeInputMessageId, inputId, role: 'user', turnId: 'turn-question',
      parts: [{ type: 'text', text: expectedOpenCodeTaskPrompt(card, operationId, sessionId, projectBinding.cwd) }] };
    const registrationMessage = { id: 'msg_registration_123456789', role: 'assistant', turnId: 'turn-question', phase: 'completed', parts: [{
      type: 'tool', callID: 'call_registration_123456789', tool: 'agent-herder_human_request_create',
      state: { status: 'completed', input: { kind: 'user', harness: 'opencode', sessionId, cwd: projectBinding.cwd, contextRef },
        output: JSON.stringify({ binding: { kind: 'user', request_id: humanRequestId, context_ref: contextRef,
          native_target: { harness: 'opencode', session_id: sessionId, cwd: projectBinding.cwd } } }) },
    }] };
    const questionMessage = { id: 'msg_question_1234567890', role: 'assistant', turnId: 'turn-question', phase: 'completed',
      parts: [{ type: 'text', text: rawQuestion }] };
    mocks.readOwnerHerderResource.mockResolvedValue({ contents: [{ uri: messagesUri, mimeType: 'application/json',
      text: JSON.stringify([exactInput, registrationMessage, questionMessage]) }] });
    mocks.callOwnerHerderTool.mockImplementation(async (tool: string, args: Record<string, unknown>) => {
      if (tool === 'fleet_node_info') return { structuredContent: scopedReadiness(project), content: [] };
      if (tool === 'agent_info') return { structuredContent: { session: mocks.sessionInfo.value }, content: [] };
      if (tool === 'job_get') return { structuredContent: { job: {
        id: nativeDispatchJobId, kind: 'Доставка сообщения', state: 'completed', ownerSessionId: sessionId,
        onceKey: ['user-message', 'opencode', sessionId, inputId].join('\0'),
        result: { ok: true, admitted: true, inputId, nativeInputMessageId },
      } }, content: [] };
      throw new Error(`unexpected tool ${tool}`);
    });
    vi.stubEnv('EXMANAGER_NOTICE_PROJECT_TOKEN', 'qa-only');
    vi.stubEnv('NOTIFY_CENTER_RECIPIENT', 'qa-board-only');
    vi.stubEnv('KANBAN_QA_ANONYMOUS_READS', '1');
    vi.stubEnv('EXMANAGER_NOTICE_API_BASE_URL', 'http://192.168.192.1:19450');
    const noticeRequest = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const mandate = JSON.parse(String(init?.body)).mandate as Record<string, unknown>;
      const requestId = `td-${createHash('sha256').update(JSON.stringify([card.id, 'clarification', String(mandate.version)])).digest('hex').slice(0, 40)}`;
      return new Response(JSON.stringify({ schema: 'noticeplace.task_decision_view.v1', request_id: requestId,
        project, recipient: 'qa-board-only', status: 'pending', question: { text: mandate.message, mode: 'choice',
          choices: mandate.choices, expires_at: null, reference: { task_ref: card.id, purpose: 'clarification',
            version: String(mandate.version), mandate_ref: operationId } },
        notification: { attempt_state: 'sent', receipt: { kind: 'successful_sender_response', confirmed_at: 100 }, deadline_at: 1900 },
        winner: null, control: { state: 'clear' },
        delivery_status: 'sent', idempotent: false }), { status: 201, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', noticeRequest);

    const response = await PATCH(new NextRequest(`https://todo.example.test/api/kanban/cards/${card.id}/execution`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'sync-result', operationId, expectedVersion: card.version }),
    }), { params: Promise.resolve({ id: card.id }) });

    if (!response) throw new Error('executor question sync response missing');
    expect(response.status).toBe(201);
    expect(noticeRequest).toHaveBeenCalledTimes(1);
    expect(String(noticeRequest.mock.calls[0]?.[0])).toBe('http://192.168.192.1:19450/v1/task-decisions');
    const persisted = mocks.currentCard.value!.taskExecutionHistory![0]!;
    expect(persisted).toMatchObject({ phase: 'waiting', executorQuestion: {
      humanRequestId, contextRef, registrationMessageId: registrationMessage.id,
      registrationCallId: 'call_registration_123456789', sourceMessageId: questionMessage.id,
      sourceInputMessageId: nativeInputMessageId, sourceJobId: nativeDispatchJobId,
      sourceMessageHash: createHash('sha256').update(rawQuestion).digest('hex'),
      text: questionPayload.question, choices: questionPayload.choices, timeoutValue: 'brief',
      questionHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }, taskDecisionRequest: { requestId: expect.stringMatching(/^td-[a-f0-9]{40}$/) } });
    expect(JSON.parse(String(noticeRequest.mock.calls[0]?.[1]?.body)).mandate.executor_question).toEqual(persisted.executorQuestion);
  });

  it('uses a completed OpenCode question and exact Herder registry record when the first user input is outside the message tail', async () => {
    const fixture = prepareRegistryExecutorQuestion();
    const noticeRequest = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const mandate = JSON.parse(String(init?.body)).mandate as Record<string, unknown>;
      const requestId = `td-${createHash('sha256').update(JSON.stringify([fixture.card.id, 'clarification', String(mandate.version)])).digest('hex').slice(0, 40)}`;
      return new Response(JSON.stringify({ schema: 'noticeplace.task_decision_view.v1', request_id: requestId,
        project: fixture.project, recipient: 'qa-board-only', status: 'pending', question: { text: mandate.message, mode: 'choice',
          choices: mandate.choices, expires_at: null, reference: { task_ref: fixture.card.id, purpose: 'clarification',
            version: String(mandate.version), mandate_ref: fixture.operationId } },
        notification: { attempt_state: 'sent', receipt: { kind: 'successful_sender_response', confirmed_at: 100 }, deadline_at: 1900 },
        winner: null, control: { state: 'clear' }, delivery_status: 'sent', idempotent: false }),
      { status: 201, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', noticeRequest);

    const response = await PATCH(new NextRequest(`https://todo.example.test/api/kanban/cards/${fixture.card.id}/execution`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'sync-result', operationId: fixture.operationId, expectedVersion: fixture.card.version }),
    }), { params: Promise.resolve({ id: fixture.card.id }) });

    if (!response) throw new Error('executor question sync response missing');
    expect(response.status).toBe(201);
    expect(mocks.readOwnerHerderResource).toHaveBeenCalledWith(fixture.firstUserUri);
    expect(mocks.callOwnerHerderTool).toHaveBeenCalledWith('human_request_get', { requestId: fixture.humanRequestId });
    expect(noticeRequest).toHaveBeenCalledTimes(1);
    const persisted = mocks.currentCard.value!.taskExecutionHistory![0]!;
    expect(persisted).toMatchObject({ phase: 'waiting', executorQuestion: {
      humanRequestId: fixture.humanRequestId, contextRef: fixture.contextRef,
      registrationRef: { kind: 'herder-registry', requestId: fixture.humanRequestId, contextRef: fixture.contextRef },
      registrationTarget: { harness: 'opencode', sessionId, cwd: fixture.projectBinding.cwd },
      sourceMessageId: expect.stringMatching(/^msg_[A-Za-z0-9_-]{8,256}$/),
      sourceInputMessageId: fixture.nativeInputMessageId, sourceJobId: fixture.nativeDispatchJobId,
      sourceMessageHash: expect.stringMatching(/^[a-f0-9]{64}$/), text: fixture.questionPayload.question,
    } });
    expect(persisted.executorQuestion).not.toHaveProperty('registrationCallId');
    expect(persisted.executorQuestion).not.toHaveProperty('registrationMessageId');
    expect(JSON.parse(String(noticeRequest.mock.calls[0]?.[1]?.body)).mandate.executor_question).toEqual(persisted.executorQuestion);
  });

  it('creates and answers a registry question from the exact accepted direct input after an older accepted stop', async () => {
    const fixture = prepareRegistryExecutorQuestion();
    const direct = addAcceptedDirectContinuation(fixture);
    const noticeRequest = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(_input);
      if (url.endsWith('/resolve')) {
        const current = mocks.currentCard.value!;
        const reference = current.taskExecutionHistory![0]!.taskDecisionRequest!;
        return noticeResponse({ ...noticeQuestionView({ requestId: reference.requestId, taskRef: fixture.card.id,
          operationId: fixture.operationId, purpose: 'clarification', version: reference.version,
          winner: { source: 'human', value: 'brief', decided_at: 789 } }),
          project: fixture.project, recipient: 'qa-board-only', answer_status: 'accepted' }, 200);
      }
      const mandate = JSON.parse(String(init?.body)).mandate as Record<string, unknown>;
      const requestId = expectedNoticeRequestId(fixture.card.id, 'clarification', Number(mandate.version));
      return noticeResponse({ schema: 'noticeplace.task_decision_view.v1', request_id: requestId,
        project: fixture.project, recipient: 'qa-board-only', status: 'pending', question: { text: mandate.message, mode: 'choice',
          choices: mandate.choices, expires_at: null, reference: { task_ref: fixture.card.id, purpose: 'clarification',
            version: String(mandate.version), mandate_ref: fixture.operationId } },
        notification: { attempt_state: 'sent', receipt: { kind: 'successful_sender_response', confirmed_at: 100 }, deadline_at: 1900 },
        winner: null, control: { state: 'clear' }, delivery_status: 'sent', idempotent: false }, 201);
    });
    vi.stubGlobal('fetch', noticeRequest);

    const created = await PATCH(new NextRequest(`https://todo.example.test/api/kanban/cards/${fixture.card.id}/execution`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'sync-result', operationId: fixture.operationId, expectedVersion: fixture.card.version }),
    }), { params: Promise.resolve({ id: fixture.card.id }) });
    if (!created) throw new Error('direct continuation question response missing');
    expect(created.status).toBe(201);
    const question = mocks.currentCard.value!.taskExecutionHistory![0]!.executorQuestion!;
    expect(question).toMatchObject({ sourceInputMessageId: direct.directNativeInputMessageId, sourceJobId: direct.directJobId });
    expect(mocks.currentCard.value!.taskExecutionHistory![0]!.sessionControls?.stops).toHaveLength(1);
    expect(mocks.currentCard.value!.taskExecutionHistory![0]!.sessionControls?.direct?.at(-1)).toMatchObject({
      requestHash: direct.directInputId, phase: 'accepted',
    });

    const current = mocks.currentCard.value!;
    const answered = await PATCH(new NextRequest(`https://todo.example.test/api/kanban/cards/${fixture.card.id}/execution`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'answer-question', operationId: fixture.operationId,
        expectedVersion: current.version, value: 'brief' }),
    }), { params: Promise.resolve({ id: fixture.card.id }) });
    if (!answered) throw new Error('direct continuation question answer response missing');
    expect(answered.status, JSON.stringify(await answered.clone().json())).toBe(200);
    expect(mocks.currentCard.value!.taskExecutionHistory![0]!.taskDecisionProposal).toMatchObject({
      sourceMessageId: question.sourceMessageId, sourceJobId: question.sourceJobId, value: 'brief',
    });
    expect(noticeRequest).toHaveBeenCalledTimes(2);
  });

  it.each([
    { name: 'an unresolved stop', phase: 'unknown' as const, controlEpoch: '5'.repeat(64) },
    { name: 'a stop accepted after the direct input', phase: 'accepted' as const, controlEpoch: '5'.repeat(64) },
  ])('does not create a deferred question while $name remains active', async stop => {
    const fixture = prepareRegistryExecutorQuestion();
    addAcceptedDirectContinuation(fixture, stop);
    const noticeRequest = vi.fn(async () => new Response('{}', { status: 503 }));
    vi.stubGlobal('fetch', noticeRequest);
    const response = await PATCH(new NextRequest(`https://todo.example.test/api/kanban/cards/${fixture.card.id}/execution`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'sync-result', operationId: fixture.operationId, expectedVersion: fixture.card.version }),
    }), { params: Promise.resolve({ id: fixture.card.id }) });
    if (!response) throw new Error('stop-fenced question response missing');
    expect(response.status).toBe(409);
    expect(noticeRequest).not.toHaveBeenCalled();
    expect(mocks.currentCard.value!.taskExecutionHistory![0]!.executorQuestion).toBeUndefined();
  });

  it('does not answer a deferred question bound to the old initial input after a direct continuation', async () => {
    const fixture = prepareRegistryExecutorQuestion();
    addAcceptedDirectContinuation(fixture);
    const current = mocks.currentCard.value!;
    const attempt = current.taskExecutionHistory![0]!;
    const question = {
      humanRequestId: fixture.humanRequestId, contextRef: fixture.contextRef,
      registrationRef: { kind: 'herder-registry' as const, requestId: fixture.humanRequestId, contextRef: fixture.contextRef },
      registrationTarget: { harness: 'opencode' as const, sessionId, cwd: fixture.projectBinding.cwd },
      sourceMessageId: 'msg_question_old_12345678', sourceMessageHash: 'a'.repeat(64),
      sourceInputMessageId: fixture.nativeInputMessageId, sourceJobId: fixture.nativeDispatchJobId,
      text: fixture.questionPayload.question, choices: fixture.questionPayload.choices,
      timeoutValue: 'brief', questionHash: 'b'.repeat(64),
    };
    const reference = { requestId: `td-${'c'.repeat(40)}`, requestHash: 'd'.repeat(64), purpose: 'clarification', version: current.version };
    mocks.currentCard.value = { ...current, version: current.version + 1, taskExecutionHistory: [{ ...attempt,
      phase: 'waiting', lastBoardVersion: current.version + 1, executorQuestion: question, taskDecisionRequest: reference }] };
    const noticeRequest = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', noticeRequest);
    const card = mocks.currentCard.value!;
    const response = await PATCH(new NextRequest(`https://todo.example.test/api/kanban/cards/${fixture.card.id}/execution`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'answer-question', operationId: fixture.operationId,
        expectedVersion: card.version, value: 'brief' }),
    }), { params: Promise.resolve({ id: fixture.card.id }) });
    if (!response) throw new Error('old-input answer response missing');
    expect(response.status).toBe(409);
    expect(noticeRequest).not.toHaveBeenCalled();
  });

  it('reconciles a durable deferred question after known Notice refusal and reuses the same request on confirmed absence', async () => {
    const fixture = prepareRegistryExecutorQuestion();
    addAcceptedDirectContinuation(fixture);
    const calls: Array<{ url: string; method: string; mandate?: unknown }> = [];
    const noticeRequest = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
      calls.push({ url: String(input), method, ...(body?.mandate ? { mandate: body.mandate } : {}) });
      if (method === 'GET') return noticeResponse({ error: 'not found' }, 404);
      if (calls.filter(call => call.method === 'POST').length === 1) return noticeResponse({ error: 'deterministic refusal' }, 409);
      const mandate = body?.mandate as Record<string, unknown>;
      const requestId = expectedNoticeRequestId(fixture.card.id, 'clarification', Number(mandate.version));
      return noticeResponse({ schema: 'noticeplace.task_decision_view.v1', request_id: requestId,
        project: fixture.project, recipient: 'qa-board-only', status: 'pending', question: { text: mandate.message, mode: 'choice',
          choices: mandate.choices, expires_at: null, reference: { task_ref: fixture.card.id, purpose: 'clarification',
            version: String(mandate.version), mandate_ref: fixture.operationId } },
        notification: { attempt_state: 'sent', receipt: { kind: 'successful_sender_response', confirmed_at: 100 }, deadline_at: 1900 },
        winner: null, control: { state: 'clear' }, delivery_status: 'sent', idempotent: true }, 201);
    });
    vi.stubGlobal('fetch', noticeRequest);
    const sync = () => {
      const current = mocks.currentCard.value!;
      return PATCH(new NextRequest(`https://todo.example.test/api/kanban/cards/${fixture.card.id}/execution`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'sync-result', operationId: fixture.operationId, expectedVersion: current.version }),
      }), { params: Promise.resolve({ id: fixture.card.id }) });
    };

    const refused = await sync();
    if (!refused) throw new Error('initial Notice refusal response missing');
    expect(refused.status).toBe(409);
    const saved = mocks.currentCard.value!.taskExecutionHistory![0]!;
    expect(saved).toMatchObject({ phase: 'waiting', taskDecisionRequest: {
      requestId: expect.stringMatching(/^td-[a-f0-9]{40}$/), version: mocks.currentCard.value!.version,
    }, executorQuestion: { humanRequestId: fixture.humanRequestId } });
    const firstMandate = calls.find(call => call.method === 'POST')?.mandate;
    const originalQuestion = saved.executorQuestion!;
    const semanticRequestHash = createHash('sha256').update(canonicalJsonForQuestionTest({
      taskRef: fixture.card.id, operationId: fixture.operationId, project: fixture.project,
      recipient: 'qa-board-only', purpose: 'clarification', version: saved.taskDecisionRequest!.version,
      message: originalQuestion.text, choices: originalQuestion.choices, timeoutValue: originalQuestion.timeoutValue,
      executorQuestion: originalQuestion,
    })).digest('hex');
    expect(saved.taskDecisionRequest!.requestHash).toBe(semanticRequestHash);
    const legacyRequestHash = legacyQuestionRequestHash(fixture, originalQuestion, saved.taskDecisionRequest!.version);
    const fileStoreProof = fileStoreQuestionRoundTrip(originalQuestion);
    expect(Object.keys(fileStoreProof)).toEqual(['humanRequestId', 'contextRef', 'registrationTarget', 'sourceMessageId',
      'sourceMessageHash', 'sourceInputMessageId', 'sourceJobId', 'text', 'choices', 'timeoutValue', 'questionHash', 'registrationRef']);
    const beforeRetry = mocks.currentCard.value!;
    const beforeRetryAttempt = beforeRetry.taskExecutionHistory![0]!;
    mocks.currentCard.value = { ...beforeRetry, taskExecutionHistory: [{ ...beforeRetryAttempt,
      taskDecisionRequest: { ...saved.taskDecisionRequest!, requestHash: legacyRequestHash },
      executorQuestion: fileStoreProof,
    }] };

    const recovered = await sync();
    if (!recovered) throw new Error('same Notice question recovery response missing');
    expect(recovered.status).toBe(201);
    expect(await recovered.json()).toMatchObject({ taskQuestion: {
      requestId: saved.taskDecisionRequest!.requestId, state: 'pending', deliveryStatus: 'sent', idempotent: true,
    } });
    expect(calls.map(call => call.method)).toEqual(['POST', 'GET', 'POST']);
    expect(calls[1]?.url).toBe(`http://192.168.192.1:19450/v1/task-decisions/${saved.taskDecisionRequest!.requestId}`);
    expect(calls[2]?.mandate).toEqual(firstMandate);
    expect(mocks.currentCard.value!.taskExecutionHistory![0]!.taskDecisionRequest).toEqual({
      ...saved.taskDecisionRequest, requestHash: legacyRequestHash,
    });
    expect(mocks.currentCard.value!.taskExecutionHistory![0]!.executorQuestion).toEqual(fileStoreProof);
  });

  it('keeps a durable deferred question query-only when Notice readback is unknown', async () => {
    const fixture = prepareRegistryExecutorQuestion();
    addAcceptedDirectContinuation(fixture);
    const methods: string[] = [];
    const noticeRequest = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      methods.push(method);
      if (method === 'POST') throw new Error('synthetic ambiguous create transport');
      return noticeResponse({ error: 'temporarily unavailable' }, 503);
    });
    vi.stubGlobal('fetch', noticeRequest);
    const sync = () => {
      const current = mocks.currentCard.value!;
      return PATCH(new NextRequest(`https://todo.example.test/api/kanban/cards/${fixture.card.id}/execution`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'sync-result', operationId: fixture.operationId, expectedVersion: current.version }),
      }), { params: Promise.resolve({ id: fixture.card.id }) });
    };

    const ambiguous = await sync();
    if (!ambiguous) throw new Error('ambiguous initial Notice response missing');
    expect(ambiguous.status).toBe(202);
    const saved = mocks.currentCard.value!.taskExecutionHistory![0]!;
    expect(saved.taskDecisionRequest).toBeDefined();
    expect(saved.executorQuestion).toBeDefined();

    const unresolved = await sync();
    if (!unresolved) throw new Error('unknown Notice readback response missing');
    expect(unresolved.status).toBe(202);
    expect(await unresolved.json()).toMatchObject({ taskQuestion: {
      requestId: saved.taskDecisionRequest!.requestId, state: 'unknown',
    } });
    expect(methods).toEqual(['POST', 'GET']);
  });

  it('resumes one exact queued Notice notification through the same deterministic mandate', async () => {
    const fixture = prepareRegistryExecutorQuestion();
    addAcceptedDirectContinuation(fixture);
    const calls: Array<{ method: string; url: string; mandate?: unknown }> = [];
    const noticeRequest = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
      calls.push({ method, url: String(input), ...(body?.mandate ? { mandate: body.mandate } : {}) });
      if (method === 'GET') return noticeResponse(deferredQuestionNoticeView(fixture, {
        attemptState: 'queued', delivered: false, deadlineAt: null, deliveryStatus: 'queued',
      }), 200);
      if (calls.filter(call => call.method === 'POST').length === 1) {
        return noticeResponse({ error: 'pre-reserve adapter failure' }, 500);
      }
      return noticeResponse(deferredQuestionNoticeView(fixture, {
        attemptState: 'sent', delivered: true, deadlineAt: 1900, deliveryStatus: 'sent',
      }), 201);
    });
    vi.stubGlobal('fetch', noticeRequest);
    const sync = () => {
      const current = mocks.currentCard.value!;
      return PATCH(new NextRequest(`https://todo.example.test/api/kanban/cards/${fixture.card.id}/execution`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'sync-result', operationId: fixture.operationId, expectedVersion: current.version }),
      }), { params: Promise.resolve({ id: fixture.card.id }) });
    };

    const first = await sync();
    if (!first) throw new Error('initial pre-reserve failure response missing');
    expect(first.status).toBe(202);
    const savedCard = mocks.currentCard.value!;
    const savedAttempt = savedCard.taskExecutionHistory![0]!;
    const reference = savedAttempt.taskDecisionRequest!;
    const proof = savedAttempt.executorQuestion!;
    const firstMandate = calls[0]?.mandate;

    const resumed = await sync();
    if (!resumed) throw new Error('queued notification resume response missing');
    expect(resumed.status, JSON.stringify({ body: await resumed.clone().json(), calls })).toBe(201);
    expect(await resumed.json()).toMatchObject({ taskQuestion: {
      requestId: reference.requestId, state: 'pending', deliveryStatus: 'sent', idempotent: true,
    } });
    expect(calls.map(call => call.method)).toEqual(['POST', 'GET', 'POST']);
    expect(calls[2]?.mandate).toEqual(firstMandate);
    expect(mocks.currentCard.value!.version).toBe(savedCard.version);
    expect(mocks.currentCard.value!.taskExecutionHistory![0]!.taskDecisionRequest).toEqual(reference);
    expect(mocks.currentCard.value!.taskExecutionHistory![0]!.executorQuestion).toEqual(proof);
  });

  it('does not report delivery when the idempotent queued-state reuse remains queued', async () => {
    const fixture = prepareRegistryExecutorQuestion();
    addAcceptedDirectContinuation(fixture);
    const methods: string[] = [];
    const noticeRequest = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      methods.push(method);
      if (method === 'POST' && methods.filter(item => item === 'POST').length === 1) {
        return noticeResponse({ error: 'pre-reserve adapter failure' }, 500);
      }
      return noticeResponse(deferredQuestionNoticeView(fixture, {
        attemptState: 'queued', delivered: false, deadlineAt: null, deliveryStatus: 'queued',
      }), method === 'GET' ? 200 : 201);
    });
    vi.stubGlobal('fetch', noticeRequest);
    const sync = () => {
      const current = mocks.currentCard.value!;
      return PATCH(new NextRequest(`https://todo.example.test/api/kanban/cards/${fixture.card.id}/execution`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'sync-result', operationId: fixture.operationId, expectedVersion: current.version }),
      }), { params: Promise.resolve({ id: fixture.card.id }) });
    };
    const first = await sync();
    if (!first) throw new Error('initial adapter failure response missing');
    expect(first.status).toBe(202);
    const resumed = await sync();
    if (!resumed) throw new Error('queued idempotent reuse response missing');
    expect(resumed.status).toBe(202);
    expect(await resumed.json()).toMatchObject({ taskQuestion: {
      state: 'pending', deliveryStatus: 'queued', notification: { delivered: false, deadlineAt: null },
    } });
    expect(methods).toEqual(['POST', 'GET', 'POST']);
  });

  it.each([
    { name: 'sending', attemptState: 'sending', delivered: false, deadlineAt: null, deliveryStatus: 'sending' },
    { name: 'unknown', attemptState: 'unknown', delivered: false, deadlineAt: null, deliveryStatus: 'unknown' },
    { name: 'already sent', attemptState: 'sent', delivered: true, deadlineAt: 1900, deliveryStatus: 'sent' },
    { name: 'queued but already delivered', attemptState: 'queued', delivered: true, deadlineAt: 1900, deliveryStatus: 'queued' },
    { name: 'queued with an incompatible deadline', attemptState: 'queued', delivered: false, deadlineAt: 1900, deliveryStatus: 'queued' },
  ])('does not repeat delivery for a $name Notice question', async state => {
    const fixture = prepareRegistryExecutorQuestion();
    addAcceptedDirectContinuation(fixture);
    const methods: string[] = [];
    const noticeRequest = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      methods.push(method);
      if (method === 'POST') return noticeResponse({ error: 'pre-reserve adapter failure' }, 500);
      return noticeResponse(deferredQuestionNoticeView(fixture, state), 200);
    });
    vi.stubGlobal('fetch', noticeRequest);
    const sync = () => {
      const current = mocks.currentCard.value!;
      return PATCH(new NextRequest(`https://todo.example.test/api/kanban/cards/${fixture.card.id}/execution`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'sync-result', operationId: fixture.operationId, expectedVersion: current.version }),
      }), { params: Promise.resolve({ id: fixture.card.id }) });
    };

    const first = await sync();
    if (!first) throw new Error('initial Notice partial failure response missing');
    expect(first.status).toBe(202);
    const second = await sync();
    if (!second) throw new Error('Notice delivery state readback response missing');
    expect(second.status).toBe(state.attemptState === 'queued' && !state.delivered && state.deadlineAt !== null ? 502 : 200);
    expect(methods).toEqual(['POST', 'GET']);
  });

  it.each(['card version', 'request reference', 'executor proof'] as const)(
    'does not retry a queued notification if the %s changed during readback', async changed => {
      const fixture = prepareRegistryExecutorQuestion();
      addAcceptedDirectContinuation(fixture);
      const methods: string[] = [];
      const noticeRequest = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        methods.push(method);
        if (method === 'POST') return noticeResponse({ error: 'pre-reserve adapter failure' }, 500);
        const current = mocks.currentCard.value!;
        const attempt = current.taskExecutionHistory![0]!;
        const receipt = { ...attempt };
        const payload = deferredQuestionNoticeView(fixture, {
          attemptState: 'queued', delivered: false, deadlineAt: null, deliveryStatus: 'queued',
        });
        const nextAttempt = changed === 'request reference'
          ? { ...receipt, taskDecisionRequest: { ...receipt.taskDecisionRequest!, requestHash: '9'.repeat(64) } }
          : changed === 'executor proof'
            ? { ...receipt, executorQuestion: { ...receipt.executorQuestion!, text: 'Изменённый вопрос' } }
            : receipt;
        mocks.currentCard.value = { ...current, version: changed === 'card version' ? current.version + 1 : current.version,
          taskExecutionHistory: [nextAttempt] };
        return noticeResponse(payload, 200);
      });
      vi.stubGlobal('fetch', noticeRequest);
      const sync = () => {
        const current = mocks.currentCard.value!;
        return PATCH(new NextRequest(`https://todo.example.test/api/kanban/cards/${fixture.card.id}/execution`, {
          method: 'PATCH', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'sync-result', operationId: fixture.operationId, expectedVersion: current.version }),
        }), { params: Promise.resolve({ id: fixture.card.id }) });
      };
      const first = await sync();
      if (!first) throw new Error('initial Notice partial failure response missing');
      const second = await sync();
      if (!second) throw new Error('changed queued question response missing');
      expect(second.status).toBe(409);
      expect(methods).toEqual(['POST', 'GET']);
    });

  it.each([
    { name: 'question text', change: (question: ReturnType<typeof fileStoreQuestionRoundTrip>) => ({
      ...question, text: `${question.text} (изменено)`,
    }) },
    { name: 'choice content', change: (question: ReturnType<typeof fileStoreQuestionRoundTrip>) => ({
      ...question, choices: question.choices.map((choice, index) => index === 0 ? { ...choice, label: `${choice.label} (изменено)` } : choice),
    }) },
    { name: 'registration target', change: (question: ReturnType<typeof fileStoreQuestionRoundTrip>) => ({
      ...question, registrationTarget: { ...question.registrationTarget, cwd: '/other/project' },
    }) },
  ])('does not recover the durable Notice reference if $name changed', async scenario => {
    const fixture = prepareRegistryExecutorQuestion();
    addAcceptedDirectContinuation(fixture);
    const methods: string[] = [];
    const noticeRequest = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      methods.push(method);
      if (method === 'POST') return noticeResponse({ error: 'deterministic refusal' }, 409);
      return noticeResponse({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', noticeRequest);
    const sync = () => {
      const current = mocks.currentCard.value!;
      return PATCH(new NextRequest(`https://todo.example.test/api/kanban/cards/${fixture.card.id}/execution`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'sync-result', operationId: fixture.operationId, expectedVersion: current.version }),
      }), { params: Promise.resolve({ id: fixture.card.id }) });
    };

    const refused = await sync();
    if (!refused) throw new Error('initial Notice refusal response missing');
    expect(refused.status).toBe(409);
    const current = mocks.currentCard.value!;
    const attempt = current.taskExecutionHistory![0]!;
    const originalQuestion = attempt.executorQuestion!;
    const legacyHash = legacyQuestionRequestHash(fixture, originalQuestion, attempt.taskDecisionRequest!.version);
    const roundTripped = fileStoreQuestionRoundTrip(originalQuestion);
    const changed = scenario.change(roundTripped);
    const changedProof = { ...changed, questionHash: executorQuestionHashForTest(changed as typeof roundTripped) };
    mocks.currentCard.value = { ...current, taskExecutionHistory: [{ ...attempt,
      executorQuestion: changedProof,
      taskDecisionRequest: { ...attempt.taskDecisionRequest!, requestHash: legacyHash },
    }] };

    const rejected = await sync();
    if (!rejected) throw new Error('changed durable question recovery response missing');
    expect(rejected.status).toBe(409);
    expect(methods).toEqual(['POST']);
    expect(mocks.currentCard.value!.taskExecutionHistory![0]!.taskDecisionRequest!.requestHash).toBe(legacyHash);
  });

  it.each([
    { name: 'a different registered UUID', questionIds: ['88ce04db-d775-4f81-a86d-31af4bbe1091'], registryReads: 1 },
    { name: 'a missing registry record', registryRecord: null, registryReads: 1 },
    { name: 'a mismatched registry requestId', registryOverrides: { requestId: '88ce04db-d775-4f81-a86d-31af4bbe1091' }, registryReads: 1 },
    { name: 'a secret request', registryOverrides: { kind: 'secret' }, registryReads: 1 },
    { name: 'a different harness', registryOverrides: { target: { harness: 'codex', sessionId, cwd } }, registryReads: 1 },
    { name: 'a different session', registryOverrides: { target: { harness: 'opencode', sessionId: 'other-session', cwd } }, registryReads: 1 },
    { name: 'a different cwd', registryOverrides: { target: { harness: 'opencode', sessionId, cwd: '/other/project' } }, registryReads: 1 },
    { name: 'a different task context', registryOverrides: { contextRef: 'exmanager-task:other:operation' }, registryReads: 1 },
    { name: 'an unfinished assistant question', questionPhase: 'tool-calls', registryReads: 0 },
    { name: 'ambiguous completed assistant questions', questionIds: [
      '67ce04db-d775-4f81-a86d-31af4bbe1091', '88ce04db-d775-4f81-a86d-31af4bbe1091',
    ], registryReads: 0 },
  ])('does not publish an OpenCode question from $name', async scenario => {
    const fixture = prepareRegistryExecutorQuestion({
      ...(scenario.questionIds ? { questionIds: scenario.questionIds } : {}),
      ...(scenario.questionPhase ? { questionPhase: scenario.questionPhase } : {}),
    });
    const registryRecord = {
      requestId: fixture.humanRequestId, kind: 'user',
      target: { harness: 'opencode', sessionId, cwd: fixture.projectBinding.cwd }, contextRef: fixture.contextRef,
      status: 'pending', answerSource: 'human_channel', continuation: 'resume', createdAt: '2026-10-29T00:00:00.000Z',
      ...(scenario.registryOverrides ?? {}),
    };
    const registryReads: Array<Record<string, unknown>> = [];
    mocks.callOwnerHerderTool.mockImplementation(async (tool: string, args: Record<string, unknown>) => {
      if (tool === 'human_request_get') {
        registryReads.push(args);
        return { structuredContent: { request: scenario.registryRecord === null ? null : registryRecord }, content: [] };
      }
      return toolResult(tool, args);
    });
    const noticeRequest = vi.fn(async () => new Response('{}', { status: 503 }));
    vi.stubGlobal('fetch', noticeRequest);

    const response = await PATCH(new NextRequest(`https://todo.example.test/api/kanban/cards/${fixture.card.id}/execution`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'sync-result', operationId: fixture.operationId, expectedVersion: fixture.card.version }),
    }), { params: Promise.resolve({ id: fixture.card.id }) });

    if (!response) throw new Error('executor question sync response missing');
    expect(response.status).not.toBe(201);
    expect(noticeRequest).not.toHaveBeenCalled();
    expect(mocks.currentCard.value!.taskExecutionHistory?.[0]?.executorQuestion).toBeUndefined();
    expect(registryReads).toHaveLength(scenario.registryReads);
  });

  it('synchronizes an exact completed OpenCode turn from its bound messages resource', async () => {
    mocks.projectRouteOverride.value = { state: 'ready', harness: 'opencode', model: 'omniroute/minimax-combo-m3.1' };
    const response = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('OpenCode task start response missing');
    expect(response.status).toBe(201);
    mocks.sessionInfo.value = {
      ...mocks.sessionInfo.value,
      lastMessage: undefined,
      status: 'idle',
      meta: {},
    };
    const messagesUri = `herder://sessions/opencode/${sessionId}/messages`;
    const initialAttempt = mocks.currentCard.value?.taskExecutionHistory?.[0];
    if (!initialAttempt?.projectBinding) throw new Error('OpenCode project binding missing');
    const exactTaskPrompt = expectedOpenCodeTaskPrompt(baseCard, initialAttempt.operationId, sessionId, initialAttempt.projectBinding.cwd);
    mocks.readOwnerHerderResource.mockResolvedValue({ contents: [{
      uri: messagesUri, mimeType: 'application/json', text: JSON.stringify([
        { id: opencodeInputMessageId(mocks.currentCard.value?.taskExecutionHistory?.[0]?.messageInputId ?? ''), role: 'user',
          turnId: 'turn-1', inputId: mocks.currentCard.value?.taskExecutionHistory?.[0]?.messageInputId,
          phase: 'completed', text: exactTaskPrompt, parts: [{ type: 'text', text: exactTaskPrompt }] },
        { id: 'assistant-1', role: 'assistant', turnId: 'turn-1', phase: 'completed',
          text: 'QA result: three fictional rows; total 2500.',
          parts: [{ type: 'text', text: 'QA result: three fictional rows; total 2500.' }] },
      ]),
    }] });
    mocks.validateTransition.mockImplementation((_card: KanbanCard, updates: { executorResult?: { summary?: string } }) => ({
      kind: 'redirected', patch: { column: 'review', needsReview: true, resultHistory: [{
        summary: updates.executorResult?.summary ?? '', evidenceRefs: [], submittedBy: 'nikita', submittedAt: '2026-10-20T10:06:00.000Z',
      }] },
    }));
    mocks.callOwnerHerderTool.mockClear();
    const current = mocks.currentCard.value!;
    const synchronized = await PATCH(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'sync-result', operationId, expectedVersion: current.version }),
    }), { params: Promise.resolve({ id: baseCard.id }) });
    if (!synchronized) throw new Error('OpenCode result sync response missing');
    expect(synchronized.status).toBe(200);
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.phase).toBe('result');
    expect(mocks.currentCard.value?.column).toBe('review');
    expect(mocks.currentCard.value?.resultHistory?.at(-1)?.summary).toBe('QA result: three fictional rows; total 2500.');
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'fleet_session_view')).toHaveLength(0);
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'agent_info')).toHaveLength(2);
    expect(mocks.readOwnerHerderResource).toHaveBeenCalledWith(messagesUri);
  });

  it('refuses transcript promotion if the exact native turn changes during the read', async () => {
    const first = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!first) throw new Error('first task execution response missing');
    mocks.callOwnerHerderTool.mockClear();
    mocks.turnChangesAfterView.value = true;
    const current = mocks.currentCard.value!;
    const response = await PATCH(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'sync-result', operationId, expectedVersion: current.version }),
    }), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('task sync response missing');

    expect(response.status).toBe(202);
    expect(mocks.currentCard.value?.column).toBe('in-progress');
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.phase).toBe('running');
  });

  it('moves only the exact completed admitted turn to human review', async () => {
    const first = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!first) throw new Error('first task execution response missing');
    mocks.validateTransition.mockReturnValue({
      kind: 'redirected', patch: { column: 'review', needsReview: true, resultHistory: [{
        summary: 'Found two candidates', evidenceRefs: [], submittedBy: 'nikita', submittedAt: '2026-10-20T10:06:00.000Z',
      }] },
    });
    const current = mocks.currentCard.value!;
    const response = await PATCH(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'sync-result', operationId, expectedVersion: current.version }),
    }), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('task sync response missing');

    expect(response.status).toBe(200);
    expect(mocks.currentCard.value?.column).toBe('review');
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]).toMatchObject({
      phase: 'result', nativeTurnId: 'turn-1', lastBoardVersion: mocks.currentCard.value?.version,
    });
  });

  it('admits one owner-instructed generic continuation in the same session and preserves the existing human review result', async () => {
    mocks.currentCard.value = researchCard();
    mocks.sessionInfo.value = {
      ...mocks.sessionInfo.value,
      meta: { nativeLastTurn: { turnId: 'parent-turn', status: 'completed' } },
    };
    const first = await PATCH(followUpRequest('continue-task', 8), { params: Promise.resolve({ id: baseCard.id }) });
    if (!first) throw new Error('task continuation response missing');
    expect(first.status).toBe(202);
    const child = mocks.currentCard.value?.taskExecutionHistory?.[0]?.continuations?.[0];
    expect(child).toMatchObject({ kind: 'task-follow-up-v1', instruction: continuationText, phase: 'running', nativeTurnId: 'turn-1' });
    expect(mocks.currentCard.value).toMatchObject({ column: 'review', needsReview: true, reviewHistory: [] });
    expect(mocks.currentCard.value?.resultHistory?.[0]?.summary).toBe('Original result');
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]).toMatchObject({ phase: 'result', nativeTurnId: 'parent-turn' });
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'fleet_create_session')).toHaveLength(0);
    const send = mocks.callOwnerHerderTool.mock.calls.find(([tool]) => tool === 'send_message');
    expect(send?.[1]).toMatchObject({ sessionId, harness: 'codex', inputId: child?.inputId, mode: 'queue', humanRequested: true });
    expect(send?.[1].message).toContain(continuationText);
    expect(send?.[1].message).toContain('Не пиши людям, не звони');
    expect(send?.[1].message).not.toContain('внедрение Airlock для малого и среднего бизнеса');

    const current = mocks.currentCard.value!;
    const replay = await PATCH(followUpRequest('continue-task', current.version), { params: Promise.resolve({ id: baseCard.id }) });
    if (!replay) throw new Error('research continuation replay response missing');
    expect(replay.status).toBe(202);
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'send_message')).toHaveLength(1);
  });

  it('continues an assigned rework in the same turnless OpenCode session from exact parent and child delivery jobs', async () => {
    mocks.identity.value = { username: 'testlogin', scope: 'work' };
    mocks.currentCard.value = openCodeReworkCard();
    const model = 'omniroute/minimax-combo-m3.1';
    mocks.sessionInfo.value = { id: sessionId, harness: 'opencode', hostId: 'roomhacker-server-100',
      cwd: scopedProjectRoot, model, status: 'idle', needsPermission: false, meta: {} };
    const nativeMessageId = 'msg_17f4466d6001ChildQA';
    mocks.callOwnerHerderTool.mockImplementation((tool: string, args: Record<string, unknown>) => {
      if (tool === 'send_message') return { content: [{ type: 'text', text: `Message accepted by [opencode] ${sessionId}; native turn start is still being verified.` }] };
      if (tool === 'job_get') {
        const jobId = String(args.jobId);
        const parent = mocks.currentCard.value!.taskExecutionHistory![0]!;
        const child = parent.continuations?.[0];
        const isParent = jobId === parent.nativeDispatchJobId;
        const inputId = isParent ? parent.messageInputId : child?.inputId;
        const id = isParent ? parent.nativeInputMessageId : nativeMessageId;
        return { structuredContent: { job: { id: jobId, kind: 'Доставка сообщения', state: 'completed', ownerSessionId: sessionId,
          onceKey: ['user-message', 'opencode', sessionId, inputId].join('\0'),
          result: { ok: true, admitted: true, admission: 'accepted', inputId, nativeInputMessageId: id },
        } }, content: [] };
      }
      return toolResult(tool, args);
    });

    const response = await PATCH(followUpRequest('continue-task', 29, undefined,
      'Добавь строку Итого 2500, сохрани три заявки и их статусы.', false), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('turnless OpenCode rework follow-up response missing');
    expect(response.status).toBe(202);
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.continuations?.[0]).toMatchObject({
      phase: 'running', nativeDispatchJobId: expect.stringMatching(/^job_[a-f0-9]{64}$/), nativeInputMessageId: nativeMessageId,
    });
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.continuations?.[0]?.nativeTurnId).toBeUndefined();
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'send_message')).toHaveLength(1);
    expect(mocks.callOwnerHerderTool.mock.calls.find(([tool]) => tool === 'send_message')?.[1])
      .toMatchObject({ sessionId, harness: 'opencode', mode: 'queue', humanRequested: true });

    const child = mocks.currentCard.value!.taskExecutionHistory![0]!.continuations![0]!;
    mocks.sessionInfo.value = { ...mocks.sessionInfo.value, status: 'idle', meta: {} };
    const messagesUri = `herder://sessions/opencode/${sessionId}/messages`;
    mocks.readOwnerHerderResource.mockResolvedValue({ contents: [{ uri: messagesUri, mimeType: 'application/json', text: JSON.stringify([
      { id: nativeMessageId, inputId: child.inputId, role: 'user', parts: [{ type: 'text', text: 'Добавь итоговую строку.' }] },
      { id: 'msg_17f4466d6001FinalQa', role: 'assistant', phase: 'completed',
        parts: [{ type: 'thinking', text: 'не сохранять' }, { type: 'text', text: '| A | 1200 | ожидает файл |\n| B | 800 | проверка |\n| C | 500 | сверка |\n| Итого | 2500 | |' }] },
    ]) }] });
    const synced = await PATCH(followUpRequest('sync-task-continuation', mocks.currentCard.value!.version, child.id),
      { params: Promise.resolve({ id: baseCard.id }) });
    if (!synced) throw new Error('turnless OpenCode rework result sync missing');
    expect(synced.status).toBe(200);
    expect(mocks.currentCard.value).toMatchObject({ column: 'review', needsReview: true, requiresApprovalFrom: ['testlogin'] });
    expect(mocks.currentCard.value?.resultHistory?.map(item => item.summary)).toEqual([
      'Original result', '| A | 1200 | ожидает файл |\n| B | 800 | проверка |\n| C | 500 | сверка |\n| Итого | 2500 | |',
    ]);
    expect(mocks.currentCard.value?.reviewHistory?.at(-1)?.decision).toBe('rework');
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.continuations?.[0]).toMatchObject({ phase: 'result' });
  });

  it('unwraps an observed Herder envelope before accepting a continuation receipt', async () => {
    mocks.currentCard.value = researchCard();
    mocks.sessionInfo.value = { ...mocks.sessionInfo.value, meta: { nativeLastTurn: { turnId: 'parent-turn', status: 'completed' } } };
    mocks.callOwnerHerderTool.mockImplementation((tool: string, args: Record<string, unknown>) => tool === 'send_message'
      ? observedHerderDelivery(`Native admission receipt: ${JSON.stringify({ admitted: true, inputId: args.inputId, turnId: 'continuation-envelope' })}`, String(args.inputId), {
        hostId: 'roomhacker-server-100', harness: String(args.harness), sessionId: String(args.sessionId),
      })
      : toolResult(tool, args));

    const response = await PATCH(followUpRequest('continue-task', 8), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('continuation response missing');
    expect(response.status).toBe(202);
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.continuations?.[0]).toMatchObject({
      phase: 'running', nativeTurnId: 'continuation-envelope',
    });
  });

  it('keeps a pending Herder observation without admission UNKNOWN and does not replay it', async () => {
    mocks.callOwnerHerderTool.mockImplementation((tool: string, args: Record<string, unknown>) => tool === 'send_message'
      ? observedHerderDelivery('Message accepted; native admission is still pending.', String(args.inputId), {
        hostId: 'roomhacker-server-100', harness: String(args.harness), sessionId: String(args.sessionId),
      })
      : toolResult(tool, args));

    const first = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!first) throw new Error('pending dispatch response missing');
    expect(first.status).toBe(202);
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.phase).toBe('dispatch-unknown');
    const sendCount = mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'send_message').length;

    const replay = await POST(postRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!replay) throw new Error('pending dispatch replay response missing');
    expect(replay.status).toBe(202);
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.phase).toBe('dispatch-unknown');
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'send_message')).toHaveLength(sendCount);
  });

  it('lets a current project manager append one child to another actor legacy parent without remapping or cross-actor replay', async () => {
    const forProject = vi.fn(async () => ({ project: 'Demo', team: 'integrator', readAllowed: true as const, writeAllowed: true }));
    mocks.nativeProjectAccess.value = { userId: 'native-manager-b', forProject };
    mocks.currentCard.value = researchCard();
    mocks.sessionInfo.value = { ...mocks.sessionInfo.value, meta: { nativeLastTurn: { turnId: 'parent-turn', status: 'completed' } } };

    const first = await PATCH(followUpRequest('continue-task', 8, undefined, continuationText, true), { params: Promise.resolve({ id: baseCard.id }) });
    if (!first) throw new Error('shared-project continuation response missing');
    expect(first.status).toBe(202);
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]).toMatchObject({ startedBy: 'nikita', nativeSessionId: sessionId });
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.continuations?.[0]).toMatchObject({ requestedBy: 'native-manager-b', phase: 'running' });
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'send_message')).toHaveLength(1);

    const current = mocks.currentCard.value!;
    mocks.nativeProjectAccess.value = null;
    const legacyReplay = await PATCH(followUpRequest('continue-task', current.version), { params: Promise.resolve({ id: baseCard.id }) });
    if (!legacyReplay) throw new Error('legacy cross-actor replay response missing');
    expect(legacyReplay.status).toBe(409);
    mocks.nativeProjectAccess.value = { userId: 'native-manager-c', forProject };
    const replay = await PATCH(followUpRequest('continue-task', current.version, undefined, continuationText, true), { params: Promise.resolve({ id: baseCard.id }) });
    if (!replay) throw new Error('cross-actor replay response missing');
    expect(replay.status).toBe(409);
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'send_message')).toHaveLength(1);
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.startedBy).toBe('nikita');
  });

  it('keeps an unknown child non-replayable by a different current project manager', async () => {
    const forProject = vi.fn(async () => ({ project: 'Demo', team: 'integrator', readAllowed: true as const, writeAllowed: true }));
    mocks.nativeProjectAccess.value = { userId: 'native-manager-b', forProject };
    mocks.currentCard.value = researchCard();
    mocks.sessionInfo.value = { ...mocks.sessionInfo.value, meta: { nativeLastTurn: { turnId: 'parent-turn', status: 'completed' } } };
    mocks.callOwnerHerderTool.mockImplementation((tool: string, args: Record<string, unknown>) => {
      if (tool === 'send_message') throw new Error('ambiguous dispatch');
      return toolResult(tool, args);
    });
    const first = await PATCH(followUpRequest('continue-task', 8, undefined, continuationText, true), { params: Promise.resolve({ id: baseCard.id }) });
    if (!first) throw new Error('native unknown child response missing');
    expect(first.status).toBe(202);
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.continuations?.[0]).toMatchObject({ requestedBy: 'native-manager-b', phase: 'unknown' });

    mocks.nativeProjectAccess.value = { userId: 'native-manager-c', forProject };
    const current = mocks.currentCard.value!;
    const replay = await PATCH(followUpRequest('continue-task', current.version, undefined, continuationText, true), { params: Promise.resolve({ id: baseCard.id }) });
    if (!replay) throw new Error('cross-actor unknown replay response missing');
    expect(replay.status).toBe(409);
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'send_message')).toHaveLength(1);
  });

  it('keeps the complete owner instruction and fixed rules when long card context must be shortened', async () => {
    const longDescription = `CARD-CONTEXT-START ${'Карточный контекст '.repeat(3_000)} CARD-CONTEXT-END`;
    const instruction = 'Use official public sources only; do not contact anyone. OWNER-INSTRUCTION-END-MARKER';
    mocks.currentCard.value = researchCard(longDescription);
    mocks.sessionInfo.value = {
      ...mocks.sessionInfo.value,
      meta: { nativeLastTurn: { turnId: 'parent-turn', status: 'completed' } },
    };

    const response = await PATCH(followUpRequest('continue-task', 8, undefined, instruction), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('long-card continuation response missing');
    expect(response.status).toBe(202);

    const send = mocks.callOwnerHerderTool.mock.calls.find(([tool]) => tool === 'send_message');
    const prompt = send?.[1].message;
    if (typeof prompt !== 'string') throw new Error('long-card continuation prompt missing');
    expect(prompt).toContain(JSON.stringify(instruction));
    expect(prompt).toContain('Выполни только это ограниченное продолжение. Используй доступные надёжные источники');
    expect(prompt).toContain('Не пиши людям, не звони, не отправляй формы и не меняй внешние данные.');
    expect(prompt).toContain('Не отмечай карточку выполненной и не утверждай, что человек принял результат. Верни результат и источники для обычной проверки человеком.');
    expect(prompt).toContain('… [контекст сокращён]');
    expect(prompt).not.toContain('CARD-CONTEXT-END');
    expect(prompt.length).toBeLessThanOrEqual(48_000);
  });

  it('keeps an unknown continuation query-only after uncertain dispatch', async () => {
    mocks.currentCard.value = researchCard();
    mocks.sessionInfo.value = { ...mocks.sessionInfo.value, meta: { nativeLastTurn: { turnId: 'parent-turn', status: 'completed' } } };
    mocks.callOwnerHerderTool.mockImplementation((tool: string, args: Record<string, unknown>) => {
      if (tool === 'send_message') throw new Error('ambiguous dispatch');
      return toolResult(tool, args);
    });
    const first = await PATCH(followUpRequest('continue-task', 8), { params: Promise.resolve({ id: baseCard.id }) });
    if (!first) throw new Error('unknown continuation response missing');
    expect(first.status).toBe(202);
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.continuations?.[0]?.phase).toBe('unknown');
    const current = mocks.currentCard.value!;
    const replay = await PATCH(followUpRequest('continue-task', current.version), { params: Promise.resolve({ id: baseCard.id }) });
    if (!replay) throw new Error('unknown continuation query response missing');
    expect(replay.status).toBe(202);
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'send_message')).toHaveLength(1);
    const changedText = await PATCH(followUpRequest('continue-task', current.version, undefined, 'A different instruction'), { params: Promise.resolve({ id: baseCard.id }) });
    if (!changedText) throw new Error('changed instruction response missing');
    expect(changedText.status).toBe(409);
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'send_message')).toHaveLength(1);
  });

  it('keeps a late native admission receipt when the card is edited during send', async () => {
    mocks.currentCard.value = researchCard();
    mocks.sessionInfo.value = { ...mocks.sessionInfo.value, meta: { nativeLastTurn: { turnId: 'parent-turn', status: 'completed' } } };
    mocks.callOwnerHerderTool.mockImplementation((tool: string, args: Record<string, unknown>) => {
      if (tool === 'send_message') {
        mocks.currentCard.value = { ...mocks.currentCard.value!, version: mocks.currentCard.value!.version + 1,
          tags: ['edited while send was in flight'] };
      }
      return toolResult(tool, args);
    });
    const response = await PATCH(followUpRequest('continue-task', 8), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('late admission response missing');
    expect(response.status).toBe(202);
    expect(mocks.currentCard.value?.tags).toEqual(['edited while send was in flight']);
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.continuations?.[0]).toMatchObject({
      phase: 'running', inputId: expect.any(String), nativeTurnId: 'turn-1',
    });
    expect(mocks.currentCard.value?.column).toBe('review');
    expect(mocks.currentCard.value?.needsReview).toBe(true);
  });

  it('serializes concurrent duplicate continuation requests to one durable intent and one dispatch', async () => {
    mocks.currentCard.value = researchCard();
    mocks.sessionInfo.value = { ...mocks.sessionInfo.value, meta: { nativeLastTurn: { turnId: 'parent-turn', status: 'completed' } } };
    const [first, duplicate] = await Promise.all([
      PATCH(followUpRequest('continue-task', 8), { params: Promise.resolve({ id: baseCard.id }) }),
      PATCH(followUpRequest('continue-task', 8), { params: Promise.resolve({ id: baseCard.id }) }),
    ]);
    if (!first || !duplicate) throw new Error('concurrent continuation response missing');
    expect([first.status, duplicate.status].sort()).toEqual([202, 409]);
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.continuations).toHaveLength(1);
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'send_message')).toHaveLength(1);
  });

  it('denies continuation for stale version, changed card, or non-owner before dispatch', async () => {
    mocks.currentCard.value = researchCard();
    const stale = await PATCH(followUpRequest('continue-task', 7), { params: Promise.resolve({ id: baseCard.id }) });
    if (!stale) throw new Error('stale continuation response missing');
    expect(stale.status).toBe(409);
    mocks.currentCard.value = { ...researchCard(), version: 9, tags: ['changed'] };
    const changed = await PATCH(followUpRequest('continue-task', 9), { params: Promise.resolve({ id: baseCard.id }) });
    if (!changed) throw new Error('changed continuation response missing');
    expect(changed.status).toBe(409);
    mocks.currentCard.value = researchCard();
    mocks.identity.value = { username: 'other', scope: 'work' };
    const unauthorized = await PATCH(followUpRequest('continue-task', 8), { params: Promise.resolve({ id: baseCard.id }) });
    if (!unauthorized) throw new Error('unauthorized continuation response missing');
    expect(unauthorized.status).toBe(403);
    expect(mocks.callOwnerHerderTool).not.toHaveBeenCalled();
    expect(mocks.updateCard).not.toHaveBeenCalled();
  });

  it('lets a second current manager reconcile the exact child result without changing parent actor or review history', async () => {
    const projectWrite = (userId: string) => ({ userId, forProject: vi.fn(async () => ({ project: 'Demo', team: 'integrator', readAllowed: true as const, writeAllowed: true })) });
    mocks.nativeProjectAccess.value = projectWrite('native-manager-b');
    mocks.currentCard.value = researchCard();
    mocks.sessionInfo.value = { ...mocks.sessionInfo.value, meta: { nativeLastTurn: { turnId: 'parent-turn', status: 'completed' } } };
    const first = await PATCH(followUpRequest('continue-task', 8, undefined, continuationText, true), { params: Promise.resolve({ id: baseCard.id }) });
    if (!first) throw new Error('research continuation admission missing');
    const admitted = mocks.currentCard.value!;
    expect(admitted.taskExecutionHistory?.[0]?.startedBy).toBe('nikita');
    expect(admitted.taskExecutionHistory?.[0]?.continuations?.[0]?.requestedBy).toBe('native-manager-b');
    const continuationId = admitted.taskExecutionHistory?.[0]?.continuations?.[0]?.id;
    if (!continuationId) throw new Error('persisted continuation ID missing');
    const writeCount = mocks.updateCard.mock.calls.length;
    mocks.sessionInfo.value = { ...mocks.sessionInfo.value, status: 'idle', meta: { nativeLastTurn: { turnId: 'other-turn', status: 'completed' } } };
    const mismatched = await PATCH(followUpRequest('sync-task-continuation', admitted.version, continuationId), { params: Promise.resolve({ id: baseCard.id }) });
    if (!mismatched) throw new Error('mismatched child turn response missing');
    expect(mismatched.status).toBe(202);
    expect(mocks.currentCard.value?.version).toBe(admitted.version);
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.continuations?.[0]?.phase).toBe('running');
    expect(mocks.updateCard).toHaveBeenCalledTimes(writeCount);
    mocks.sessionInfo.value = { ...mocks.sessionInfo.value, status: 'idle', meta: { nativeLastTurn: { turnId: 'turn-1', status: 'completed' } } };
    mocks.nativeProjectAccess.value = projectWrite('native-manager-c');
    const response = await PATCH(followUpRequest('sync-task-continuation', admitted.version, continuationId, continuationText, true), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('research continuation sync missing');
    expect(response.status).toBe(200);
    expect(mocks.currentCard.value).toMatchObject({ column: 'review', needsReview: true, reviewHistory: [] });
    expect(mocks.currentCard.value?.resultHistory?.map(item => item.summary)).toEqual(['Original result', 'Found two candidates']);
    expect(mocks.currentCard.value?.resultHistory?.[1]?.submittedBy).toBe('native-manager-c');
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.phase).toBe('result');
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.continuations?.[0]).toMatchObject({
      phase: 'result', nativeTurnId: 'turn-1', summary: 'Found two candidates',
    });
    expect(mocks.validateTransition).not.toHaveBeenCalled();
    const savedVersion = mocks.currentCard.value!.version;
    const duplicateSync = await PATCH(followUpRequest('sync-task-continuation', savedVersion, continuationId, continuationText, true), { params: Promise.resolve({ id: baseCard.id }) });
    if (!duplicateSync) throw new Error('duplicate child result readback missing');
    expect(duplicateSync.status).toBe(200);
    expect(mocks.currentCard.value?.resultHistory?.map(item => item.summary)).toEqual(['Original result', 'Found two candidates']);
  });

  it('does not commit a child result if the card version changes during transcript read', async () => {
    mocks.currentCard.value = researchCard();
    mocks.sessionInfo.value = { ...mocks.sessionInfo.value, meta: { nativeLastTurn: { turnId: 'parent-turn', status: 'completed' } } };
    const first = await PATCH(followUpRequest('continue-task', 8), { params: Promise.resolve({ id: baseCard.id }) });
    if (!first) throw new Error('task continuation admission missing');
    const admitted = mocks.currentCard.value!;
    const continuationId = admitted.taskExecutionHistory?.[0]?.continuations?.[0]?.id;
    if (!continuationId) throw new Error('persisted continuation ID missing');
    mocks.sessionInfo.value = { ...mocks.sessionInfo.value, status: 'idle', meta: { nativeLastTurn: { turnId: 'turn-1', status: 'completed' } } };
    mocks.cardChangesAfterView.value = true;
    const writeCount = mocks.updateCard.mock.calls.length;
    const response = await PATCH(followUpRequest('sync-task-continuation', admitted.version, continuationId), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('stale child sync response missing');
    expect(response.status).toBe(409);
    expect(mocks.currentCard.value?.tags).toEqual(['edited during transcript read']);
    expect(mocks.currentCard.value?.column).toBe('review');
    expect(mocks.currentCard.value?.needsReview).toBe(true);
    expect(mocks.currentCard.value?.reviewHistory).toEqual([]);
    expect(mocks.currentCard.value?.resultHistory?.map(item => item.summary)).toEqual(['Original result']);
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.continuations?.[0]?.phase).toBe('running');
    expect(mocks.updateCard).toHaveBeenCalledTimes(writeCount);
  });

  it('creates a Notice question only by explicit authenticated CAS action and stores its deterministic reference', async () => {
    vi.stubEnv('EXMANAGER_NOTICE_PROJECT_TOKEN', 'fixture-only-token');
    vi.stubEnv('NOTIFY_CENTER_RECIPIENT', 'operator-fixture');
    mocks.currentCard.value = runningQuestionCard();
    const expectedVersion = baseCard.version + 1;
    const requestId = expectedNoticeRequestId(baseCard.id, 'clarify-scope', expectedVersion);
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      const body = JSON.parse(String(init?.body)) as { mandate: Record<string, unknown> };
      expect(Object.keys(body)).toEqual(['mandate']);
      expect(body.mandate).toMatchObject({
        task_ref: baseCard.id, purpose: 'clarify-scope', version: String(expectedVersion),
        mandate_ref: canonicalQuestionOperationId, project: 'Demo', recipient: 'operator-fixture',
        timeout_value: 'current',
      });
      expect(body.mandate).not.toHaveProperty('actor');
      expect(body.mandate).not.toHaveProperty('host_id');
      return noticeResponse({
        ...noticeQuestionView({ requestId, taskRef: baseCard.id, operationId: canonicalQuestionOperationId,
          purpose: 'clarify-scope', version: expectedVersion, deliveryStatus: 'sent', idempotent: false }),
      }, 201);
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await PATCH(createQuestionRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('task question response missing');
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.taskQuestion).toMatchObject({ requestId, purpose: 'clarify-scope', version: expectedVersion,
      state: 'pending', deliveryStatus: 'sent', notification: { delivered: true } });
    expect(body.taskQuestion.notification).not.toHaveProperty('receipt');
    expect(mocks.currentCard.value?.version).toBe(expectedVersion);
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]).toMatchObject({
      lastBoardVersion: expectedVersion,
      taskDecisionRequest: { requestId, requestHash: expect.stringMatching(/^[a-f0-9]{64}$/), purpose: 'clarify-scope', version: expectedVersion },
    });
    expect(mocks.updateCard).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.callOwnerHerderTool).not.toHaveBeenCalled();
  });

  it('rejects stale version, wrong actor and caller-supplied recipient before writes or Notice calls', async () => {
    vi.stubEnv('EXMANAGER_NOTICE_PROJECT_TOKEN', 'fixture-only-token');
    vi.stubEnv('NOTIFY_CENTER_RECIPIENT', 'operator-fixture');
    mocks.currentCard.value = runningQuestionCard();
    vi.stubGlobal('fetch', vi.fn());
    const stale = await PATCH(createQuestionRequest(baseCard.version - 1), { params: Promise.resolve({ id: baseCard.id }) });
    if (!stale) throw new Error('stale question response missing');
    expect(stale.status).toBe(409);
    expect(mocks.updateCard).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();

    mocks.identity.value = { username: 'unassigned', scope: 'work' };
    const wrongActor = await PATCH(createQuestionRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!wrongActor) throw new Error('actor-denial response missing');
    expect(wrongActor.status).toBe(403);
    expect(mocks.updateCard).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();

    mocks.identity.value = { username: 'nikita', scope: 'work' };
    const forgedRecipient = await PATCH(createQuestionRequest(baseCard.version, { recipient: 'other-person' }), {
      params: Promise.resolve({ id: baseCard.id }),
    });
    if (!forgedRecipient) throw new Error('recipient-denial response missing');
    expect(forgedRecipient.status).toBe(400);
    expect(mocks.updateCard).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails closed before the CAS write when the protected Notice bearer or fixed recipient is absent', async () => {
    vi.stubEnv('EXMANAGER_NOTICE_PROJECT_TOKEN', '');
    vi.stubEnv('NOTIFY_CENTER_RECIPIENT', '');
    mocks.currentCard.value = runningQuestionCard();
    vi.stubGlobal('fetch', vi.fn());
    const response = await PATCH(createQuestionRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!response) throw new Error('unconfigured Notice response missing');
    expect(response.status).toBe(503);
    expect(mocks.updateCard).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reads only the stored Notice request and exposes timeout without transport identifiers', async () => {
    vi.stubEnv('EXMANAGER_NOTICE_PROJECT_TOKEN', 'fixture-only-token');
    const version = baseCard.version + 1;
    const requestId = expectedNoticeRequestId(baseCard.id, 'clarify-scope', version);
    const card = runningQuestionCard();
    card.version = version;
    card.taskExecutionHistory![0] = {
      ...card.taskExecutionHistory![0]!,
      lastBoardVersion: version,
      taskDecisionRequest: { requestId, requestHash: 'a'.repeat(64), purpose: 'clarify-scope', version },
    };
    mocks.currentCard.value = card;
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => noticeResponse(noticeQuestionView({
      requestId, taskRef: baseCard.id, operationId: canonicalQuestionOperationId,
      purpose: 'clarify-scope', version,
      winner: { source: 'timeout', value: 'current', decided_at: 789 },
    }), 200));
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution?question=latest'), {
      params: Promise.resolve({ id: baseCard.id }),
    });
    if (!response) throw new Error('task question read response missing');
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.taskQuestion).toMatchObject({ requestId, state: 'expired', decision: { source: 'timeout', value: 'current', decidedAt: 789 } });
    expect(JSON.stringify(body)).not.toContain('private-id');
    expect(JSON.stringify(body)).not.toContain('message_id');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('GET');
    expect(mocks.updateCard).not.toHaveBeenCalled();
  });

  it('rejects canonical Notice views bound to a different Board project or configured recipient', async () => {
    vi.stubEnv('EXMANAGER_NOTICE_PROJECT_TOKEN', 'fixture-only-token');
    const version = baseCard.version + 1;
    const requestId = expectedNoticeRequestId(baseCard.id, 'clarify-scope', version);
    const card = runningQuestionCard();
    card.version = version;
    card.taskExecutionHistory![0] = {
      ...card.taskExecutionHistory![0]!,
      lastBoardVersion: version,
      taskDecisionRequest: { requestId, requestHash: 'a'.repeat(64), purpose: 'clarify-scope', version },
    };
    mocks.currentCard.value = card;

    for (const mismatch of [{ project: 'Different project' }, { recipient: 'different-recipient' }]) {
      const payload = noticeQuestionView({ requestId, taskRef: baseCard.id,
        operationId: canonicalQuestionOperationId, purpose: 'clarify-scope', version });
      const fetchMock = vi.fn(async () => noticeResponse({ ...payload, ...mismatch }, 200));
      vi.stubGlobal('fetch', fetchMock);
      const response = await GET(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution?question=latest'), {
        params: Promise.resolve({ id: baseCard.id }),
      });
      if (!response) throw new Error('mismatched Notice view response missing');
      expect(response.status).toBe(502);
      expect(await response.json()).toMatchObject({ taskQuestion: { requestId, state: 'unknown' } });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
    expect(mocks.updateCard).not.toHaveBeenCalled();
  });

  it('requires a successful sender receipt before projecting a Notice deadline', async () => {
    vi.stubEnv('EXMANAGER_NOTICE_PROJECT_TOKEN', 'fixture-only-token');
    const version = baseCard.version + 1;
    const requestId = expectedNoticeRequestId(baseCard.id, 'clarify-scope', version);
    const card = runningQuestionCard();
    card.version = version;
    card.taskExecutionHistory![0] = {
      ...card.taskExecutionHistory![0]!,
      lastBoardVersion: version,
      taskDecisionRequest: { requestId, requestHash: 'a'.repeat(64), purpose: 'clarify-scope', version },
    };
    mocks.currentCard.value = card;
    const malformed = noticeQuestionView({ requestId, taskRef: baseCard.id,
      operationId: canonicalQuestionOperationId, purpose: 'clarify-scope', version }) as Record<string, unknown>;
    const malformedNotification = malformed.notification as Record<string, unknown>;
    malformedNotification.receipt = null;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(noticeResponse(malformed, 200))
      .mockResolvedValueOnce(noticeResponse({ ...malformed,
        notification: { ...malformedNotification, deadline_at: null } }, 200));
    vi.stubGlobal('fetch', fetchMock);
    const request = () => new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution?question=latest');
    const params = { params: Promise.resolve({ id: baseCard.id }) };

    const inconsistent = await GET(request(), params);
    if (!inconsistent) throw new Error('inconsistent deadline response missing');
    expect(inconsistent.status).toBe(502);

    const validNoReceipt = await GET(request(), params);
    if (!validNoReceipt) throw new Error('no-receipt Notice response missing');
    expect(validNoReceipt.status).toBe(200);
    expect(await validNoReceipt.json()).toMatchObject({ taskQuestion: { notification: { delivered: false, deadlineAt: null } } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('projects a human answer through the same authenticated read route', async () => {
    vi.stubEnv('EXMANAGER_NOTICE_PROJECT_TOKEN', 'fixture-only-token');
    const version = baseCard.version + 1;
    const requestId = expectedNoticeRequestId(baseCard.id, 'clarify-scope', version);
    const card = runningQuestionCard();
    card.version = version;
    card.taskExecutionHistory![0] = {
      ...card.taskExecutionHistory![0]!,
      lastBoardVersion: version,
      taskDecisionRequest: { requestId, requestHash: 'a'.repeat(64), purpose: 'clarify-scope', version },
    };
    mocks.currentCard.value = card;
    vi.stubGlobal('fetch', vi.fn(async () => noticeResponse(noticeQuestionView({
      requestId, taskRef: baseCard.id, operationId: canonicalQuestionOperationId,
      purpose: 'clarify-scope', version,
      winner: { source: 'human', value: 'all', decided_at: 789 },
    }), 200)));

    const response = await GET(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution?question=latest'), {
      params: Promise.resolve({ id: baseCard.id }),
    });
    if (!response) throw new Error('human answer read response missing');
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.taskQuestion).toMatchObject({ state: 'resolved', decision: { source: 'human', value: 'all', decidedAt: 789 } });
  });

  it('keeps ambiguous creation query-only on read/reopen and recovers only after the same ID is authoritatively absent', async () => {
    vi.stubEnv('EXMANAGER_NOTICE_PROJECT_TOKEN', 'fixture-only-token');
    vi.stubEnv('NOTIFY_CENTER_RECIPIENT', 'operator-fixture');
    mocks.currentCard.value = runningQuestionCard();
    const requestId = expectedNoticeRequestId(baseCard.id, 'clarify-scope', baseCard.version + 1);
    let allowRetry = false;
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'GET') return noticeResponse({ error: 'not found' }, 404);
      if (!allowRetry) throw new Error('synthetic ambiguous Notice response');
      const mandate = JSON.parse(String(init?.body)).mandate as Record<string, unknown>;
      return noticeResponse(noticeQuestionView({ requestId, taskRef: baseCard.id,
        operationId: canonicalQuestionOperationId, purpose: 'clarify-scope', version: Number(mandate.version),
        deliveryStatus: 'sent', idempotent: true }), 200);
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = await PATCH(createQuestionRequest(), { params: Promise.resolve({ id: baseCard.id }) });
    if (!first) throw new Error('initial question response missing');
    expect(first.status).toBe(202);
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.taskDecisionRequest?.requestId).toBe(requestId);

    const read = await GET(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution?question=latest'), {
      params: Promise.resolve({ id: baseCard.id }),
    });
    if (!read) throw new Error('question read response missing');
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ taskQuestion: { requestId, state: 'not_found' } });
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'GET']);

    allowRetry = true;
    const currentVersion = mocks.currentCard.value!.version;
    const retry = await PATCH(createQuestionRequest(currentVersion), { params: Promise.resolve({ id: baseCard.id }) });
    if (!retry) throw new Error('question retry response missing');
    expect(retry.status).toBe(200);
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'GET', 'GET', 'POST']);
    const postedMandates = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')
      .map(([, init]) => JSON.parse(String(init?.body)).mandate as Record<string, unknown>);
    expect(postedMandates).toHaveLength(2);
    expect(postedMandates[0]).toEqual(postedMandates[1]);
    expect(postedMandates[0]?.version).toBe(String(currentVersion));
  });

  it('reconciles an idle admitted OpenCode session from its exact first-user proof without claiming a result', async () => {
    mocks.projectRouteOverride.value = { state: 'ready', harness: 'opencode', model: 'omniroute/minimax-combo-m3.1' };
    const projectBinding = openCodeProjectBinding();
    const exactOperationId = 'e'.repeat(64);
    const inputId = createHash('sha256').update(`${exactOperationId}\0dispatch`).digest('hex');
    const nativeInputMessageId = 'msg_idle_admitted_123456';
    const initialMessage = { id: nativeInputMessageId, role: 'user', inputId,
      parts: [{ type: 'text', text: expectedOpenCodeTaskPrompt({ ...baseCard, id: controlCardId }, exactOperationId, controlSessionId, projectBinding.cwd) }] };
    const requestHash = createHash('sha256').update(JSON.stringify({
      id: controlCardId, title: baseCard.title, description: baseCard.description, project: baseCard.project,
      owner: baseCard.owner ?? 'nikita', assignee: baseCard.assignee ?? null, assignees: baseCard.assignees,
      actor: 'nikita', hostId: 'roomhacker-server-100', harness: 'opencode', cwd: projectBinding.cwd,
      model: projectBinding.model, projectBinding,
    })).digest('hex');
    mocks.currentCard.value = { ...baseCard, id: controlCardId, version: 5, column: 'todo', taskExecutionHistory: [{
      operationId: exactOperationId, requestHash, lastBoardVersion: 5, createInputId: '1'.repeat(64),
      messageInputId: inputId, phase: 'dispatch-unknown', hostId: 'roomhacker-server-100', harness: 'opencode',
      nativeSessionId: controlSessionId, projectBinding, startedBy: 'nikita', createdAt: baseCard.created, updatedAt: baseCard.updated,
    }] };
    mocks.sessionInfo.value = { id: controlSessionId, harness: 'opencode', hostId: 'roomhacker-server-100',
      cwd: projectBinding.cwd, model: projectBinding.model, status: 'idle', needsPermission: false,
      meta: { nativeLastTurn: { turnId: 'foreign-turn', status: 'completed' } } };
    mocks.callOwnerHerderTool.mockImplementation((tool: string, args: Record<string, unknown>) => {
      if (tool === 'job_get') {
        const jobId = userMessageJobId(controlSessionId, inputId);
        return { structuredContent: { job: { id: jobId, state: 'completed', ownerSessionId: controlSessionId,
          onceKey: ['user-message', 'opencode', controlSessionId, inputId].join('\0'),
          result: { ok: true, admitted: true, inputId, nativeInputMessageId }, } }, content: [] };
      }
      return toolResult(tool, args);
    });
    const firstUserUri = `herder://sessions/opencode/${controlSessionId}/first-user-message`;
    const messagesUri = `herder://sessions/opencode/${controlSessionId}/messages`;
    const initialJobId = userMessageJobId(controlSessionId, inputId);
    let nativeMessages: Array<Record<string, unknown>> = [{ id: 'msg_foreign_user_123456', role: 'user',
      parts: [{ type: 'text', text: 'Позднее чужое поручение' }] }];
    mocks.readOwnerHerderResource.mockImplementation(async (uri: string) => ({ contents: [{ uri, mimeType: 'application/json',
      text: JSON.stringify(uri === firstUserUri ? initialMessage : nativeMessages) }] }));

    const response = await PATCH(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        action: 'sync-result', operationId: exactOperationId, expectedVersion: 5,
      }),
    }), { params: Promise.resolve({ id: controlCardId }) });
    if (!response) throw new Error('idle admission reconciliation response missing');

    expect(response.status).toBe(202);
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]).toMatchObject({
      phase: 'waiting', nativeSessionId: controlSessionId, messageInputId: inputId,
      nativeDispatchJobId: userMessageJobId(controlSessionId, inputId), nativeInputMessageId,
      lastProgress: expect.stringMatching(/простаивает.*результат.*не принят/i),
    });
    expect(mocks.currentCard.value?.resultHistory).toBeUndefined();
    expect(mocks.currentCard.value?.column).toBe('todo');
    expect(mocks.readOwnerHerderResource).toHaveBeenCalledWith(messagesUri);
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([name]) => name === 'send_message')).toHaveLength(0);

    mocks.callOwnerHerderTool.mockImplementation((tool: string, args: Record<string, unknown>) => {
      if (tool === 'job_get' && args.jobId === initialJobId) return { structuredContent: { job: {
        id: initialJobId, state: 'completed', ownerSessionId: controlSessionId,
        onceKey: ['user-message', 'opencode', controlSessionId, inputId].join('\0'),
        result: { ok: true, admitted: true, inputId, nativeInputMessageId },
      } }, content: [] };
      if (tool === 'send_message') {
        nativeMessages.push({ id: opencodeInputMessageId(String(args.inputId)), role: 'user', inputId: args.inputId,
          parts: [{ type: 'text', text: args.message }] });
        return toolResult(tool, args);
      }
      if (tool === 'job_get') return opencodeJobGetResult(String(args.jobId));
      return toolResult(tool, args);
    });
    const directText = 'Выполни один безопасный следующий шаг в той же задаче.';
    const direct = await PATCH(sessionControlRequest({ action: 'session-direct', expectedVersion: mocks.currentCard.value!.version, message: directText }), {
      params: Promise.resolve({ id: controlCardId }),
    });
    if (!direct) throw new Error('explicit idle direct response missing');
    expect(direct.status, JSON.stringify(await direct.clone().json())).toBe(200);
    expect(await direct.json()).toMatchObject({ boardOperationId: exactOperationId, action: 'direct', state: 'accepted' });
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]).toMatchObject({
      operationId: exactOperationId, phase: 'waiting', sessionControls: { direct: [{ phase: 'accepted', nativeInputMessageId: opencodeInputMessageId(createHash('sha256').update(JSON.stringify({
        cardId: controlCardId, operationId: exactOperationId, action: 'direct', message: directText,
      })).digest('hex')) }] },
    });
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([name]) => name === 'send_message')).toHaveLength(1);
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([name]) => name === 'fleet_create_session')).toHaveLength(0);
  });

  it('accepts a visible exact direct result without native parent and rejects hidden, later-user and wrong-parent cases', async () => {
    const card = controllableOpenCodeCard();
    const receipt = card.taskExecutionHistory![0]!;
    const directText = 'Продолжи текущую задачу';
    const directInputId = createHash('sha256').update(JSON.stringify({
      cardId: controlCardId, operationId: controlOperationId, action: 'direct', message: directText,
    })).digest('hex');
    const directNativeInputMessageId = 'msg_direct_input_123456';
    const directControl = { requestHash: directInputId, phase: 'accepted' as const,
      nativeDispatchJobId: userMessageJobId(controlSessionId, directInputId),
      nativeInputMessageId: directNativeInputMessageId, updatedAt: baseCard.updated };
    mocks.currentCard.value = { ...card, taskExecutionHistory: [{ ...receipt, phase: 'running', nativeTurnId: 'main-turn-t1',
      sessionControls: { direct: [directControl] } }] };
    mocks.sessionInfo.value = { id: controlSessionId, harness: 'opencode', hostId: 'roomhacker-server-100',
      cwd: receipt.projectBinding!.cwd, model: receipt.projectBinding!.model, status: 'idle', needsPermission: false,
      meta: { nativeLastTurn: { turnId: 'direct-turn-t2', status: 'completed' } } };
    let nativeMessages: Array<Record<string, unknown>> = [
      { id: directNativeInputMessageId, role: 'user', inputId: directInputId, parts: [{ type: 'text', text: directText }] },
      { id: 'msg_direct_answer_123456', role: 'assistant', turnId: 'direct-turn-t2', phase: 'completed',
        parts: [{ type: 'text', text: 'Same-card continuation result for direct T2.' }] },
      { id: 'msg_later_user_123456', role: 'user', parts: [{ type: 'text', text: 'Unrelated later manual input U3.' }] },
    ];
    const messagesUri = `herder://sessions/opencode/${controlSessionId}/messages`;
    mocks.readOwnerHerderResource.mockImplementation(async (uri: string) => ({ contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(nativeMessages) }] }));
    mocks.validateTransition.mockImplementation((_card: KanbanCard, updates: { executorResult?: { summary?: string } }) => ({
      kind: 'redirected', patch: { column: 'review', needsReview: true, resultHistory: [{
        summary: updates.executorResult?.summary ?? '', evidenceRefs: [], submittedBy: 'nikita', submittedAt: '2026-10-28T00:00:00.000Z',
      }] },
    }));
    const request = () => PATCH(new NextRequest('https://todo.example.test/api/kanban/cards/task-1/execution', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        action: 'sync-result', operationId: controlOperationId, expectedVersion: mocks.currentCard.value!.version,
      }),
    }), { params: Promise.resolve({ id: controlCardId }) });

    const completeDirectTail = nativeMessages;
    nativeMessages = [completeDirectTail[1]!];
    const hiddenDirectInput = await request();
    if (!hiddenDirectInput) throw new Error('hidden direct input response missing');
    expect(hiddenDirectInput.status).toBe(202);
    expect(mocks.currentCard.value?.resultHistory).toBeUndefined();

    nativeMessages = completeDirectTail;
    const withLaterUser = await request();
    if (!withLaterUser) throw new Error('direct result with newer user response missing');
    expect(withLaterUser.status).toBe(202);
    expect(mocks.readOwnerHerderResource).toHaveBeenCalledWith(messagesUri);
    expect(mocks.currentCard.value?.resultHistory).toBeUndefined();

    nativeMessages = nativeMessages.slice(0, 2);
    nativeMessages[1] = { ...nativeMessages[1]!, nativeParentMessageId: 'msg_wrong_parent_123456' };
    const wrongParent = await request();
    if (!wrongParent) throw new Error('direct result with wrong parent response missing');
    expect(wrongParent.status).toBe(202);
    expect(mocks.currentCard.value?.resultHistory).toBeUndefined();

    nativeMessages[1] = { ...nativeMessages[1]!, nativeParentMessageId: undefined };
    const exactDirectResult = await request();
    if (!exactDirectResult) throw new Error('exact direct T2 result response missing');
    expect(exactDirectResult.status, JSON.stringify(await exactDirectResult.clone().json())).toBe(200);
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]).toMatchObject({ phase: 'result', nativeTurnId: 'direct-turn-t2' });
    expect(mocks.currentCard.value?.resultHistory?.at(-1)?.summary).toBe('Same-card continuation result for direct T2.');
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([name]) => name === 'send_message' || name === 'fleet_create_session')).toHaveLength(0);
  });

  it('allows distinct direct messages once, stops the exact receipt, and never replays either action', async () => {
    mocks.currentCard.value = controllableOpenCodeCard();
    const opencodeMessages: Array<Record<string, unknown>> = [];
    mocks.readOwnerHerderResource.mockImplementation(async (uri: string) => ({
      contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(opencodeMessages) }],
    }));
    mocks.callOwnerHerderTool.mockImplementation(async (tool: string, args: Record<string, unknown>) => {
      if (tool === 'job_get' || tool === 'fleet_node_info' || tool === 'agent_info') return toolResult(tool, args);
      if (tool === 'send_message') {
        opencodeMessages.push({ id: opencodeInputMessageId(String(args.inputId)), role: 'user', inputId: args.inputId, text: args.message });
        opencodeMessages.at(-1)!.parts = [{ type: 'text', text: args.message }];
        return { content: [{ type: 'text', text:
          `Message sent to [${String(args.harness)}] ${String(args.sessionId)} (queue).\nNative admission receipt: ${JSON.stringify({ admitted: true, inputId: args.inputId })}` }] };
      }
      if (tool === 'stop_agent') {
        mocks.sessionInfo.value = { ...mocks.sessionInfo.value, status: 'stopped' };
        return { content: [{ type: 'text', text:
          `Stopped agent [${String(args.harness)}] ${String(args.sessionId)} on host '${String(args.hostId)}'.` }] };
      }
      throw new Error(`unexpected tool ${tool}`);
    });

    const direct = await PATCH(sessionControlRequest({ action: 'session-direct', expectedVersion: 4, message: 'Проверь текущий шаг' }), {
      params: Promise.resolve({ id: controlCardId }),
    });
    if (!direct) throw new Error('direct response missing');
    expect(direct.status).toBe(200);
    expect(await direct.json()).toMatchObject({ boardOperationId: controlOperationId, action: 'direct', state: 'accepted' });
    expect(mocks.callOwnerHerderTool).toHaveBeenCalledWith('send_message', {
      sessionId: 'opencode-session-1', harness: 'opencode', hostId: 'roomhacker-server-100',
      inputId: createHash('sha256').update(JSON.stringify({
        cardId: controlCardId, operationId: controlOperationId, action: 'direct', message: 'Проверь текущий шаг',
      })).digest('hex'),
      message: 'Проверь текущий шаг', mode: 'queue', humanRequested: true,
    });

    const secondDirect = await PATCH(sessionControlRequest({ action: 'session-direct', expectedVersion: mocks.currentCard.value!.version, message: 'Сделай следующий шаг' }), {
      params: Promise.resolve({ id: controlCardId }),
    });
    if (!secondDirect) throw new Error('second direct response missing');
    expect(secondDirect.status).toBe(200);
    expect(mocks.callOwnerHerderTool).toHaveBeenCalledWith('send_message', {
      sessionId: 'opencode-session-1', harness: 'opencode', hostId: 'roomhacker-server-100',
      inputId: createHash('sha256').update(JSON.stringify({
        cardId: controlCardId, operationId: controlOperationId, action: 'direct', message: 'Сделай следующий шаг',
      })).digest('hex'),
      message: 'Сделай следующий шаг', mode: 'queue', humanRequested: true,
    });
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.sessionControls?.direct).toHaveLength(2);
    const sideEffectsAfterTwoMessages = mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'send_message' || tool === 'stop_agent').length;
    const replayFirstMessage = await PATCH(sessionControlRequest({ action: 'session-direct', expectedVersion: mocks.currentCard.value!.version, message: 'Проверь текущий шаг' }), {
      params: Promise.resolve({ id: controlCardId }),
    });
    if (!replayFirstMessage) throw new Error('direct replay response missing');
    expect(replayFirstMessage.status).toBe(200);
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'send_message' || tool === 'stop_agent')).toHaveLength(sideEffectsAfterTwoMessages);
    const replaySecondMessage = await PATCH(sessionControlRequest({ action: 'session-direct', expectedVersion: mocks.currentCard.value!.version, message: 'Сделай следующий шаг' }), {
      params: Promise.resolve({ id: controlCardId }),
    });
    if (!replaySecondMessage) throw new Error('second direct replay response missing');
    expect(replaySecondMessage.status).toBe(200);
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'send_message' || tool === 'stop_agent')).toHaveLength(sideEffectsAfterTwoMessages);

    const versionAfterDirect = mocks.currentCard.value!.version;
    const stop = await PATCH(sessionControlRequest({ action: 'session-stop', expectedVersion: versionAfterDirect }), {
      params: Promise.resolve({ id: controlCardId }),
    });
    if (!stop) throw new Error('stop response missing');
    expect(stop.status).toBe(200);
    expect(await stop.json()).toMatchObject({ boardOperationId: controlOperationId, action: 'stop', state: 'accepted' });
    expect(mocks.callOwnerHerderTool).toHaveBeenCalledWith('stop_agent', {
      sessionId: 'opencode-session-1', harness: 'opencode', hostId: 'roomhacker-server-100',
    });

    const beforeDuplicate = mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'send_message' || tool === 'stop_agent').length;
    const duplicate = await PATCH(sessionControlRequest({ action: 'session-stop', expectedVersion: mocks.currentCard.value!.version }), {
      params: Promise.resolve({ id: controlCardId }),
    });
    if (!duplicate) throw new Error('duplicate stop response missing');
    expect(duplicate.status).toBe(200);
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'send_message' || tool === 'stop_agent')).toHaveLength(beforeDuplicate);
  });

  it('persists UNKNOWN before returning and refuses to repeat the same direct action', async () => {
    mocks.currentCard.value = controllableOpenCodeCard();
    mocks.callOwnerHerderTool.mockImplementation(async (tool: string, args: Record<string, unknown>) => {
      if (tool === 'send_message') throw new Error('synthetic transport ambiguity');
      return toolResult(tool, args);
    });
    const first = await PATCH(sessionControlRequest({ action: 'session-direct', expectedVersion: 4, message: 'Продолжай текущий шаг' }), {
      params: Promise.resolve({ id: controlCardId }),
    });
    if (!first) throw new Error('unknown direct response missing');
    expect(first.status).toBe(202);
    expect(await first.json()).toMatchObject({ action: 'direct', state: 'unknown' });
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.sessionControls?.direct?.[0]?.phase).toBe('unknown');

    const retry = await PATCH(sessionControlRequest({ action: 'session-direct', expectedVersion: mocks.currentCard.value!.version, message: 'Продолжай текущий шаг' }), {
      params: Promise.resolve({ id: controlCardId }),
    });
    if (!retry) throw new Error('unknown direct retry response missing');
    expect(retry.status).toBe(202);
    expect(mocks.callOwnerHerderTool.mock.calls.filter(([tool]) => tool === 'send_message')).toHaveLength(1);
  });

  it('accepts the native current-turn reservation only with its exact stable input receipt', async () => {
    mocks.currentCard.value = controllableOpenCodeCard();
    const opencodeMessages: Array<Record<string, unknown>> = [];
    mocks.readOwnerHerderResource.mockImplementation(async (uri: string) => ({
      contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(opencodeMessages) }],
    }));
    const message = 'Зарезервируй текущий шаг';
    const inputId = createHash('sha256').update(JSON.stringify({
      cardId: controlCardId, operationId: controlOperationId, action: 'direct', message,
    })).digest('hex');
    mocks.callOwnerHerderTool.mockImplementation(async (tool: string, args: Record<string, unknown>) => {
      if (tool === 'job_get' || tool === 'fleet_node_info' || tool === 'agent_info') return toolResult(tool, args);
      opencodeMessages.push({ id: opencodeInputMessageId(String(args.inputId)), role: 'user', inputId: args.inputId,
        text: args.message, parts: [{ type: 'text', text: args.message }] });
      return observedHerderDelivery(
        `Message reserved for the current turn of [${String(args.harness)}] ${String(args.sessionId)}; model observation is not yet confirmed.\nCurrent-turn context reservation receipt: ${JSON.stringify({ admitted: true, inputId })}`,
        inputId, { hostId: String(args.hostId), harness: String(args.harness), sessionId: String(args.sessionId) },
      );
    });

    const response = await PATCH(sessionControlRequest({ action: 'session-direct', expectedVersion: 4, message }), {
      params: Promise.resolve({ id: controlCardId }),
    });
    if (!response) throw new Error('current-turn reservation response missing');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ boardOperationId: controlOperationId, action: 'direct', state: 'accepted' });
    expect(mocks.currentCard.value?.taskExecutionHistory?.[0]?.sessionControls?.direct?.[0]?.phase).toBe('accepted');
  });

  it('does not accept a browser-supplied board operation id or an ambiguous active receipt set', async () => {
    mocks.currentCard.value = controllableOpenCodeCard();
    const forged = await PATCH(sessionControlRequest({ action: 'session-stop', expectedVersion: 4, board_operation_id: 'f'.repeat(64) }), {
      params: Promise.resolve({ id: controlCardId }),
    });
    if (!forged) throw new Error('forged request response missing');
    expect(forged.status).toBe(400);
    expect(mocks.callOwnerHerderTool).not.toHaveBeenCalled();

    const card = mocks.currentCard.value!;
    mocks.currentCard.value = { ...card, taskExecutionHistory: [
      ...card.taskExecutionHistory!,
      { ...card.taskExecutionHistory![0]!, operationId: 'd'.repeat(64) },
    ] };
    const ambiguous = await PATCH(sessionControlRequest({ action: 'session-stop', expectedVersion: 4 }), {
      params: Promise.resolve({ id: controlCardId }),
    });
    if (!ambiguous) throw new Error('ambiguous request response missing');
    expect(ambiguous.status).toBe(409);
    expect(mocks.callOwnerHerderTool).not.toHaveBeenCalled();
  });
});
