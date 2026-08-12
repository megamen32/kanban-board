import type { KanbanCard } from './types';
import { moscowIsoWeek } from './planning-views';

const TERMINAL_COLUMNS = new Set(['done', 'archived']);

export interface WeeklyDraft {
  week: string;
  cardIds: string[];
  cards: KanbanCard[];
}

export interface AtomicWrite<T> {
  write: () => T;
  rollback: () => void;
}

/**
 * Execute writes as one logical transaction and compensate completed writes
 * when a later write fails.
 *
 * @param writes Ordered writes with an inverse operation for each write.
 * @returns Results from every completed write in input order.
 * @throws The original write error, or a rollback error when compensation fails.
 */
export function runAtomicWrites<T>(writes: readonly AtomicWrite<T>[]): T[] {
  const completed: AtomicWrite<T>[] = [];
  const results: T[] = [];

  try {
    for (const operation of writes) {
      results.push(operation.write());
      completed.push(operation);
    }
    return results;
  } catch (error) {
    let rollbackError: unknown;
    for (const operation of completed.reverse()) {
      try {
        operation.rollback();
      } catch (candidate) {
        rollbackError ??= candidate;
      }
    }
    if (rollbackError) throw rollbackError;
    throw error;
  }
}

/** Build a write-free, deterministic proposal of up to six active cards. */
export function buildWeeklyDraft(cards: KanbanCard[], now: string | Date): WeeklyDraft {
  const week = moscowIsoWeek(now);
  if (!week) throw new Error('now must be a valid timestamp');
  const proposed = cards
    .filter(card => !TERMINAL_COLUMNS.has(card.column))
    .slice()
    .sort((left, right) => {
      const importance = Number(right.important === true) - Number(left.important === true);
      if (importance !== 0) return importance;
      const urgency = Number(right.urgent === true) - Number(left.urgent === true);
      if (urgency !== 0) return urgency;
      if (left.order !== right.order) return left.order - right.order;
      return left.id.localeCompare(right.id);
    })
    .slice(0, 6);
  return { week, cardIds: proposed.map(card => card.id), cards: proposed };
}
