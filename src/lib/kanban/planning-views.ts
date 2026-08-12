import { ROLE_IDS } from './types';
import type { KanbanCard, KanbanColumn, RoleId } from './types';

const MOSCOW_TIME_ZONE = 'Europe/Moscow';
const NIKITA = 'nikita';
const TERMINAL_COLUMNS = new Set<KanbanColumn>(['done', 'archived']);
const ACTIVE_COLUMNS = new Set<KanbanColumn>(['inbox', 'todo', 'in-progress', 'review', 'blocked']);

export type ExecutionView = Record<KanbanColumn, KanbanCard[]>;

export interface RoleBalance {
  acceptedBigRocks: string[];
  activeActions: string[];
  warning: boolean;
}

export type RoleBalanceView = Record<RoleId, RoleBalance>;

/** Returns the local calendar parts for an instant in the Moscow time zone. */
function moscowDateParts(value: string | Date): { year: number; month: number; day: number } | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: MOSCOW_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: 'year' | 'month' | 'day'): number => Number(parts.find(part => part.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

/** Returns an ISO date string for an instant in the Moscow time zone. */
function moscowDate(value: string | Date): string | null {
  const parts = moscowDateParts(value);
  if (!parts) return null;
  return `${parts.year.toString().padStart(4, '0')}-${parts.month.toString().padStart(2, '0')}-${parts.day.toString().padStart(2, '0')}`;
}

/** Returns the ISO week identifier for an instant in the Moscow time zone. */
export function moscowIsoWeek(value: string | Date): string | null {
  const parts = moscowDateParts(value);
  if (!parts) return null;

  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${isoYear}-W${week.toString().padStart(2, '0')}`;
}

/** Compares optional timestamps, placing absent values after explicit values. */
function compareOptionalTimestamp(left?: string, right?: string): number {
  if (left === right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (Number.isNaN(leftTime) && Number.isNaN(rightTime)) return left.localeCompare(right);
  if (Number.isNaN(leftTime)) return 1;
  if (Number.isNaN(rightTime)) return -1;
  return leftTime - rightTime;
}

/** Orders cards by the stable creation, order, and ID tie-breakers. */
function compareStableCards(left: KanbanCard, right: KanbanCard): number {
  const created = compareOptionalTimestamp(left.created, right.created);
  if (created !== 0) return created;
  if (left.order !== right.order) return left.order - right.order;
  return left.id.localeCompare(right.id);
}

/** Returns the Today quadrant number, from I (1) through IV (4). */
function quadrant(card: KanbanCard): number {
  if (card.important && card.urgent) return 1;
  if (card.important) return 2;
  if (card.urgent) return 3;
  return 4;
}

/** Orders cards according to the deterministic Today contract. */
function compareTodayCards(left: KanbanCard, right: KanbanCard): number {
  const rank = (left.todayRank ?? Number.POSITIVE_INFINITY) - (right.todayRank ?? Number.POSITIVE_INFINITY);
  if (rank !== 0) return rank;
  const quadrantDifference = quadrant(left) - quadrant(right);
  if (quadrantDifference !== 0) return quadrantDifference;
  const due = compareOptionalTimestamp(left.dueAt, right.dueAt);
  if (due !== 0) return due;
  return compareStableCards(left, right);
}

/** Returns true when a card explicitly names Nikita in one of its person fields. */
function namesNikita(values: string[] | string | undefined): boolean {
  if (typeof values === 'string') return values.trim() === NIKITA;
  return values?.some(value => value.trim() === NIKITA) ?? false;
}

/** Returns all non-archived cards grouped by their persisted execution column. */
export function getExecutionView(cards: KanbanCard[]): ExecutionView {
  const result = Object.fromEntries(
    (['inbox', 'todo', 'in-progress', 'review', 'blocked', 'done', 'someday', 'archived'] as KanbanColumn[])
      .map(column => [column, [] as KanbanCard[]]),
  ) as ExecutionView;
  for (const card of cards) {
    if (card.column !== 'archived') result[card.column].push(card);
  }
  return result;
}

/** Returns cards in the persisted Inbox column. */
export function getInboxView(cards: KanbanCard[]): KanbanCard[] {
  return cards.filter(card => card.column === 'inbox');
}

/** Returns cards assigned to the current Moscow ISO week, with Big Rocks first. */
export function getWeekView(cards: KanbanCard[], now: string | Date = new Date()): KanbanCard[] {
  const week = moscowIsoWeek(now);
  if (!week) return [];
  return cards
    .filter(card => card.week === week)
    .slice()
    .sort((left, right) => {
      const rock = Number(right.bigRock === true) - Number(left.bigRock === true);
      if (rock !== 0) return rock;
      const rank = (left.todayRank ?? Number.POSITIVE_INFINITY) - (right.todayRank ?? Number.POSITIVE_INFINITY);
      if (rank !== 0) return rank;
      const due = compareOptionalTimestamp(left.dueAt, right.dueAt);
      return due !== 0 ? due : compareStableCards(left, right);
    });
}

/** Returns at most three actionable Moscow-Today cards in the specified scope. */
export function getTodayView(cards: KanbanCard[], now: string | Date = new Date()): KanbanCard[] {
  const today = moscowDate(now);
  if (!today) return [];
  return cards
    .filter(card => {
      if (!ACTIVE_COLUMNS.has(card.column)) return false;
      if (!namesNikita(card.assignee) && !namesNikita(card.assignees) && !namesNikita(card.waitingFor) && !namesNikita(card.requiresApprovalFrom)) return false;
      return card.scheduledAt !== undefined && moscowDate(card.scheduledAt) === today;
    })
    .slice()
    .sort(compareTodayCards)
    .slice(0, 3);
}

/** Returns current-week role balance, warning only for roles without an accepted Big Rock. */
export function getRoleBalance(cards: KanbanCard[], now: string | Date = new Date()): RoleBalanceView {
  const week = moscowIsoWeek(now);
  const result = {} as RoleBalanceView;
  for (const role of ROLE_IDS) {
    result[role] = { acceptedBigRocks: [], activeActions: [], warning: true };
  }
  if (!week) return result;

  for (const card of cards) {
    if (!card.role || !ROLE_IDS.includes(card.role)) continue;
    const balance = result[card.role];
    if (card.week === week && card.bigRock === true && card.needsReview !== true) balance.acceptedBigRocks.push(card.id);
    if (card.type === 'action' && ACTIVE_COLUMNS.has(card.column)) balance.activeActions.push(card.id);
  }
  for (const role of ROLE_IDS) {
    result[role].warning = result[role].acceptedBigRocks.length === 0;
  }
  return result;
}
