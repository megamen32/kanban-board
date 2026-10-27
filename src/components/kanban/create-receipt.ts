import type { KanbanCard } from '@/lib/kanban/types';
import {
  filterAttentionCards,
  filterWorkspaceCards,
  getPlanningTabCards,
  isClosedCard,
  type AttentionFilter,
  type PlanningTab,
  type WorkspaceView,
} from './view-model';

/** The board filters that can hide a freshly created card. */
export interface BoardScope {
  workspaceView: WorkspaceView;
  person: string;
  project: string;
  assignee: string;
  attention: AttentionFilter;
  inboxOnly: boolean;
  planningTab: PlanningTab;
}

/** What kind of board filter hides the card. */
export type HideReason = 'workspace' | 'project' | 'assignee' | 'attention' | 'inbox' | 'tab';

export interface PlacementIssue {
  kind: HideReason;
  label: string;
}

export interface CardPlacement {
  /** True when the board shows the card with the scope as it is. */
  visibleNow: boolean;
  /**
   * The narrowest workspace view that shows the card.
   *
   * Null when only «Всё» would show it: the board never moves there on its own
   * and never offers it as a one-click action, because the workspace view is a
   * filter rather than an access rule.
   */
  matchingView: WorkspaceView | null;
  /** The tab that shows the card. */
  tab: PlanningTab;
  /** Every filter that hides the card right now. */
  issues: PlacementIssue[];
  /** Owner and shared state of the card, for the confirmation text. */
  location: string;
}

export const WORKSPACE_LABEL: Record<WorkspaceView, string> = {
  mine: 'Моё',
  shared: 'Общее',
  all: 'Всё',
};

export const TAB_LABEL: Record<PlanningTab, string> = {
  dashboard: 'Обзор',
  execution: 'Активные',
  inbox: 'Входящие',
  week: 'Неделя',
  today: 'Сегодня',
  balance: 'Баланс ролей',
  closed: 'Закрытые',
};

/** Mirrors the board project filter, including the «Без проекта» bucket. */
function projectMatches(card: KanbanCard, project: string): boolean {
  if (project === 'all') return true;
  return project === 'Без проекта' ? !card.project.trim() : card.project === project;
}

/** Mirrors the board assignee filter. */
function assigneeMatches(card: KanbanCard, assignee: string): boolean {
  return assignee === 'all' || card.assignees.some(value => value.trim() === assignee);
}

/** Mirrors the planning tabs that can hold the card. */
function tabShows(card: KanbanCard, tab: PlanningTab): boolean {
  return getPlanningTabCards([card], tab).some(candidate => candidate.id === card.id);
}

/** Names the owner and the shared state of the card. */
function describeLocation(card: KanbanCard, matchingView: WorkspaceView | null): string {
  const owner = card.owner?.trim() || 'не указан';
  const shared = card.shared === true ? 'да' : 'нет';
  const place = matchingView === null
    ? 'в текущих фильтрах не видна'
    : `видна в режиме «${WORKSPACE_LABEL[matchingView]}»`;
  return `Владелец: ${owner} · Общая: ${shared} · ${place}`;
}

/**
 * Finds where a created card is visible without changing anything.
 *
 * The workspace view is a filter, not an access rule, so «Всё» can expose cards
 * the current view hides. This function only reports; it never widens a scope.
 *
 * @param card The card the server confirmed.
 * @param scope The board scope the user is looking at.
 * @returns The visible place, what hides it, and the card's owner/shared state.
 */
export function placeCreatedCard(card: KanbanCard, scope: BoardScope): CardPlacement {
  const issues: PlacementIssue[] = [];
  const showsIn = (view: WorkspaceView) => filterWorkspaceCards([card], scope.person, view).length > 0;

  if (!showsIn(scope.workspaceView)) {
    issues.push({ kind: 'workspace', label: `режим «${WORKSPACE_LABEL[scope.workspaceView]}»` });
  }
  if (!projectMatches(card, scope.project)) issues.push({ kind: 'project', label: 'фильтр проекта' });
  if (!assigneeMatches(card, scope.assignee)) issues.push({ kind: 'assignee', label: 'фильтр ответственного' });
  if (scope.attention !== 'all' && filterAttentionCards([card], scope.attention).length === 0) {
    issues.push({ kind: 'attention', label: 'счётчик внимания' });
  }
  if (scope.inboxOnly && card.column !== 'inbox') issues.push({ kind: 'inbox', label: 'фильтр «Входящие»' });
  if (!tabShows(card, scope.planningTab)) issues.push({ kind: 'tab', label: `вкладка «${TAB_LABEL[scope.planningTab]}»` });

  // The narrowest view that shows the card; «Всё» is never selected as a target.
  const matchingView = showsIn(scope.workspaceView)
    ? scope.workspaceView
    : showsIn('mine')
      ? 'mine'
      : showsIn('shared')
        ? 'shared'
        : null;
  const tab = isClosedCard(card) ? 'closed' : 'execution';

  return {
    visibleNow: issues.length === 0,
    matchingView,
    tab,
    issues,
    location: describeLocation(card, matchingView),
  };
}

/**
 * Builds the scope the board may apply on its own after a create.
 *
 * The only automatic change is a narrowing into the matching owner or shared
 * view, and only when that makes the confirmed card visible. No filter is ever
 * widened, and «Всё» is never entered on its own.
 *
 * @param card The card the server confirmed.
 * @param scope The board scope the user is looking at.
 * @param placement The placement computed for that scope.
 * @returns The scope to apply automatically.
 */
export function automaticRevealScope(card: KanbanCard, scope: BoardScope, placement: CardPlacement): BoardScope {
  const workspaceView = placement.matchingView === 'mine' || placement.matchingView === 'shared'
    ? placement.matchingView
    : scope.workspaceView;
  const planningTab = tabShows(card, scope.planningTab) ? scope.planningTab : placement.tab;
  const next: BoardScope = { ...scope, workspaceView, planningTab };
  // Apply a narrowing workspace view or tab change only if the card will be visible.
  return placeCreatedCard(card, next).visibleNow ? next : { ...scope };
}

/**
 * Describes the outcome in the words the user needs.
 *
 * @param card The card the server confirmed.
 * @param placement The placement after the automatic scope was applied.
 * @param viewChange The workspace view the board moved from, when it moved.
 * @returns A readable confirmation for the board.
 */
export function describePlacement(
  card: KanbanCard,
  placement: CardPlacement,
  viewChange?: { from: WorkspaceView; to: WorkspaceView },
): string {
  const title = card.title;
  if (placement.visibleNow && placement.matchingView) {
    const base = `Задача «${title}» создана и показана в режиме «${WORKSPACE_LABEL[placement.matchingView]}», вкладке «${TAB_LABEL[placement.tab]}». ${placement.location}.`;
    if (!viewChange) return base;
    return `${base} Режим переключён с «${WORKSPACE_LABEL[viewChange.from]}» на «${WORKSPACE_LABEL[viewChange.to]}», чтобы карточка была видна.`;
  }
  const reasons = placement.issues.map(issue => issue.label).join(', ');
  return `Задача «${title}» создана. ${placement.location}. Сейчас её скрывает: ${reasons}. Откройте карточку или снимите фильтр — доска не расширяет видимость.`;
}
