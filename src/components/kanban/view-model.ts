import type { KanbanCard, RoleDefinition } from '@/lib/kanban/types';
import { getExecutionView, getRoleBalance, getTodayView, getWeekView, type RoleBalanceView } from '../../lib/kanban/planning-views';

export type PlanningTab = 'dashboard' | 'execution' | 'inbox' | 'week' | 'today' | 'balance' | 'closed';
export type WorkspaceView = 'mine' | 'shared' | 'all';
export type PrimaryBoardLane = 'incoming' | 'in-progress' | 'review';

/** Resolves the visible workspace filter; only the exact QA SSO actor gets the server-scoped QA view. */
export function resolveInitialWorkspaceView(
  hostname: string,
  username: string | null,
  requested: WorkspaceView | undefined,
): WorkspaceView {
  if (hostname === 'qa-board.bezrabotnyi.com' && username === 'testlogin') return 'all';
  if (username === 'nikita' && requested) return requested;
  return 'mine';
}

const INCOMING_COLUMNS = new Set<KanbanCard['column']>(['inbox', 'todo', 'someday']);
const IN_PROGRESS_COLUMNS = new Set<KanbanCard['column']>(['in-progress', 'blocked']);
const PRIORITY_ORDER: Record<KanbanCard['priority'], number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** One visible incoming queue for inbox, to-do and backlog cards. */
export function getPrimaryBoardLaneCards(cards: KanbanCard[], lane: PrimaryBoardLane): KanbanCard[] {
  const selected = cards.filter(card => lane === 'incoming'
    ? INCOMING_COLUMNS.has(card.column)
    : lane === 'in-progress'
      ? IN_PROGRESS_COLUMNS.has(card.column)
      : card.column === 'review');
  return lane === 'incoming' ? sortIncomingCards(selected) : selected;
}

/** Urgent items come first, then the nearest deadline, priority and oldest creation. */
export function sortIncomingCards(cards: KanbanCard[]): KanbanCard[] {
  return [...cards].sort((left, right) => {
    const leftUrgent = left.urgent || left.priority === 'critical' ? 0 : 1;
    const rightUrgent = right.urgent || right.priority === 'critical' ? 0 : 1;
    if (leftUrgent !== rightUrgent) return leftUrgent - rightUrgent;
    const leftDueParsed = left.dueAt ? Date.parse(left.dueAt) : Number.POSITIVE_INFINITY;
    const rightDueParsed = right.dueAt ? Date.parse(right.dueAt) : Number.POSITIVE_INFINITY;
    const leftDue = Number.isNaN(leftDueParsed) ? Number.POSITIVE_INFINITY : leftDueParsed;
    const rightDue = Number.isNaN(rightDueParsed) ? Number.POSITIVE_INFINITY : rightDueParsed;
    if (leftDue !== rightDue) return leftDue < rightDue ? -1 : 1;
    const priorityDifference = PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority];
    if (priorityDifference !== 0) return priorityDifference;
    return Date.parse(left.created) - Date.parse(right.created) || left.id.localeCompare(right.id);
  });
}

/**
 * Executor names on a card: the legacy single field plus the list.
 *
 * A named executor is the person doing the work. Waiting for someone or
 * asking for their approval does not move the work to them.
 */
function executorsOf(card: KanbanCard): string[] {
  return [card.assignee ?? '', ...card.assignees].map(value => value.trim()).filter(Boolean);
}

/** Distinct normalized participants: owner, executors, waiters and approvers. */
export function getCardParticipants(card: KanbanCard): string[] {
  return [...new Set([card.owner ?? '', ...executorsOf(card),
    ...(card.waitingFor ?? []), ...(card.requiresApprovalFrom ?? [])]
    .map(value => value.trim()).filter(Boolean).map(normalizePerson))];
}

/** «Моё» means being the executor; the owner counts only when nobody is assigned. */
export function isPersonalCard(card: KanbanCard, person: string): boolean {
  const selected = normalizePerson(person);
  const executors = executorsOf(card).map(normalizePerson);
  if (executors.length > 0) return executors.some(executor => executor === selected);
  return Boolean(card.owner?.trim()) && normalizePerson(card.owner!) === selected;
}

/** «Общее» collects the shared flag and cards with more than one real participant. */
export function isSharedCard(card: KanbanCard): boolean {
  return card.shared === true || getCardParticipants(card).length >= 2;
}

/** Limits the shared Markdown store to the selected person's useful work. */
export function filterWorkspaceCards(cards: KanbanCard[], person: string, view: WorkspaceView): KanbanCard[] {
  if (view === 'all') return cards;
  if (view === 'shared') return cards.filter(isSharedCard);
  return cards.filter(card => isPersonalCard(card, person));
}

/** Tooltip copy that keeps the three workspace views unambiguous. */
export const WORKSPACE_HINT: Record<WorkspaceView, string> = {
  mine: 'Задачи, где вы исполнитель; если исполнитель не назначен — где вы владелец. Роль владельца без исполнителя, ожидание или согласование задачу вашей не делают',
  shared: 'Явно общие задачи и задачи с несколькими участниками: владелец, исполнители, согласующие или ожидающие',
  all: 'Все задачи, разрешённые сервером для этой области',
};

