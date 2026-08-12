import type { KanbanCard } from '@/lib/kanban/types';
import { getExecutionView, getInboxView, getRoleBalance, getTodayView, getWeekView, type RoleBalanceView } from '../../lib/kanban/planning-views';

export type PlanningTab = 'execution' | 'inbox' | 'week' | 'today' | 'balance';

/** Returns the cards shown by one planning tab, using the shared deterministic predicates. */
export function getPlanningTabCards(cards: KanbanCard[], tab: PlanningTab, now: string | Date = new Date()): KanbanCard[] {
  if (tab === 'inbox') return getInboxView(cards);
  if (tab === 'week') return getWeekView(cards, now);
  if (tab === 'today') return getTodayView(cards, now);
  if (tab === 'balance') return Object.values(getRoleBalance(cards, now)).flatMap(balance => balance.activeActions
    .map(id => cards.find(card => card.id === id)).filter((card): card is KanbanCard => Boolean(card)));
  const execution = getExecutionView(cards);
  return Object.values(execution).flatMap(columnCards => columnCards).filter(card => card.column !== 'archived');
}

/** Returns the role balance projection for the current planning scope. */
export function getPlanningRoleBalance(cards: KanbanCard[], now: string | Date = new Date()): RoleBalanceView {
  return getRoleBalance(cards, now);
}

/** Validates the server contract for selecting a weekly batch of one to six cards. */
export function getWeeklySelectionState(selectedIds: string[]): { selectedIds: string[]; canAccept: boolean } {
  const uniqueIds = [...new Set(selectedIds)];
  return { selectedIds: uniqueIds, canAccept: uniqueIds.length >= 1 && uniqueIds.length <= 6 };
}

export function getProjectOptions(cards: KanbanCard[]): string[] {
  const projects = new Set(cards.map(card => card.project.trim()).filter(Boolean));
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

export function isSmartNotesInbox(card: KanbanCard): boolean {
  return card.column === 'inbox';
}
