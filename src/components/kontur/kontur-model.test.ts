import { describe, expect, it } from 'vitest';
import type { KanbanCard, TaskExecutionContinuation, TaskExecutionReceipt, TaskResult } from '../../lib/kanban/types';
import {
  UNKNOWN, filterCards, getActivity, getDecisions, getFilterOptions, getReleases, getSessions,
  safeExternalUrl, taskFacts, cardProvenanceLinks,
} from './kontur-model';

const FIRST = '2026-01-10T09:00:00Z';
const LATER = '2026-01-10T10:00:00Z';
const LAST = '2026-01-10T11:00:00Z';

function card(overrides: Partial<KanbanCard> = {}): KanbanCard {
  return {
    id: 'fixture-card', title: 'Проверить доставку', description: 'Синтетическое задание',
    column: 'todo', priority: 'medium', project: 'Тестовый проект',
    tags: [], order: 0, created: FIRST, updated: FIRST, fileName: 'fixture-card.md', version: 7,
    assignees: [], ...overrides,
  };
}

function receipt(overrides: Partial<TaskExecutionReceipt> = {}): TaskExecutionReceipt {
  return {
    operationId: 'a'.repeat(64), requestHash: 'b'.repeat(64), lastBoardVersion: 7,
    createInputId: 'c'.repeat(64), messageInputId: 'd'.repeat(64),
    phase: 'running', hostId: 'roomhacker-server-100', harness: 'opencode',
    nativeSessionId: 'fixture-session', startedBy: 'fixture-actor', createdAt: FIRST, updatedAt: LATER,
    ...overrides,
  };
}

function result(overrides: Partial<TaskResult> = {}): TaskResult {
  return {
    summary: 'Сохранён результат проверки', evidenceRefs: ['fixture:result:1'],
    submittedBy: 'fixture-executor', submittedAt: LATER, ...overrides,
  };
}

function continuation(overrides: Partial<TaskExecutionContinuation> = {}): TaskExecutionContinuation {
  return {
    id: 'e'.repeat(64), kind: 'task-follow-up-v1', instruction: 'Уточнить результат',
    inputId: 'f'.repeat(64), requestHash: '1'.repeat(64), phase: 'running', createdAt: LATER, updatedAt: LAST,
    ...overrides,
  };
}

