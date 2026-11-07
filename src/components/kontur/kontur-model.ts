import type {
  KanbanCard, KanbanColumn, Priority, TaskExecutionContinuation, TaskExecutionReceipt,
} from '../../lib/kanban/types';
import { taskSessionUrl } from '../../lib/kanban/task-execution';

export const UNKNOWN = 'неизвестно' as const;

export interface TaskFacts {
  id: string;
  version: number;
  title: string;
  project: string;
  status: KanbanColumn;
  priority: Priority;
  /** The last submitted result, not a claim of human acceptance. */
  done: string;
  remaining: string;
  nextStep: string;
  evidence: string[];
  blocker: string;
  /** An explicit source/run/session link; no shell command is synthesized. */
  command: string;
  owner: string;
  machine: string;
}

export interface KonturFilters {
  project?: string;
  server?: string;
  status?: string;
  priority?: string;
  search?: string;
}

export interface KonturSession {
  id: string;
  cardId: string;
  cardTitle: string;
  cardVersion: number;
  project: string;
  operationId: string;
  sessionId: string;
  harness: string;
  machine: string;
  phase: TaskExecutionReceipt['phase'] | TaskExecutionContinuation['phase'];
  state: 'running' | 'waiting' | 'stopped' | 'result' | 'unknown';
  stateLabel: string;
  updatedAt: string;
  href: string | null;
  /** A persisted receipt is never a live heartbeat, regardless of its age. */
  liveState: typeof UNKNOWN;
  source: 'taskExecutionHistory';
  sourceVersion: number;
  continuationId?: string;
}

export interface KonturActivity {
  id: string;
  cardId: string;
  cardTitle: string;
  project: string;
  kind: 'created' | 'updated' | 'result' | 'review' | 'execution' | 'question' | 'answer' | 'control';
  title: string;
  detail: string;
  at: string;
  actor: string;
  refs: string[];
}

export interface KonturDecision {
  id: string;
  cardId: string;
  cardTitle: string;
  project: string;
  decision: 'accepted' | 'rework' | 'answer' | 'answer-pending';
  title: string;
  note: string;
  actor: string;
  at: string;
  refs: string[];
}

export interface KonturRelease {
  id: string;
  cardId: string;
  cardTitle: string;
  project: string;
  kind: 'pr' | 'release' | 'commit' | 'deployment' | 'reference';
  title: string;
  reference: string;
  href: string | null;
  /** Recording an evidence URL cannot establish PR or deployment status. */
  state: typeof UNKNOWN;
  at: string;
  source: string;
}

const STATUS_LABELS: Record<KanbanColumn, string> = {
  inbox: 'Входящие', todo: 'К выполнению', 'in-progress': 'В работе', review: 'На проверке',
  blocked: 'Заблокировано', done: 'Готово', someday: 'Бэклог', archived: 'Не планируется',
};
const PRIORITY_LABELS: Record<Priority, string> = {
  low: 'Низкий', medium: 'Средний', high: 'Высокий', critical: 'Критический',
};

