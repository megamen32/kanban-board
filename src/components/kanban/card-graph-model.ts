import type { KanbanCard } from '@/lib/kanban/types';
import { groupVisibleCardHierarchy, type VisibleCardHierarchyGroup } from './card-hierarchy';

export const GRAPH_NODE_WIDTH = 248;
export const GRAPH_NODE_HEIGHT = 100;
export const GRAPH_COLUMN = 344;
const GAP = 28;
const PAD = 28;

export interface CardGraphBranch {
  id: string;
  kind: 'project' | 'task';
  label: string;
  project: string;
  card?: KanbanCard;
  children: CardGraphBranch[];
  taskCount: number;
}

export interface CardGraphNode extends Omit<CardGraphBranch, 'children'> {
  depth: number;
  x: number;
  y: number;
  parentId?: string;
  childCount: number;
}

/** Project membership and saved parent relationships, from the filtered input only. */
export function buildCardGraph(cards: readonly KanbanCard[]) {
  const projects = new Map<string, CardGraphBranch>();
  const taskBranch = (group: VisibleCardHierarchyGroup): CardGraphBranch => {
    const children = group.children.map(taskBranch);
    return { id: group.card.id, kind: 'task', label: group.card.title,
      project: group.card.project || '', card: group.card, children,
      taskCount: 1 + children.reduce((sum, child) => sum + child.taskCount, 0) };
  };
  for (const group of groupVisibleCardHierarchy(cards)) {
    const project = group.card.project || '';
    let root = projects.get(project);
    if (!root) {
      root = { id: '@project:' + JSON.stringify(project), kind: 'project',
        label: project || 'Без проекта', project, children: [], taskCount: 0 };
      projects.set(project, root);
    }
    const task = taskBranch(group);
    root.children.push(task);
    root.taskCount += task.taskCount;
  }
  const roots = [...projects.values()].sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  const branches: string[] = [];
  const stack = [...roots];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.children.length) branches.push(node.id);
    stack.push(...node.children);
  }
  return { roots, branches };
}

/** Tidy left-to-right tree: a parent is centered on its child branches, not on a list row. */
export function layoutCardGraph(roots: readonly CardGraphBranch[], expanded: ReadonlySet<string>): CardGraphNode[] {
  const spans = new Map<string, number>();
  const measure = (branch: CardGraphBranch): number => {
    const children = expanded.has(branch.id) ? branch.children : [];
    const height = children.length
      ? Math.max(GRAPH_NODE_HEIGHT, children.reduce((sum, child) => sum + measure(child), 0) + GAP * (children.length - 1))
      : GRAPH_NODE_HEIGHT;
    spans.set(branch.id, height);
    return height;
  };
  roots.forEach(measure);
  const nodes: CardGraphNode[] = [];
  const place = (branch: CardGraphBranch, depth: number, top: number, parentId?: string) => {
    const { children, ...data } = branch;
    const span = spans.get(branch.id)!;
    const y = branch.kind === 'project' ? top : top + (span - GRAPH_NODE_HEIGHT) / 2;
    nodes.push({ ...data, depth, parentId, x: PAD + depth * GRAPH_COLUMN,
      y, childCount: children.length });
    if (!expanded.has(branch.id)) return;
    let childTop = top;
    for (const child of children) {
      place(child, depth + 1, childTop, branch.id);
      childTop += spans.get(child.id)! + GAP;
    }
  };
  let top = PAD;
  for (const root of roots) {
    place(root, 0, top);
    top += spans.get(root.id)! + 64;
  }
  return nodes;
}

export function graphBounds(nodes: readonly CardGraphNode[]) {
  return {
    width: nodes.reduce((max, node) => Math.max(max, node.x + GRAPH_NODE_WIDTH + PAD), 320),
    height: nodes.reduce((max, node) => Math.max(max, node.y + GRAPH_NODE_HEIGHT + PAD), 160),
  };
}

export function toggleGraphBranch(expanded: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(expanded);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}