describe('Kontur task facts', () => {
  it('preserves native identity and leaves absent facts unknown without borrowing from description', () => {
    const value = card({
      project: 'Airlock \u2014 платформа', assignees: ['fixture-assignee'],
      description: 'Всё сделано. PR https://github.com/example/project/pull/42 принят. Сервер 44.',
    });
    expect(taskFacts(value)).toEqual({
      id: value.id, version: 7, title: value.title, project: value.project, status: 'todo', priority: 'medium',
      done: UNKNOWN, remaining: UNKNOWN, nextStep: UNKNOWN, evidence: [], blocker: UNKNOWN,
      command: UNKNOWN, sourceMessageUrl: UNKNOWN, sourceSessionUrl: UNKNOWN, sessionUrl: UNKNOWN, owner: UNKNOWN, machine: UNKNOWN,
    });
    expect(getReleases([value])).toEqual([]);
    expect(getSessions([value])).toEqual([]);
  });

  it('shows a submitted result without promoting review into done or claiming accepted evidence', () => {
    const value = card({ column: 'review', needsReview: true, resultHistory: [result({
      summary: 'Исполнитель сообщил о готовности', evidenceRefs: ['fixture:result:1', 'fixture:result:1'],
      nextAction: 'Проверить сохранённый результат',
    })] });
    expect(taskFacts(value)).toMatchObject({
      status: 'review', done: 'Исполнитель сообщил о готовности', evidence: ['fixture:result:1'],
      nextStep: 'Проверить сохранённый результат', remaining: 'Проверить сохранённый результат',
    });
    expect(getDecisions([value])).toEqual([]);
  });

  it('honors an explicit cleared nextAction instead of reviving old result or executor instructions', () => {
    const value = card({
      column: 'done', nextAction: null,
      resultHistory: [result({ nextAction: 'Старая инструкция' })],
      taskExecutionHistory: [receipt({ nextAction: 'Ещё более старая инструкция' })],
      reviewHistory: [{ decision: 'rework', note: 'Историческая доработка', actor: 'fixture-reviewer', decidedAt: LAST }],
    });
    expect(taskFacts(value)).toMatchObject({ nextStep: UNKNOWN, remaining: UNKNOWN });
  });

  it('keeps current rework requirements but does not revive them after a new submitted result', () => {
    const review = { decision: 'rework' as const, note: 'Исправить проверенный дефект', actor: 'fixture-reviewer', decidedAt: LATER };
    expect(taskFacts(card({ column: 'in-progress', reviewHistory: [review] })).remaining).toBe(review.note);
    expect(taskFacts(card({ column: 'review', reviewHistory: [review], resultHistory: [result({ submittedAt: LAST })] })).remaining).toBe(UNKNOWN);
  });

  it('uses only stored owner and current attempt host, never assignment or an earlier machine', () => {
    const value = card({ owner: 'fixture-owner', assignees: ['fixture-worker'], taskExecutionHistory: [
      receipt(), receipt({ operationId: '2'.repeat(64), phase: 'intent', nativeSessionId: undefined, hostId: '' }),
    ] });
    expect(taskFacts(value)).toMatchObject({ owner: 'fixture-owner', machine: UNKNOWN });
    expect(taskFacts(card({ taskExecutionHistory: [receipt()] })).machine).toBe('roomhacker-server-100');
  });

  it('uses explicit blocker fields and unanswered questions without scanning error words from prose', () => {
    expect(taskFacts(card({ description: 'История ошибок ACL 429 ENAMETOOLONG' })).blocker).toBe(UNKNOWN);
    expect(taskFacts(card({ blockerReason: 'ACL: нет доступа к проекту' })).blocker).toBe('ACL: нет доступа к проекту');
    expect(taskFacts(card({ pendingQuestion: {
      id: 'fixture-question', text: 'Какой результат принять?', choices: [], askedAt: FIRST, attemptOperationId: 'a'.repeat(64),
    } })).blocker).toBe('Ожидается ответ: Какой результат принять?');
  });

  it('does not use source-admission refs as proof of completed work', () => {
    const value = card({ sourceAdmission: {
      operationKey: 'fixture-source', requestHash: 'a'.repeat(64), provenanceHash: 'b'.repeat(64),
      tenantId: 'fixture-tenant', sourceOwnerId: 'fixture-owner', sourceEventId: 'fixture-event',
      primaryItem: 'primary', sourceRevision: 'fixture-revision', requestedProject: 'Тестовый проект',
      classification: 'explicit-task', evidenceRefs: ['https://example.test/original-request'],
    } });
    expect(taskFacts(value).evidence).toEqual([]);
  });

  it('shows a server-recorded manual result and its exact evidence with the matching human review', () => {
    const evidence = 'https://example.test/manual-proof';
    const value = card({ column: 'done', nextAction: null, completionEvidence: [{
      type: 'manual_result_verification', origin: 'human-ui', actor: 'fixture-human', checkedAt: LAST,
      result: 'Вручную проверено сохранение', evidence,
    }], reviewHistory: [{ decision: 'accepted', actor: 'fixture-human', decidedAt: LAST, note: 'Проверены результат и доказательство' }] });
    expect(taskFacts(value)).toMatchObject({ done: 'Вручную проверено сохранение', evidence: [evidence], nextStep: UNKNOWN });
    expect(getDecisions([value])[0].note).toBe('Проверены результат и доказательство');
    expect(getReleases([value])[0]).toMatchObject({ reference: evidence, state: UNKNOWN, source: 'completionEvidence.manual_result_verification.evidence' });
  });

  it('does not promote an unmatched completion object or overwrite a newer executor result', () => {
    const value = card({ completionEvidence: [{
      type: 'manual_result_verification', origin: 'human-ui', actor: 'fixture-human', checkedAt: FIRST,
      result: 'Историческая ручная проверка', evidence: 'https://example.test/old-proof',
    }] });
    expect(taskFacts(value).done).toBe(UNKNOWN);
    expect(getReleases([value])).toEqual([]);
    const reviewed = { ...value, reviewHistory: [{ decision: 'accepted' as const, actor: 'fixture-human', decidedAt: FIRST }],
      resultHistory: [result({ summary: 'Новый результат на проверку' })] };
    expect(taskFacts(reviewed).done).toBe('Новый результат на проверку');
    expect(taskFacts(reviewed).evidence).toEqual(['fixture:result:1']);
  });
});