function present(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function known(value: unknown): string {
  return present(value) ?? UNKNOWN;
}

function refs(values: readonly unknown[] | undefined): string[] {
  return [...new Set((values ?? []).flatMap(value => {
    const text = present(value);
    return text ? [text] : [];
  }))];
}

function timestamp(value: unknown): string {
  const text = present(value);
  return text && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(text)
    && Number.isFinite(Date.parse(text)) ? text : UNKNOWN;
}

function time(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : -Infinity;
}

function newestFirst<T extends { at: string; id: string }>(items: T[]): T[] {
  return items.sort((a, b) => {
    const first = time(a.at), second = time(b.at);
    return first === second ? a.id.localeCompare(b.id) : first > second ? -1 : 1;
  });
}

/** Only absolute HTTP(S) links can become hrefs. Opaque refs remain plain text. */
export function safeExternalUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4096 || /[\x00-\x1f\x7f\\]/.test(value)) return null;
  const text = value.trim();
  if (!/^https?:\/\//i.test(text) || /\s/.test(text)) return null;
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function sessionHref(receipt: TaskExecutionReceipt | undefined): string | null {
  if (!receipt) return null;
  if (receipt.provider === 'dot') return safeExternalUrl(receipt.sessionUrl);
  return receipt.nativeSessionId
    ? safeExternalUrl(taskSessionUrl(receipt.hostId, receipt.harness, receipt.nativeSessionId))
    : null;
}

function manualVerification(card: KanbanCard): { result: string; evidence: string; checkedAt: string; actor: string } | undefined {
  for (const item of [...(card.completionEvidence ?? [])].reverse()) {
    if (item.type !== 'manual_result_verification' || item.origin !== 'human-ui'
      || !present(item.result) || !present(item.evidence) || !present(item.actor)
      || timestamp(item.checkedAt) === UNKNOWN) continue;
    // A free-form legacy completionEvidence object alone is not an accepted
    // human verification. The native route writes this matching review record.
    if (!(card.reviewHistory ?? []).some(review => review.decision === 'accepted'
      && review.actor === item.actor && time(review.decidedAt) === time(item.checkedAt as string))) continue;
    return { result: (item.result as string).trim(), evidence: (item.evidence as string).trim(),
      checkedAt: item.checkedAt as string, actor: item.actor as string };
  }
  return undefined;
}

/** Read only explicit result/next-action/blocker fields, never infer them from prose. */
export function taskFacts(card: KanbanCard): TaskFacts {
  const result = card.resultHistory?.at(-1);
  const verified = manualVerification(card);
  const useVerified = verified && (!result || timestamp(result.submittedAt) !== UNKNOWN
    && time(verified.checkedAt) >= time(result.submittedAt));
  const receipt = card.taskExecutionHistory?.at(-1);
  const nextStep = card.nextAction === null ? UNKNOWN
    : present(card.nextAction) ?? present(result?.nextAction) ?? present(receipt?.nextAction) ?? UNKNOWN;
  const review = card.reviewHistory?.at(-1);
  // A superseded rework note is history, not a new unresolved requirement.
  const currentRework = review?.decision === 'rework'
    && !['review', 'done', 'archived'].includes(card.column)
    && timestamp(review.decidedAt) !== UNKNOWN
    && (!result || time(review.decidedAt) >= time(result.submittedAt));
  const remaining = card.nextAction === null ? UNKNOWN
    : nextStep !== UNKNOWN ? nextStep : currentRework ? known(review?.note) : UNKNOWN;
  const waiting = refs(card.waitingFor);
  const question = card.pendingQuestion;
  const blocker = present(card.blockerReason)
    ?? (question && !question.answer && present(question.text) ? `Ожидается ответ: ${question.text.trim()}` : undefined)
    ?? present(question?.deliveryError)
    ?? (waiting.length ? `Ожидает: ${waiting.join(', ')}` : undefined)
    ?? UNKNOWN;
  const command = safeExternalUrl(card.source) ?? safeExternalUrl(result?.runRef)
    ?? (useVerified ? safeExternalUrl(verified.evidence) : null) ?? sessionHref(receipt) ?? UNKNOWN;
  return {
    id: card.id,
    version: card.version,
    title: known(card.title),
    project: known(card.project),
    status: card.column,
    priority: card.priority,
    done: useVerified ? verified.result : known(result?.summary),
    remaining,
    nextStep,
    // Do not turn source-admission evidence into proof of the submitted result.
    evidence: useVerified ? [verified.evidence] : refs(result ? result.evidenceRefs : receipt?.evidenceRefs),
    blocker,
    command,
    owner: known(card.owner),
    machine: known(receipt?.hostId),
  };
}

function storedState(phase: KonturSession['phase']): Pick<KonturSession, 'state' | 'stateLabel'> {
  switch (phase) {
    case 'running': return { state: 'running', stateLabel: 'Сохранено: в работе' };
    case 'waiting': return { state: 'waiting', stateLabel: 'Сохранено: ожидает продолжения' };
    case 'created': return { state: 'waiting', stateLabel: 'Сессия создана, запуск не подтверждён' };
    case 'stopped': return { state: 'stopped', stateLabel: 'Сохранено: остановлена' };
    case 'result': return { state: 'result', stateLabel: 'Сохранено: результат получен' };
    case 'intent': return { state: 'unknown', stateLabel: 'Запрос сохранён, исполнение неизвестно' };
    case 'create-unknown': return { state: 'unknown', stateLabel: 'Создание сессии не подтверждено' };
    case 'dispatch-unknown': return { state: 'unknown', stateLabel: 'Доставка задания не подтверждена' };
    default: return { state: 'unknown', stateLabel: 'Состояние продолжения неизвестно' };
  }
}

/** Project stored attempts, including uncertain ones, without inventing a session. */
export function getSessions(cards: readonly KanbanCard[]): KonturSession[] {
  const sessions: KonturSession[] = [];
  for (const card of cards) {
    const seen = new Set<string>();
    for (const receipt of [...(card.taskExecutionHistory ?? [])].reverse()) {
      const identity = receipt.nativeSessionId
        ? JSON.stringify([receipt.hostId, receipt.harness, receipt.nativeSessionId])
        : `operation:${receipt.operationId}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      // Follow-up turns belong to a completed parent. A later explicit stop on
      // the parent must not be masked by an older child that still says running.
      const continuation = receipt.phase === 'result' ? receipt.continuations?.at(-1) : undefined;
      const phase = continuation?.phase ?? receipt.phase;
      sessions.push({
        id: `${card.id}:session:${receipt.operationId}`,
        cardId: card.id,
        cardTitle: known(card.title),
        cardVersion: card.version,
        project: known(card.project),
        operationId: known(receipt.operationId),
        sessionId: known(receipt.nativeSessionId),
        harness: known(receipt.harness),
        machine: known(receipt.hostId),
        phase,
        ...storedState(phase),
        updatedAt: timestamp(continuation?.updatedAt ?? receipt.updatedAt),
        href: sessionHref(receipt),
        liveState: UNKNOWN,
        source: 'taskExecutionHistory',
        sourceVersion: receipt.lastBoardVersion,
        ...(continuation ? { continuationId: continuation.id } : {}),
      });
    }
  }
  return sessions.sort((a, b) => {
    const first = time(a.updatedAt), second = time(b.updatedAt);
    return first === second ? a.id.localeCompare(b.id) : first > second ? -1 : 1;
  });
}

function identity(card: KanbanCard) {
  return { cardId: card.id, cardTitle: known(card.title), project: known(card.project) };
}

/** Human review and answer records are retained separately from executor results. */
export function getDecisions(cards: readonly KanbanCard[]): KonturDecision[] {
  const decisions: KonturDecision[] = [];
  for (const card of cards) {
    const base = identity(card);
    for (const [index, review] of (card.reviewHistory ?? []).entries()) {
      decisions.push({
        ...base, id: `${card.id}:review:${index}`, decision: review.decision,
        title: review.decision === 'accepted' ? 'Результат принят' : 'Возвращено на доработку',
        note: known(review.note), actor: known(review.actor), at: timestamp(review.decidedAt), refs: [],
      });
    }
    const question = card.pendingQuestion;
    if (question?.answer) {
      decisions.push({
        ...base, id: `${card.id}:answer:${question.id}`, decision: 'answer', title: 'Ответ сохранён',
        note: known(question.answer.label || question.answer.value), actor: known(question.answer.by),
        at: timestamp(question.answer.answeredAt), refs: [question.id],
      });
    }
    for (const receipt of card.taskExecutionHistory ?? []) {
      const proposal = receipt.taskDecisionProposal;
      if (!proposal) continue;
      const continuation = receipt.taskDecisionContinuation;
      const applied = continuation !== undefined && continuation.requestId === proposal.requestId;
      decisions.push({
        ...base, id: `${card.id}:decision:${receipt.operationId}:${proposal.proposalRef}`,
        decision: applied ? 'answer' : 'answer-pending',
        title: applied ? 'Ответ передан в связанную сессию' : 'Ответ сохранён, продолжение не подтверждено',
        note: known(proposal.value), actor: known(proposal.authenticatedActor),
        // Proposal has no decision timestamp. Receipt.updatedAt is not that timestamp.
        at: applied ? timestamp(continuation?.updatedAt) : UNKNOWN,
        refs: refs([proposal.proposalRef, applied ? continuation?.resultRef : undefined]),
      });
    }
  }
  return newestFirst(decisions);
}

/** These are stored events and latest card writes, not a reconstructed full audit log. */
export function getActivity(cards: readonly KanbanCard[]): KonturActivity[] {
  const activity: KonturActivity[] = [];
  for (const card of cards) {
    const base = identity(card);
    activity.push({
      ...base, id: `${card.id}:created`, kind: 'created', title: 'Задача создана', detail: known(card.title),
      at: timestamp(card.created), actor: UNKNOWN, refs: [],
    });
    if (timestamp(card.updated) !== UNKNOWN && time(card.updated) !== time(card.created)) {
      activity.push({
        ...base, id: `${card.id}:updated`, kind: 'updated', title: 'Карточка обновлена',
        detail: `Сохранена версия ${card.version}`, at: timestamp(card.updated), actor: UNKNOWN, refs: [],
      });
    }
    for (const [index, result] of (card.resultHistory ?? []).entries()) {
      activity.push({
        ...base, id: `${card.id}:result:${index}`, kind: 'result', title: 'Результат сохранён',
        detail: known(result.summary), actor: known(result.submittedBy), at: timestamp(result.submittedAt), refs: refs(result.evidenceRefs),
      });
    }
    for (const receipt of card.taskExecutionHistory ?? []) {
      activity.push({
        ...base, id: `${card.id}:execution:${receipt.operationId}`, kind: 'execution',
        title: storedState(receipt.phase).stateLabel, detail: known(receipt.lastProgress),
        at: timestamp(receipt.updatedAt), actor: UNKNOWN, refs: refs(receipt.evidenceRefs),
      });
      for (const child of receipt.continuations ?? []) {
        activity.push({
          ...base, id: `${card.id}:continuation:${child.id}`, kind: 'execution',
          title: storedState(child.phase).stateLabel, detail: known(child.summary ?? child.instruction),
          at: timestamp(child.updatedAt), actor: UNKNOWN, refs: refs(child.evidenceRefs),
        });
      }
      const controls = receipt.sessionControls;
      for (const [kind, entries] of [
        ['direct', controls?.direct ?? []],
        ['stop', controls?.stops ?? (controls?.stop ? [controls.stop] : [])],
      ] as const) {
        for (const control of entries) {
          activity.push({
            ...base, id: `${card.id}:control:${kind}:${control.requestHash}`, kind: 'control',
            title: kind === 'stop' ? 'Сохранён запрос остановки' : 'Сохранено указание сессии',
            detail: control.phase === 'accepted' ? 'Приём запроса подтверждён'
              : control.phase === 'intent' ? 'Намерение сохранено' : 'Исход запроса неизвестен',
            at: timestamp(control.updatedAt), actor: UNKNOWN, refs: [],
          });
        }
      }
    }
    if (card.pendingQuestion) {
      activity.push({
        ...base, id: `${card.id}:question:${card.pendingQuestion.id}`, kind: 'question', title: 'Сохранён вопрос исполнителя',
        detail: known(card.pendingQuestion.text), at: timestamp(card.pendingQuestion.askedAt), actor: UNKNOWN,
        refs: [card.pendingQuestion.id],
      });
    }
  }
  for (const decision of getDecisions(cards)) {
    activity.push({
      id: decision.id, cardId: decision.cardId, cardTitle: decision.cardTitle, project: decision.project,
      kind: decision.decision === 'accepted' || decision.decision === 'rework' ? 'review' : 'answer',
      title: decision.title, detail: decision.note, at: decision.at, actor: decision.actor, refs: [...decision.refs],
    });
  }
  return newestFirst(activity);
}

function referenceKind(href: string | null): Pick<KonturRelease, 'kind' | 'title'> {
  if (href) {
    const url = new URL(href);
    const github = ['github.com', 'www.github.com'].includes(url.hostname);
    const gitlab = ['gitlab.com', 'www.gitlab.com'].includes(url.hostname);
    if (github && /^\/[^/]+\/[^/]+\/pull\/\d+(?:\/|$)/.test(url.pathname)
      || gitlab && /\/-\/merge_requests\/\d+(?:\/|$)/.test(url.pathname)) return { kind: 'pr', title: 'PR / запрос на слияние' };
    if (github && /^\/[^/]+\/[^/]+\/releases\/tag\/[^/]+/.test(url.pathname)
      || gitlab && /\/-\/releases\/[^/]+/.test(url.pathname)) return { kind: 'release', title: 'Релиз' };
    if (github && /^\/[^/]+\/[^/]+\/commit\/[a-f0-9]{7,64}(?:\/|$)/i.test(url.pathname)
      || gitlab && /\/-\/commit\/[a-f0-9]{7,64}(?:\/|$)/i.test(url.pathname)) return { kind: 'commit', title: 'Коммит' };
    if (github && /^\/[^/]+\/[^/]+\/deployments\/[^/]+/.test(url.pathname)) return { kind: 'deployment', title: 'Выкладка' };
  }
  return { kind: 'reference', title: 'Сохранённая ссылка' };
}

/** Only explicit result/run references are listed; their remote status stays unknown. */
export function getReleases(cards: readonly KanbanCard[]): KonturRelease[] {
  const items = new Map<string, KonturRelease>();
  for (const card of cards) {
    const add = (reference: unknown, at: unknown, source: string) => {
      const value = present(reference);
      if (!value) return;
      const href = safeExternalUrl(value);
      // Opaque source IDs and unsafe schemes are evidence text, not web releases.
      if (!href) return;
      const id = `${card.id}:reference:${href}`;
      const item: KonturRelease = {
        ...identity(card), id, ...referenceKind(href), reference: value, href,
        state: UNKNOWN, at: timestamp(at), source,
      };
      const previous = items.get(id);
      if (!previous || time(item.at) >= time(previous.at)) items.set(id, item);
    };
    for (const result of card.resultHistory ?? []) {
      for (const ref of result.evidenceRefs) add(ref, result.submittedAt, 'resultHistory.evidenceRefs');
      add(result.runRef, result.submittedAt, 'resultHistory.runRef');
    }
    for (const receipt of card.taskExecutionHistory ?? []) {
      for (const ref of receipt.evidenceRefs ?? []) add(ref, receipt.lastProgressAt ?? receipt.updatedAt, 'taskExecutionHistory.evidenceRefs');
      for (const child of receipt.continuations ?? []) {
        for (const ref of child.evidenceRefs ?? []) add(ref, child.updatedAt, 'taskExecutionHistory.continuations.evidenceRefs');
      }
    }
    const verified = manualVerification(card);
    if (verified) add(verified.evidence, verified.checkedAt, 'completionEvidence.manual_result_verification.evidence');
  }
  return newestFirst([...items.values()]);
}

function searchable(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
}

function selected(value: string | undefined): value is string {
  return Boolean(value && value !== 'all');
}

/** Preserve native cards and IDs; filters only select records from the supplied read. */
export function filterCards(cards: readonly KanbanCard[], filters: KonturFilters = {}): KanbanCard[] {
  const terms = searchable(filters.search?.trim() ?? '').split(/\s+/).filter(Boolean);
  return cards.filter(card => {
    const facts = taskFacts(card);
    if (selected(filters.project) && facts.project !== filters.project) return false;
    if (selected(filters.server) && facts.machine !== filters.server) return false;
    if (selected(filters.status) && card.column !== filters.status) return false;
    if (selected(filters.priority) && card.priority !== filters.priority) return false;
    if (!terms.length) return true;
    const text = searchable([
      card.id, card.title, card.description, facts.project, facts.machine, facts.owner,
      ...card.assignees, ...card.tags, card.column, card.priority, STATUS_LABELS[card.column], PRIORITY_LABELS[card.priority],
      facts.done, facts.remaining, facts.nextStep, facts.blocker, ...facts.evidence,
    ].join(' '));
    return terms.every(term => text.includes(term));
  });
}

export function getFilterOptions(cards: readonly KanbanCard[]): { projects: string[]; servers: string[] } {
  const facts = cards.map(taskFacts);
  const order = (values: string[]) => [...new Set(values)].sort((a, b) => {
    if (a === b) return 0;
    if (a === UNKNOWN) return 1;
    if (b === UNKNOWN) return -1;
    return a.localeCompare(b, 'ru-RU', { numeric: true });
  });
  return { projects: order(facts.map(item => item.project)), servers: order(facts.map(item => item.machine)) };
}
