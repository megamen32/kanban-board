import { describe, expect, it } from 'vitest';
import { canAnswerTaskQuestion, canCreateTaskQuestion, isTaskQuestionOwner, matchesTaskExecutionOperation, parseExecutorQuestionPayload, parseTaskQuestion, taskQuestionCreateRequest, taskQuestionStateLabel } from './notice-question-model';

const view = {
  requestId: 'opaque-should-not-render', purpose: 'clarification', version: 8, state: 'pending',
  question: { text: 'Which option should I use?', choices: [{ value: 'a', label: 'Option A' }, { value: 'b', label: 'Option B' }], expiresAt: null },
  notification: { attemptState: 'sent', delivered: true, deadlineAt: 1900 }, decision: null,
};

describe('Notice task-question UI model', () => {
  it('accepts only the executor question result bound to the preceding Herder metadata request', () => {
    const humanRequestId = '67ce04db-d775-4f81-a86d-31af4bbe1091';
    const payload = {
      kind: 'question', human_request_id: humanRequestId, question: 'Which summary format should I use?',
      choices: [{ value: 'brief', label: 'Short table' }, { value: 'total', label: 'Table with total row' }],
      timeoutValue: 'brief',
    };
    expect(parseExecutorQuestionPayload(payload, humanRequestId)).toEqual({
      humanRequestId, text: payload.question, choices: payload.choices, timeoutValue: payload.timeoutValue,
    });
    expect(parseExecutorQuestionPayload(payload, '00000000-0000-4000-8000-000000000000')).toBeUndefined();
    expect(parseExecutorQuestionPayload({ ...payload, message: 'operator supplied' }, humanRequestId)).toBeUndefined();
    expect(parseExecutorQuestionPayload({ ...payload, choices: [{ value: 'brief', label: 'Short table' }] }, humanRequestId)).toBeUndefined();
  });

  it('parses only the supported read projection and preserves delivery/deadline/decision facts', () => {
    expect(parseTaskQuestion(view)).toEqual({ kind: 'ready', view });
    expect(parseTaskQuestion({ state: 'unknown', requestId: 'opaque-id' })).toEqual({ kind: 'unknown', requestId: 'opaque-id' });
    expect(parseTaskQuestion({ state: 'not_found', requestId: 'opaque-id' })).toEqual({ kind: 'not-found' });
    expect(parseTaskQuestion(null)).toEqual({ kind: 'none' });
    expect(parseTaskQuestion({ ...view, notification: { ...view.notification, deadlineAt: 'soon' } })).toEqual({ kind: 'invalid' });
  });

  it('does not treat a notice answer as a control acknowledgement', () => {
    const withHumanDecision = parseTaskQuestion({ ...view, decision: { source: 'human', value: 'b', decidedAt: 1800 } });
    expect(withHumanDecision).toMatchObject({ kind: 'ready', view: { decision: { source: 'human', value: 'b', decidedAt: 1800 } } });
    expect(withHumanDecision.kind === 'ready' && 'control' in withHumanDecision.view).toBe(false);
  });

  it('labels the backend human-answer DTO state as a received answer', () => {
    const resolvedDto = { ...view, state: 'resolved', decision: { source: 'human', value: 'all', decidedAt: 789 } };
    const parsed = parseTaskQuestion(resolvedDto);
    expect(parsed).toMatchObject({ kind: 'ready', view: { state: 'resolved', decision: { source: 'human', value: 'all', decidedAt: 789 } } });
    expect(taskQuestionStateLabel(parsed.kind === 'ready' ? parsed.view.state : '')).toBe('Ответ получен');
  });

  it('matches the server owner/assignee rule and constructs only the accepted explicit PATCH body', () => {
    const card = { owner: 'lead', assignee: 'worker', assignees: ['backup'] };
    expect(isTaskQuestionOwner(card, 'lead')).toBe(true);
    expect(isTaskQuestionOwner(card, 'worker')).toBe(true);
    expect(isTaskQuestionOwner(card, 'backup')).toBe(true);
    expect(isTaskQuestionOwner(card, 'viewer')).toBe(false);
    expect(isTaskQuestionOwner({ ...card, owner: undefined }, 'nikita')).toBe(true);
    expect(isTaskQuestionOwner(card, null)).toBe(false);
    expect(taskQuestionCreateRequest({
      expectedVersion: 7, operationId: 'stored-execution-operation', purpose: ' clarify ', message: ' Which? ',
      choices: [{ value: 'a', label: ' A ' }, { value: 'b', label: ' B ' }], timeoutValue: 'b',
    })).toEqual({ action: 'create-question', expectedVersion: 7, operationId: 'stored-execution-operation', purpose: 'clarify',
      message: 'Which?', choices: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], timeoutValue: 'b' });
  });

  it('offers question creation only for the exact admitted current Codex execution', () => {
    const card = { owner: 'lead', assignees: [], version: 7, taskExecutionHistory: [{
      operationId: 'a'.repeat(64), lastBoardVersion: 7, phase: 'running', harness: 'codex', nativeTurnId: 'turn-1',
    }] };
    expect(canCreateTaskQuestion(card, 'lead', { operationId: 'client-key', status: 'admitted' }, true)).toBe(true);
    expect(canCreateTaskQuestion(card, 'lead', { operationId: 'client-key', status: 'pending' }, true)).toBe(false);
    expect(canCreateTaskQuestion(card, 'lead', { operationId: 'client-key', status: 'unknown' }, true)).toBe(false);
    expect(canCreateTaskQuestion(card, 'lead', { operationId: 'client-key', status: 'admitted' }, false)).toBe(false);
    expect(canCreateTaskQuestion({ ...card, version: 8 }, 'lead', { operationId: 'client-key', status: 'admitted' }, true)).toBe(false);
  });

  it('offers an answer only for the current authorized executor question and exact card version', () => {
    const card = { owner: 'qa-user', assignees: [], version: 9, taskExecutionHistory: [{
      operationId: 'a'.repeat(64), lastBoardVersion: 9, phase: 'waiting', harness: 'opencode',
      taskDecisionRequest: { requestId: 'td-' + 'b'.repeat(40) },
      executorQuestion: { humanRequestId: '67ce04db-d775-4f81-a86d-31af4bbe1091', questionHash: 'c'.repeat(64), choices: view.question.choices },
    }] };
    const ready = parseTaskQuestion({ ...view, requestId: 'td-' + 'b'.repeat(40) });
    expect(ready.kind).toBe('ready');
    const taskQuestion = ready.kind === 'ready' ? ready.view : null;
    expect(canAnswerTaskQuestion(card, 'qa-user', taskQuestion)).toBe(true);
    expect(canAnswerTaskQuestion(card, null, taskQuestion)).toBe(false);
    expect(canAnswerTaskQuestion({ ...card, version: 10 }, 'qa-user', taskQuestion)).toBe(false);
    expect(canAnswerTaskQuestion({ ...card, taskExecutionHistory: [{ ...card.taskExecutionHistory[0]!, taskDecisionProposal: {
      requestId: card.taskExecutionHistory[0]!.taskDecisionRequest.requestId, value: 'b', authenticatedActor: 'qa-user',
    } }] }, 'qa-user', taskQuestion)).toBe(false);
  });

  it('allows answering after a later accepted direct input advances the stop epoch only', () => {
    const receipt = {
      operationId: 'a'.repeat(64), lastBoardVersion: 9, phase: 'waiting', harness: 'opencode',
      taskDecisionRequest: { requestId: 'td-' + 'b'.repeat(40) },
      executorQuestion: { humanRequestId: '67ce04db-d775-4f81-a86d-31af4bbe1091', questionHash: 'c'.repeat(64), choices: view.question.choices },
      sessionControls: {
        stops: [{ requestHash: 'd'.repeat(64), phase: 'accepted', controlEpoch: 'e'.repeat(64) }],
        direct: [{ requestHash: 'f'.repeat(64), phase: 'accepted' }],
      },
    };
    const card = { owner: 'qa-user', assignees: [], version: 9, taskExecutionHistory: [receipt] };
    const ready = parseTaskQuestion({ ...view, requestId: receipt.taskDecisionRequest.requestId });
    const taskQuestion = ready.kind === 'ready' ? ready.view : null;
    expect(canAnswerTaskQuestion(card, 'qa-user', taskQuestion)).toBe(true);
    expect(canAnswerTaskQuestion({ ...card, taskExecutionHistory: [{ ...receipt, sessionControls: {
      ...receipt.sessionControls, stops: [{ ...receipt.sessionControls.stops[0]!, controlEpoch: 'f'.repeat(64) }],
    } }] }, 'qa-user', taskQuestion)).toBe(false);
    expect(canAnswerTaskQuestion({ ...card, taskExecutionHistory: [{ ...receipt, sessionControls: {
      ...receipt.sessionControls, direct: [{ ...receipt.sessionControls.direct[0]!, phase: 'unknown' }],
    } }] }, 'qa-user', taskQuestion)).toBe(false);
  });

  it('matches the browser-held launch key only to its current card execution receipt', async () => {
    const operationId = 'stored-client-operation';
    const bytes = new TextEncoder().encode(`card-a\0${operationId}`);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const receiptId = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
    await expect(matchesTaskExecutionOperation('card-a', receiptId, operationId)).resolves.toBe(true);
    await expect(matchesTaskExecutionOperation('card-b', receiptId, operationId)).resolves.toBe(false);
    await expect(matchesTaskExecutionOperation('card-a', receiptId, 'other-operation')).resolves.toBe(false);
  });
});