describe('Kontur session projections', () => {
  it('never fabricates an active session from an in-progress card', () => {
    expect(getSessions([card({ column: 'in-progress' })])).toEqual([]);
    expect(getSessions([card({ column: 'in-progress', taskExecutionHistory: [] })])).toEqual([]);
  });

  it('keeps old saved state and observation time distinct from live state and card completion', () => {
    const oldTime = '2020-01-01T00:00:00Z';
    const [session] = getSessions([card({ column: 'done', taskExecutionHistory: [receipt({ updatedAt: oldTime })] })]);
    expect(session).toMatchObject({
      cardId: 'fixture-card', cardVersion: 7, sourceVersion: 7,
      phase: 'running', state: 'running', updatedAt: oldTime, liveState: UNKNOWN,
      source: 'taskExecutionHistory', stateLabel: 'Сохранено: в работе',
    });
    expect(session.href).toBe('https://agent.bezrabotnyi.com/#/session/opencode%3Afixture-session');
  });

  it.each(['intent', 'create-unknown', 'dispatch-unknown'] as const)('does not turn %s into a confirmed running state', phase => {
    const [session] = getSessions([card({ taskExecutionHistory: [receipt({ phase, nativeSessionId: undefined })] })]);
    expect(session).toMatchObject({ phase, state: 'unknown', sessionId: UNKNOWN, href: null, liveState: UNKNOWN });
  });

  it('uses a follow-up receipt while preserving an explicit later stop', () => {
    const child = continuation();
    expect(getSessions([card({ taskExecutionHistory: [receipt({ phase: 'result', continuations: [child] })] })])[0])
      .toMatchObject({ state: 'running', phase: 'running', updatedAt: LAST, continuationId: child.id, liveState: UNKNOWN });
    expect(getSessions([card({ taskExecutionHistory: [receipt({ phase: 'stopped', continuations: [child], updatedAt: LAST })] })])[0])
      .toMatchObject({ state: 'stopped', phase: 'stopped', updatedAt: LAST });
  });

  it('keeps only the last stored attempt for the same native session on the same task', () => {
    const latest = receipt({ operationId: '2'.repeat(64), phase: 'waiting', updatedAt: LAST });
    const sessions = getSessions([card({ taskExecutionHistory: [receipt(), latest] })]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ operationId: latest.operationId, state: 'waiting', updatedAt: LAST });
  });

  it('does not invent a link for an unknown host or promote a malformed timestamp', () => {
    const [session] = getSessions([card({ taskExecutionHistory: [receipt({
      hostId: 'fixture-unknown-host', sessionUrl: 'https://example.test/pretend-session', updatedAt: 'yesterday',
    })] })]);
    expect(session).toMatchObject({ href: null, machine: 'fixture-unknown-host', updatedAt: UNKNOWN });
  });
});

describe('Kontur evidence links and release references', () => {
  it.each([
    'javascript:alert(1)', 'data:text/html,test', '//example.test/path', '/relative',
    'https://user:password@example.test/path', 'https://example.test/has space',
    'https://example.test/\npath', 'https:\\example.test/path', '', undefined,
  ])('does not make an unsafe or non-absolute reference clickable: %s', value => {
    expect(safeExternalUrl(value)).toBeNull();
  });

  it('preserves safe explicit HTTP links and normalizes them without guessing a destination', () => {
    expect(safeExternalUrl(' https://example.test/proof?a=1#part ')).toBe('https://example.test/proof?a=1#part');
    expect(safeExternalUrl('http://example.test/proof')).toBe('http://example.test/proof');
  });

  it('lists only explicit result refs and never infers merged or deployed from task state or prose', () => {
    const pull = 'https://github.com/example/project/pull/42';
    const release = 'https://github.com/example/project/releases/tag/v1';
    const value = card({ column: 'done', description: 'Выкладка завершена https://example.test/imagined', resultHistory: [result({
      summary: 'PR https://github.com/example/project/pull/999 якобы принят',
      evidenceRefs: [pull, release, 'source:event:1', 'javascript:alert(1)'],
    })] });
    expect(getReleases([value])).toHaveLength(2);
    expect(getReleases([value]).find(item => item.reference === pull)).toMatchObject({ kind: 'pr', state: UNKNOWN, href: pull });
    expect(getReleases([value]).find(item => item.reference === release)).toMatchObject({ kind: 'release', state: UNKNOWN });
    expect(getReleases([value]).every(item => item.reference !== 'https://github.com/example/project/pull/999')).toBe(true);
  });

  it('does not call an arbitrary site with a pull-like path a PR and keeps its provenance', () => {
    const ref = 'https://github.com.example.test/example/project/pull/42';
    expect(getReleases([card({ resultHistory: [result({ evidenceRefs: [ref] })] })])[0]).toMatchObject({
      kind: 'reference', reference: ref, source: 'resultHistory.evidenceRefs', at: LATER, state: UNKNOWN,
    });
  });

  it('deduplicates explicit artifact refs on a card using the latest stored observation', () => {
    const ref = 'https://github.com/example/project/commit/abcdef0123456789';
    const value = card({ resultHistory: [result({ evidenceRefs: [ref] }), result({ evidenceRefs: [ref], submittedAt: LAST })] });
    expect(getReleases([value])).toHaveLength(1);
    expect(getReleases([value])[0]).toMatchObject({ kind: 'commit', at: LAST, state: UNKNOWN });
  });
});

