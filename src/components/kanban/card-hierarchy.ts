import type { KanbanCard } from '@/lib/kanban/types';

export type CardHierarchyNode = Pick<KanbanCard, 'id' | 'title' | 'parent' | 'project' | 'owner'>;

export interface VisibleCardHierarchyGroup {
  card: KanbanCard;
  children: VisibleCardHierarchyGroup[];
}

function sameScope(left: CardHierarchyNode, right: CardHierarchyNode): boolean {
  return left.project === right.project && (left.owner ?? null) === (right.owner ?? null);
}

/** Returns visible ancestors from the root down, bounded and cycle-safe. */
export function getCardAncestorChain(card: CardHierarchyNode, cards: readonly CardHierarchyNode[], maxDepth = 20): CardHierarchyNode[] {
  const byId = new Map(cards.map(item => [item.id, item]));
  const visited = new Set([card.id]);
  const chain: CardHierarchyNode[] = [];
  let parentId = card.parent;
  while (parentId && chain.length < maxDepth && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (!parent || !sameScope(card, parent)) break;
    chain.push(parent);
    parentId = parent.parent;
  }
  return chain.reverse();
}

export function getVisibleCardChildren(card: CardHierarchyNode, cards: readonly CardHierarchyNode[]): CardHierarchyNode[] {
  return cards.filter(item => item.id !== card.id && item.parent === card.id && sameScope(card, item))
    .sort((left, right) => left.title.localeCompare(right.title, 'ru'));
}

/** Parent choices must stay in the same visible project/owner scope and exclude descendants. */
export function getEligibleParentCards(card: CardHierarchyNode, cards: readonly CardHierarchyNode[]): CardHierarchyNode[] {
  const descendants = new Set<string>();
  const queue = [card.id];
  while (queue.length) {
    const current = queue.shift()!;
    for (const child of cards) {
      if (child.parent === current && sameScope(card, child) && !descendants.has(child.id)) {
        descendants.add(child.id);
        queue.push(child.id);
      }
    }
  }
  return cards.filter(item => item.id !== card.id && !descendants.has(item.id) && sameScope(card, item))
    .sort((left, right) => left.title.localeCompare(right.title, 'ru'));
}

/** Group only cards in the already-filtered input; missing/filtered parents never hide a child. */
export function groupVisibleCardHierarchy(cards: readonly KanbanCard[], maxDepth = 24): VisibleCardHierarchyGroup[] {
  const byId = new Map(cards.map(card => [card.id, card]));
  const childrenByParent = new Map<string, KanbanCard[]>();
  const visibleParent = (card: KanbanCard): string | undefined => {
    if (!card.parent || card.parent === card.id) return undefined;
    const parent = byId.get(card.parent);
    return parent && sameScope(card, parent) ? parent.id : undefined;
  };
  for (const card of cards) {
    const parentId = visibleParent(card);
    if (!parentId) continue;
    const children = childrenByParent.get(parentId) ?? [];
    children.push(card);
    childrenByParent.set(parentId, children);
  }

  const visited = new Set<string>();
  const build = (card: KanbanCard, depth: number): VisibleCardHierarchyGroup => {
    visited.add(card.id);
    const children = depth >= maxDepth ? [] : (childrenByParent.get(card.id) ?? [])
      .filter(child => !visited.has(child.id))
      .map(child => build(child, depth + 1));
    return { card, children };
  };
  const roots = cards.filter(card => !visibleParent(card)).map(card => build(card, 0));
  // Malformed cycles and excessive-depth tails are emitted as visible roots instead of being lost.
  for (const card of cards) if (!visited.has(card.id)) roots.push(build(card, 0));
  return roots;
}
