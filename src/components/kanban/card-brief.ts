import type { KanbanCard } from '@/lib/kanban/types';

/** A model-produced, read-only projection bound to the exact card source hash. */
export interface CardBriefProjection {
  cardId: string;
  sourceHash: string;
  summary: string;
  generatedAt?: string;
}

export interface CardBriefFacts {
  action: string;
  executor: string;
  deadline: string;
  nextStep: string;
}

export type CardBriefSource = Pick<KanbanCard, 'id' | 'title' | 'description' | 'assignees' | 'assignee' | 'dueAt' | 'nextAction' | 'column'>;

/** Stable digest for the content and current structured facts used by a brief. */
export async function hashCardBriefSource(card: CardBriefSource): Promise<string> {
  const canonicalSource = JSON.stringify({
    id: card.id,
    title: card.title,
    description: card.description,
    assignees: card.assignees,
    assignee: card.assignee ?? null,
    dueAt: card.dueAt ?? null,
    nextAction: card.nextAction ?? null,
    column: card.column,
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalSource));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function getCardBriefFacts(card: Pick<KanbanCard, 'title' | 'assignees' | 'assignee' | 'dueAt' | 'nextAction'>): CardBriefFacts {
  const assignees = card.assignees.map(value => value.trim()).filter(Boolean);
  const executor = assignees.length ? assignees.join(', ') : card.assignee?.trim() || 'Не назначен';
  const dueDate = card.dueAt ? new Date(card.dueAt) : null;
  const deadline = dueDate && Number.isFinite(dueDate.getTime())
    ? dueDate.toLocaleString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : 'Не указан';
  return {
    action: card.title.trim() || 'Действие не указано',
    executor,
    deadline,
    nextStep: card.nextAction?.trim() || 'Не указан',
  };
}

export function isCurrentCardBrief(cardId: string, sourceHash: string, projection: CardBriefProjection | null | undefined): projection is CardBriefProjection {
  return !!projection
    && projection.cardId === cardId
    && projection.sourceHash === sourceHash
    && projection.summary.trim().length > 0;
}

/** Process-local projection cache. Callers supply the current hash before reads and writes. */
export class CardBriefProjectionCache {
  private static readonly maxEntries = 128;
  private readonly entries = new Map<string, CardBriefProjection>();
  private readonly currentHashes = new Map<string, string>();

  markCurrent(cardId: string, sourceHash: string): void {
    this.currentHashes.delete(cardId);
    this.currentHashes.set(cardId, sourceHash);
    while (this.currentHashes.size > CardBriefProjectionCache.maxEntries) {
      this.currentHashes.delete(this.currentHashes.keys().next().value!);
    }
  }

  get(cardId: string, sourceHash: string): CardBriefProjection | undefined {
    const projection = this.entries.get(cardId);
    if (this.currentHashes.get(cardId) !== sourceHash || !isCurrentCardBrief(cardId, sourceHash, projection)) return undefined;
    this.entries.delete(cardId);
    this.entries.set(cardId, projection);
    return projection;
  }

  setIfCurrent(projection: CardBriefProjection, currentSourceHash: string): boolean {
    if (this.currentHashes.get(projection.cardId) !== currentSourceHash
      || !isCurrentCardBrief(projection.cardId, currentSourceHash, projection)) return false;
    this.entries.delete(projection.cardId);
    this.entries.set(projection.cardId, projection);
    while (this.entries.size > CardBriefProjectionCache.maxEntries) {
      this.entries.delete(this.entries.keys().next().value!);
    }
    return true;
  }

  invalidate(cardId: string): void {
    this.entries.delete(cardId);
    this.currentHashes.delete(cardId);
  }
}

export const CARD_BRIEF_MIN_DESCRIPTION_RUNES = 400;
export const CARD_BRIEF_MAX_SOURCE_RUNES = 16_000;
export const CARD_BRIEF_MAX_SUMMARY_RUNES = 600;

export const cardBriefProjectionCache = new CardBriefProjectionCache();
const pendingCardBriefRequests = new Map<string, Promise<CardBriefProjection | null>>();

export async function requestCardBrief(card: CardBriefSource, sourceHash: string): Promise<CardBriefProjection | null> {
  cardBriefProjectionCache.markCurrent(card.id, sourceHash);
  const cached = cardBriefProjectionCache.get(card.id, sourceHash);
  if (cached) return cached;

  const requestKey = `${card.id}\0${sourceHash}`;
  const pending = pendingCardBriefRequests.get(requestKey);
  if (pending) return pending;

  const request = (async (): Promise<CardBriefProjection | null> => {
    const sourceRunes = Array.from(`${card.title}\n${card.description}\n${card.nextAction ?? ''}`).length;
    if (sourceRunes > CARD_BRIEF_MAX_SOURCE_RUNES) return null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 52_000);
      try {
        const response = await fetch('/internal/card-summary', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ cardId: card.id, sourceHash, title: card.title, description: card.description, nextAction: card.nextAction ?? '' }),
          signal: controller.signal,
        });
        if (!response.ok) return null;
        const result: unknown = await response.json();
        if (!result || typeof result !== 'object') return null;
        const raw = result as Record<string, unknown>;
        if (raw.sourceHash !== sourceHash || typeof raw.summary !== 'string' || !raw.summary.trim()
          || Array.from(raw.summary).length > CARD_BRIEF_MAX_SUMMARY_RUNES) return null;
        const projection: CardBriefProjection = { cardId: card.id, sourceHash, summary: raw.summary.trim() };
        return cardBriefProjectionCache.setIfCurrent(projection, sourceHash) ? projection : null;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return null;
    }
  })();
  pendingCardBriefRequests.set(requestKey, request);
  try {
    return await request;
  } finally {
    if (pendingCardBriefRequests.get(requestKey) === request) pendingCardBriefRequests.delete(requestKey);
  }
}