describe('Kontur decisions and activity', () => {
  it('records real human decisions separately from submission and never attributes generic writes to the owner', () => {
    const value = card({
      owner: 'fixture-owner', updated: LAST, resultHistory: [result()],
      reviewHistory: [{ decision: 'rework', actor: 'fixture-reviewer', decidedAt: LAST, note: 'Исправить подтверждённую ошибку' }],
    });
    expect(getDecisions([value])).toMatchObject([{
      cardId: value.id, decision: 'rework', actor: 'fixture-reviewer', at: LAST, note: 'Исправить подтверждённую ошибку',
    }]);
    const activity = getActivity([value]);
    expect(activity.find(item => item.kind === 'created')?.actor).toBe(UNKNOWN);
    expect(activity.find(item => item.kind === 'updated')?.actor).toBe(UNKNOWN);
    expect(activity.find(item => item.kind === 'result')).toMatchObject({ actor: 'fixture-executor', title: 'Результат сохранён' });
    expect(activity.find(item => item.kind === 'review')).toMatchObject({ actor: 'fixture-reviewer', title: 'Возвращено на доработку' });
  });

  it('shows a saved answer without claiming it was delivered to the agent', () => {
    const value = card({ pendingQuestion: {
      id: 'fixture-question', text: 'Продолжить?', choices: [], askedAt: FIRST, attemptOperationId: 'a'.repeat(64),
      answer: { value: 'continue', label: 'Продолжить', by: 'fixture-human', answeredAt: LATER },
      deliveryError: 'Доставка ещё не подтверждена',
    } });
    expect(getDecisions([value])[0]).toMatchObject({ decision: 'answer', title: 'Ответ сохранён', at: LATER, actor: 'fixture-human' });
    expect(taskFacts(value).blocker).toBe('Доставка ещё не подтверждена');
  });

  it('keeps an unconfirmed decision proposal separate from a verified same-request continuation', () => {
    const proposal = {
      proposalRef: 'fixture-proposal', requestId: 'fixture-request', humanRequestId: 'fixture-human-request',
      requestHash: 'e'.repeat(64), purpose: 'task-decision', version: 1, value: 'continue',
      authenticatedActor: 'fixture-human', cardVersion: 7, stopEpoch: 'f'.repeat(64),
      sourceMessageId: 'fixture-message', sourceJobId: 'fixture-job',
    };
    const execution = receipt({ taskDecisionProposal: proposal });
    expect(getDecisions([card({ taskExecutionHistory: [execution] })])[0])
      .toMatchObject({ decision: 'answer-pending', at: UNKNOWN, refs: ['fixture-proposal'] });
    const applied = { ...execution, taskDecisionContinuation: {
      requestId: 'fixture-request', resultRef: 'fixture-result', idempotencyKey: 'fixture-key', receipt: 'fixture-receipt',
      inputId: 'fixture-input', nativeInputMessageId: 'fixture-native-input', nativeTurnId: 'fixture-turn',
      assistantMessageId: 'fixture-assistant-message', updatedAt: LAST,
    } };
    expect(getDecisions([card({ taskExecutionHistory: [applied] })])[0])
      .toMatchObject({ decision: 'answer', at: LAST, refs: ['fixture-proposal', 'fixture-result'] });
    expect(getDecisions([card({ taskExecutionHistory: [{ ...applied,
      taskDecisionContinuation: { ...applied.taskDecisionContinuation, requestId: 'unrelated-request' },
    }] })])[0].decision).toBe('answer-pending');
  });

  it('does not describe an accepted stop request as confirmed session termination', () => {
    const value = card({ taskExecutionHistory: [receipt({ sessionControls: { stop: {
      requestHash: 'e'.repeat(64), phase: 'accepted', updatedAt: LAST,
    } } })] });
    const event = getActivity([value]).find(item => item.kind === 'control');
    expect(event).toMatchObject({ title: 'Сохранён запрос остановки', detail: 'Приём запроса подтверждён', actor: UNKNOWN });
    expect(getSessions([value])[0].state).toBe('running');
  });
});

