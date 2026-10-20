import type { KanbanCard } from '@/lib/kanban/types';

export type ExecutionSnapshot = {
  cardId: string;
  state: 'not-started' | 'running' | 'waiting' | 'stopped' | 'unknown';
  lastProgress?: { summary: string; at: string };
  nextAction?: string;
  waitReason?: string;
  sessionUrl?: string;
};

export function executionSignalLabel(state: ExecutionSnapshot['state']): string {
  return {
    'not-started': 'В карточке нет сохранённого запуска',
    running: 'В карточке указан статус «В работе»; активная сессия не подтверждена',
    waiting: 'По карточке ожидается действие',
    stopped: 'Карточка закрыта или архивирована',
    unknown: 'Состояние запуска неизвестно',
  }[state];
}

export function parseExecutionSnapshot(value: unknown, expectedCardId: string): ExecutionSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const states = new Set(['not-started', 'running', 'waiting', 'stopped', 'unknown']);
  if (candidate.cardId !== expectedCardId || typeof candidate.state !== 'string' || !states.has(candidate.state)) return null;
  const last = candidate.lastProgress;
  const lastProgress = last && typeof last === 'object' && !Array.isArray(last)
    && typeof (last as Record<string, unknown>).summary === 'string'
    && typeof (last as Record<string, unknown>).at === 'string'
    ? { summary: (last as Record<string, string>).summary, at: (last as Record<string, string>).at }
    : undefined;
  return {
    cardId: expectedCardId,
    state: candidate.state as ExecutionSnapshot['state'],
    ...(lastProgress ? { lastProgress } : {}),
    ...(typeof candidate.nextAction === 'string' ? { nextAction: candidate.nextAction } : {}),
    ...(typeof candidate.waitReason === 'string' ? { waitReason: candidate.waitReason } : {}),
    ...(typeof candidate.sessionUrl === 'string' ? { sessionUrl: candidate.sessionUrl } : {}),
  };
}

export function getDashboardCounts(cards: KanbanCard[]) {
  return {
    active: cards.filter(card => !['done', 'archived'].includes(card.column)).length,
    review: cards.filter(card => card.column === 'review' && card.needsReview).length,
    blocked: cards.filter(card => card.column === 'blocked').length,
    withResults: cards.filter(card => (card.resultHistory?.length ?? 0) > 0).length,
  };
}

export function getLatestResult(card: KanbanCard) {
  return card.resultHistory?.at(-1);
}

/** Only links to the verified native session host may be shown as session links. */
export function isVerifiedSessionUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'agent.bezrabotnyi.com';
  } catch {
    return false;
  }
}
