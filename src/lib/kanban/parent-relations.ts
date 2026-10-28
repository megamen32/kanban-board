import type { KanbanCard } from './types';

type ParentCard = Pick<KanbanCard, 'id' | 'parent' | 'project' | 'owner'>;

/** Validate one parent edge against the caller's already-scoped card snapshot. */
export function validateParentRelation(
  cardId: string,
  parentId: string | null | undefined,
  childProject: string,
  childOwner: string | undefined,
  cards: readonly ParentCard[],
): void {
  if (parentId === undefined || parentId === null) return;
  if (parentId === cardId) throw new Error('parent_relation_self');

  const byId = new Map(cards.map(card => [card.id, card]));
  const parent = byId.get(parentId);
  if (!parent) throw new Error('parent_relation_missing');
  if (parent.project.trim() !== childProject.trim() || (parent.owner ?? 'nikita') !== (childOwner ?? 'nikita')) {
    throw new Error('parent_relation_scope_mismatch');
  }

  const visited = new Set([cardId]);
  let current: ParentCard | undefined = parent;
  while (current) {
    if (visited.has(current.id)) throw new Error('parent_relation_cycle');
    visited.add(current.id);
    if (!current.parent) break;
    current = byId.get(current.parent);
    if (!current) throw new Error('parent_relation_missing');
  }
}

/** Validate all parent edges touching a card that is about to be changed. */
export function validateCardParentRelations(card: ParentCard, cards: readonly ParentCard[]): void {
  const proposedCards = [...cards.filter(item => item.id !== card.id), card];
  validateParentRelation(card.id, card.parent, card.project, card.owner, proposedCards);
  for (const child of proposedCards) {
    if (child.parent === card.id) {
      validateParentRelation(child.id, card.id, child.project, child.owner, proposedCards);
    }
  }
}
