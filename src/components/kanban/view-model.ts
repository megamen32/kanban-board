import type { KanbanCard } from '@/lib/kanban/types';

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