describe('Kontur native filters', () => {
  const values = [
    card({ id: 'one', project: 'Airlock \u2014 платформа', title: 'Проверка приёма сессии', column: 'review', priority: 'high',
      taskExecutionHistory: [receipt()], blockerReason: 'ACL доступа', tags: ['агент'] }),
    card({ id: 'two', project: 'Свободное имя проекта', column: 'done', priority: 'critical', taskExecutionHistory: [receipt({ hostId: 'server-44' })] }),
    card({ id: 'three', column: 'in-progress' }),
  ];

  it('uses exact native project/server/status/priority values without mapping projects to fixed IDs', () => {
    expect(filterCards(values, { project: 'Airlock \u2014 платформа', server: 'roomhacker-server-100', status: 'review', priority: 'high' }).map(item => item.id)).toEqual(['one']);
    expect(filterCards(values, { status: 'done' }).map(item => item.id)).toEqual(['two']);
    expect(filterCards(values, { server: UNKNOWN }).map(item => item.id)).toEqual(['three']);
    expect(filterCards(values, { project: 'airlock' })).toEqual([]);
  });

  it('supports Russian case-insensitive search, е/ё and combined words in native labels', () => {
    expect(filterCards(values, { search: 'ПРИЕМА СЕССИИ ACL' }).map(item => item.id)).toEqual(['one']);
    expect(filterCards(values, { search: 'НА ПРОВЕРКЕ ВЫСОКИЙ' }).map(item => item.id)).toEqual(['one']);
    expect(filterCards(values, { search: '  ', project: 'all', server: '', status: 'all' })).toHaveLength(3);
  });

  it('includes unknown machines and preserves source objects, versions and histories', () => {
    const before = structuredClone(values);
    const options = getFilterOptions(values);
    expect(options.projects).toContain('Свободное имя проекта');
    expect(options.servers).toEqual(['roomhacker-server-100', 'server-44', UNKNOWN]);
    filterCards(values, { search: 'проверка' });
    getSessions(values); getActivity(values); getDecisions(values); getReleases(values);
    expect(values).toEqual(before);
    expect(filterCards(values)[0]).toBe(values[0]);
  });
});


describe('explicit card provenance links', () => {
  it('keeps missing message and session references unknown', () => {
    expect(cardProvenanceLinks(card())).toEqual({ sourceMessageUrl: null, sourceSessionUrl: null, sessionUrl: null });
  });

  it('preserves explicit message and source session links without inventing a run', () => {
    const value = card({ sourceMessageUrl: 'https://messages.example.test/message/42',
      sourceSessionUrl: 'https://agent.example.test/session/fixture' });
    expect(taskFacts(value)).toMatchObject({
      sourceMessageUrl: value.sourceMessageUrl, sourceSessionUrl: value.sourceSessionUrl, sessionUrl: value.sourceSessionUrl,
    });
    expect(getSessions([value])).toEqual([]);
    expect(getReleases([value])).toEqual([]);
  });

  it('keeps the last known managed session when the newest launch has no session', () => {
    const known = receipt();
    const pending = receipt({ operationId: '2'.repeat(64), nativeSessionId: undefined, phase: 'intent' });
    const expected = getSessions([card({ taskExecutionHistory: [known] })])[0].href;
    const value = card({ sourceSessionUrl: 'https://agent.example.test/source',
      taskExecutionHistory: [known, pending] });
    expect(cardProvenanceLinks(value)).toMatchObject({ sessionUrl: expected,
      sourceSessionUrl: 'https://agent.example.test/source' });
    expect(taskFacts(value).command).toBe(expected);
  });

  it('uses the latest valid dot session without losing the source session', () => {
    const value = card({ sourceSessionUrl: 'https://agent.example.test/source', taskExecutionHistory: [
      receipt(), receipt({ operationId: '3'.repeat(64), provider: 'dot',
        sessionUrl: 'https://chat.example.test/session/fixture', nativeSessionId: undefined }),
    ] });
    expect(cardProvenanceLinks(value).sessionUrl).toBe('https://chat.example.test/session/fixture');
  });

  it('does not turn opaque message IDs or arbitrary source URLs into message permalinks', () => {
    const value = card({ source: 'https://example.test/context',
      sourceMessageUrl: 'telegram:123|456:789' });
    expect(cardProvenanceLinks(value).sourceMessageUrl).toBeNull();
    expect(taskFacts(value).command).toBe(value.source);
  });

  it.each(['javascript:alert(1)', 'https://user:secret@example.test/', 'https://example.test/\nnext', '//example.test/x', 'https://example.test/%0a', 'https://example.test/' + 'x'.repeat(2048)])(
    'rejects an unsafe stored reference: %s', value => {
      expect(cardProvenanceLinks(card({ sourceMessageUrl: value, sourceSessionUrl: value }))).toEqual({
        sourceMessageUrl: null, sourceSessionUrl: null, sessionUrl: null,
      });
    },
  );
});