/** Discovers people already represented by card owners or assignments. */
export function getPeople(cards: KanbanCard[]): string[] {
  const labels = new Map<string, string>();
  for (const value of cards.flatMap(card => [card.owner, card.assignee, ...card.assignees, ...(card.waitingFor ?? []), ...(card.requiresApprovalFrom ?? [])])) {
    if (!value?.trim()) continue;
    const key = normalizePerson(value);
    if (!labels.has(key)) labels.set(key, personLabel(value));
  }
  return [...labels.values()].sort((left, right) => left.localeCompare(right, 'ru'));
}

/** Maps every stored/display alias to the authenticated Nikita identity key. */
function normalizePerson(value: string): string {
  const trimmed = value.trim();
  const alias = trimmed.toLocaleLowerCase('ru-RU');
  return ['nikita', 'никита', 'никита розанов'].includes(alias) ? 'nikita' : trimmed;
}

/** Keep the canonical visible name separate from the stable identity key. */
function personLabel(value: string): string {
  return normalizePerson(value) === 'nikita' ? 'Никита Розанов' : value.trim();
}

/** Returns the cards shown by one planning tab, using the shared deterministic predicates. */
export function getPlanningTabCards(cards: KanbanCard[], tab: PlanningTab, now: string | Date = new Date()): KanbanCard[] {
  if (tab === 'dashboard') return sortIncomingCards(cards.filter(card => !isClosedCard(card)));
  if (tab === 'inbox') return getPrimaryBoardLaneCards(cards, 'incoming');
  if (tab === 'closed') return cards.filter(isClosedCard);
  if (tab === 'week') return getWeekView(cards, now);
  if (tab === 'today') return getTodayView(cards, now);
  if (tab === 'balance') return Object.values(getRoleBalance(cards, now)).flatMap(balance => balance.activeActions
    .map(id => cards.find(card => card.id === id)).filter((card): card is KanbanCard => Boolean(card)));
  const execution = getExecutionView(cards);
  return Object.values(execution).flatMap(columnCards => columnCards).filter(card => card.column !== 'archived');
}

/** Returns the role balance projection for the current planning scope. */
export function getPlanningRoleBalance(cards: KanbanCard[], now: string | Date = new Date(), roles?: readonly RoleDefinition[]): RoleBalanceView {
  return getRoleBalance(cards, now, roles);
}

/** Validates the server contract for selecting a weekly batch of one to six cards. */
export function getWeeklySelectionState(selectedIds: string[]): { selectedIds: string[]; canAccept: boolean } {
  const uniqueIds = [...new Set(selectedIds)];
  return { selectedIds: uniqueIds, canAccept: uniqueIds.length >= 1 && uniqueIds.length <= 6 };
}

export function getProjectOptions(cards: KanbanCard[], registered: { name: string }[] = []): string[] {
  const projects = new Set([...registered.map(project => project.name.trim()), ...cards.map(card => card.project.trim())].filter(Boolean));
  return [...projects].sort((a, b) => a.localeCompare(b, 'ru'))
    .concat(cards.some(card => !card.project.trim()) ? ['Без проекта'] : []);
}

export function getAssigneeOptions(cards: KanbanCard[]): string[] {
  const assignees = new Set(
    cards.flatMap(card => card.assignees.map(assignee => assignee.trim()).filter(Boolean)),
  );
  return [...assignees].sort((a, b) => a.localeCompare(b, 'ru'));
}

export function filterCards(cards: KanbanCard[], project: string, assignee = 'all'): KanbanCard[] {
  if (project === 'all' && assignee === 'all') return cards;

  return cards.filter(card => {
    const matchesProject = project === 'all'
      || (project === 'Без проекта' ? !card.project.trim() : card.project === project);
    const matchesAssignee = assignee === 'all'
      || card.assignees.some(value => value.trim() === assignee);

    return matchesProject && matchesAssignee;
  });
}

export type AttentionFilter = 'all' | 'blocked' | 'unassigned';

/** Closed cards stay readable without being presented as active work. */
export function isClosedCard(card: Pick<KanbanCard, 'column'>): boolean {
  return card.column === 'done' || card.column === 'archived';
}

/** Search is a read-only projection; all terms must occur in the card. */
export function searchCards(cards: KanbanCard[], query: string): KanbanCard[] {
  const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase('ru');
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return cards;
  return cards.filter(card => {
    const text = normalize([card.title, card.description, card.project, card.owner ?? '', card.accountable ?? '',
      card.nextAction ?? '', card.blockerReason ?? '', card.source ?? '',
      ...card.tags, ...card.assignees, ...(card.waitingFor ?? []), ...(card.requiresApprovalFrom ?? []), card.assignee ?? ''].join(' '));
    return terms.every(term => text.includes(term));
  });
}

export function filterAttentionCards(cards: KanbanCard[], attention: AttentionFilter): KanbanCard[] {
  if (attention === 'all') return cards;
  return cards.filter(card => !isClosedCard(card) && (attention === 'blocked'
    ? card.column === 'blocked'
    : card.assignees.length === 0 && !card.assignee?.trim()));
}

export function getBoardCounts(cards: KanbanCard[]) {
  return {
    active: cards.filter(card => !isClosedCard(card)).length,
    done: cards.filter(card => card.column === 'done').length,
    archived: cards.filter(card => card.column === 'archived').length,
    blocked: filterAttentionCards(cards, 'blocked').length,
    unassigned: filterAttentionCards(cards, 'unassigned').length,
  };
}

export function isSmartNotesInbox(card: KanbanCard): boolean {
  return card.column === 'inbox';
}
