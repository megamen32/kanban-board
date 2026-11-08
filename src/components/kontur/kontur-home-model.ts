import type { KanbanCard } from '@/lib/kanban/types';
import { sameTaskPerson } from '@/lib/kanban/task-membership';

export type HomeBucket = 'answer' | 'now' | 'waiting' | 'ai';
export interface HomeItem { card: KanbanCard; bucket: HomeBucket; reason: string; action: string; }

/** Only explicit tags mark synthetic QA. Titles and project names are not evidence. */
export function isQaCard(card: KanbanCard): boolean {
  return card.tags.some(tag => ['qa', 'synthetic', 'test-fixture'].includes(tag.trim().toLowerCase()));
}

export function homeItems(cards: readonly KanbanCard[], username: string, now = Date.now()): HomeItem[] {
  const result: HomeItem[] = [];
  for (const card of cards) {
    if (isQaCard(card) || ['done', 'archived'].includes(card.column)) continue;
    const owner = sameTaskPerson(card.owner || 'nikita', username);
    const assigned = [card.assignee, ...card.assignees].filter(Boolean) as string[];
    const explicitlyMine = assigned.some(person => sameTaskPerson(person, username));
    const mine = assigned.length ? explicitlyMine : owner;
    const receipt = card.taskExecutionHistory?.at(-1);
    const reviewers = card.requiresApprovalFrom ?? [];
    const myReview = (card.needsReview || card.column === 'review')
      && (reviewers.length ? reviewers.some(person => sameTaskPerson(person, username)) : owner);
    if (card.pendingQuestion && !card.pendingQuestion.answer && owner) {
      result.push({card, bucket: 'answer', reason: card.pendingQuestion.text, action: 'Ответить'});
    } else if (myReview) {
      result.push({card, bucket: 'answer', reason: 'Запрошено решение по результату', action: 'Открыть результат'});
    } else if (['inbox', 'someday'].includes(card.column)) {
      continue;
    } else if ((card.waitingFor ?? []).some(person => !sameTaskPerson(person, username))) {
      result.push({card, bucket: 'waiting', reason: 'Ожидается: ' + card.waitingFor!.join(', '), action: 'Открыть карточку'});
    } else if (!explicitlyMine && (card.executor === 'dot' || receipt && !['stopped', 'result'].includes(receipt.phase))) {
      result.push({card, bucket: 'ai', reason: 'Назначен AI или сохранён незавершённый запуск. Текущая активность не проверена.', action: 'Открыть работу AI'});
    } else if (mine) {
      result.push({card, bucket: 'now', reason: card.blockerReason?.trim() || (card.column === 'blocked' ? 'Задача заблокирована; причина не указана' : 'Задача назначена вам'), action: 'Открыть задачу'});
    } else {
      result.push({card, bucket: 'waiting', reason: assigned.length ? 'Исполнитель: ' + assigned.join(', ') : 'Исполнитель не указан', action: 'Открыть карточку'});
    }
  }
  const rank: Record<string, number> = {critical: 0, high: 1, medium: 2, low: 3};
  const overdue = (card: KanbanCard) => Number.isFinite(Date.parse(card.dueAt ?? '')) && Date.parse(card.dueAt!) < now;
  return result.sort((a, b) => Number(overdue(b.card)) - Number(overdue(a.card))
    || Number(!!b.card.urgent) - Number(!!a.card.urgent)
    || (a.card.todayRank ?? 4) - (b.card.todayRank ?? 4)
    || (rank[a.card.priority] ?? 4) - (rank[b.card.priority] ?? 4)
    || (Date.parse(a.card.dueAt ?? '') || Infinity) - (Date.parse(b.card.dueAt ?? '') || Infinity)
    || a.card.order - b.card.order);
}
