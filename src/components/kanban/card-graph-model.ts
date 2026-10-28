import type { KanbanCard } from '@/lib/kanban/types';
import { groupVisibleCardHierarchy, type VisibleCardHierarchyGroup } from './card-hierarchy';

export interface CardGraphNode {
  card: KanbanCard;
  depth: number;
  row: number;
  parentId?: string;
  childCount: number;
}

/** Uses only the current filtered dataset. The existing hierarchy bounds cycles/depth. */
export function buildCardGraph(cards: readonly KanbanCard[]) {
  const roots = groupVisibleCardHierarchy(cards);
  const branches: string[] = [];
  const stack = [...roots];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.children.length) branches.push(node.card.id);
    for (const child of node.children) stack.push(child);
  }
  return { roots, branches };
}

export function layoutCardGraph(roots: readonly VisibleCardHierarchyGroup[], expanded: ReadonlySet<string>): CardGraphNode[] {
  const nodes: CardGraphNode[] = [];
  const stack = roots.map(node => ({ node, depth: 0, parentId: undefined as string | undefined })).reverse();
  while (stack.length) {
    const { node, depth, parentId } = stack.pop()!;
    nodes.push({ card: node.card, depth, row: nodes.length, parentId, childCount: node.children.length });
    if (expanded.has(node.card.id)) {
      for (let index = node.children.length - 1; index >= 0; index--) {
        stack.push({ node: node.children[index], depth: depth + 1, parentId: node.card.id });
      }
    }
  }
  return nodes;
}

export function toggleGraphBranch(expanded: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(expanded);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}
