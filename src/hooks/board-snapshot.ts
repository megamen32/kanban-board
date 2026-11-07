import type { KanbanCard } from '@/lib/kanban/types';
import type { KanbanProject } from '@/lib/kanban/project-store';

export class BoardReadError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

/** Login HTML and HTTP errors must never masquerade as an empty, current board. */
export async function readBoardSnapshot(response: Response): Promise<{cards: KanbanCard[]; projects: KanbanProject[]}> {
  if (!response.ok) {
    const message = response.status === 401 || response.status === 403
      ? 'Доступ к доске не подтверждён. Войдите в свой аккаунт и обновите данные.'
      : response.status === 429
        ? 'Сервис ограничил частоту запросов (429). Данные пока не обновлены.'
        : 'Не удалось обновить доску. Актуальное состояние неизвестно.';
    throw new BoardReadError(message, response.status);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!body || typeof body !== 'object' || !('cards' in body) || !Array.isArray(body.cards)
    || body.cards.some(card => !card || typeof card.id !== 'string' || !Number.isSafeInteger(card.version))
    || ('projects' in body && !Array.isArray(body.projects))) {
    throw new BoardReadError('Сервер не вернул данные доски. Возможно, требуется повторный вход.', 502);
  }
  return {cards: body.cards as KanbanCard[], projects: ('projects' in body ? body.projects : []) as KanbanProject[]};
}
