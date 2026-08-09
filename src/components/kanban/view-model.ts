import type { KanbanCard } from '@/lib/kanban/types';

export function getProjectOptions(cards: KanbanCard[]): string[] {
  const projects = new Set(cards.map(card => card.project.trim()).filter(Boolean));
  return [...projects].sort((a, b) => a.localeCompare(b, 'ru'))
    .concat(cards.some(card => !card.project.trim()) ? ['Без проекта'] : []);
}

export function filterCards(cards: KanbanCard[], project: string): KanbanCard[] {
  if (project === 'all') return cards;
  if (project === 'Без проекта') return cards.filter(card => !card.project.trim());
  return cards.filter(card => card.project === project);
}

export function isSmartNotesInbox(card: KanbanCard): boolean {
  return card.column === 'inbox';
}
