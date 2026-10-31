import type { GraphDirection, GraphLayoutPreferences, GraphPoint } from '@/lib/kanban/graph-layout-preferences';
import { GRAPH_NODE_HEIGHT as H, GRAPH_NODE_WIDTH as W, type CardGraphBranch, type CardGraphNode } from './card-graph-model';

export const PROJECT_PAD = 28;
const GAP = 32;
const PROJECT_GAP = 64;
const HEADER = H + PROJECT_PAD * 2;
const HORIZONTAL_HEADER = W + PROJECT_PAD * 2;
export interface ProjectGraphArea { id: string; project: string; x: number; y: number; width: number; height: number }
export interface ProjectGrid { nodes: CardGraphNode[]; areas: ProjectGraphArea[]; width: number; height: number }
export function graphPositionKey(project: string, id: string): string { return JSON.stringify([project, id]); }
export function matrixColumns(count: number, preference = 0): number {
  return Math.max(1, Math.min(count || 1, preference || Math.min(6, Math.ceil(Math.sqrt(count * (H + GAP) / (W + GAP))))));
}
const snap = (value: number) => Math.round(value / 8) * 8;
const overlap = (a: GraphPoint, b: GraphPoint) => a.x < b.x + W + 16 && a.x + W + 16 > b.x && a.y < b.y + H + 16 && a.y + H + 16 > b.y;

/** Bounded deterministic packing, no springs or asynchronous simulation. */
export function freeGraphPoint(desired: GraphPoint, occupied: readonly GraphPoint[], direction: GraphDirection): GraphPoint {
  const point = { x: Math.max(direction === 'horizontal' ? HORIZONTAL_HEADER : PROJECT_PAD, snap(desired.x)),
    y: Math.max(direction === 'vertical' ? HEADER : PROJECT_PAD, snap(desired.y)) };
  for (let pass = 0; pass <= occupied.length; pass++) {
    const collisions = occupied.filter(other => overlap(point, other));
    if (!collisions.length) return point;
    if (direction === 'vertical') point.y = Math.ceil(Math.max(...collisions.map(other => other.y + H + 24)) / 8) * 8;
    else point.x = Math.ceil(Math.max(...collisions.map(other => other.x + W + 24)) / 8) * 8;
  }
  return point;
}

function orderedProjects(roots: readonly CardGraphBranch[], order: readonly string[]): CardGraphBranch[] {
  const ranks = new Map(order.map((id, index) => [id, index]));
  return [...roots].sort((a, b) => (ranks.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (ranks.get(b.id) ?? Number.MAX_SAFE_INTEGER)
    || a.label.localeCompare(b.label, 'ru') || a.id.localeCompare(b.id));
}
interface LevelEntry { branch: CardGraphBranch; parentId: string; depth: number }
function levels(root: CardGraphBranch, expanded: ReadonlySet<string>): LevelEntry[][] {
  if (!expanded.has(root.id)) return [];
  const output: LevelEntry[][] = [];
  let current = root.children.map(branch => ({ branch, parentId: root.id, depth: 1 }));
  while (current.length) {
    output.push(current);
    current = current.flatMap(entry => expanded.has(entry.branch.id)
      ? entry.branch.children.map(branch => ({ branch, parentId: entry.branch.id, depth: entry.depth + 1 })) : []);
  }
  return output;
}

/** Each project owns one vertical area. Wide sibling levels wrap into a matrix. */
export function layoutProjectGrid(roots: readonly CardGraphBranch[], expanded: ReadonlySet<string>, preferences: GraphLayoutPreferences): ProjectGrid {
  const nodes: CardGraphNode[] = [];
  const areas: ProjectGraphArea[] = [];
  let offset = PROJECT_PAD;
  for (const root of orderedProjects(roots, preferences.projectOrder)) {
    const rows = levels(root, expanded);
    const entries = rows.flat();
    const columns = matrixColumns(Math.max(0, ...rows.map(row => row.length)), preferences.columns);
    const positions = preferences.positions[preferences.direction];
    const points = new Map<string, GraphPoint>();
    const occupied: GraphPoint[] = [];
    // Place remembered nodes first, so new tasks never evict manual positions.
    for (const entry of [...entries].sort((a, b) => a.branch.id.localeCompare(b.branch.id))) {
      const remembered = positions[graphPositionKey(root.project, entry.branch.id)];
      if (!remembered) continue;
      const placed = freeGraphPoint(remembered, occupied, preferences.direction);
      points.set(entry.branch.id, placed); occupied.push(placed);
    }
    let startRow = 0;
    for (const row of rows) {
      row.forEach((entry, index) => {
        if (points.has(entry.branch.id)) return;
        const lane = index % columns;
        const rank = startRow + Math.floor(index / columns);
        const desired = preferences.direction === 'vertical'
          ? { x: PROJECT_PAD + lane * (W + GAP), y: HEADER + rank * (H + GAP) }
          : { x: HORIZONTAL_HEADER + rank * (W + GAP), y: PROJECT_PAD + lane * (H + GAP) };
        const placed = freeGraphPoint(desired, occupied, preferences.direction);
        points.set(entry.branch.id, placed); occupied.push(placed);
      });
      startRow += Math.ceil(row.length / columns);
    }
    const width = Math.max(W + PROJECT_PAD * 2, ...occupied.map(p => p.x + W + PROJECT_PAD));
    const height = Math.max(H + PROJECT_PAD * 2, ...occupied.map(p => p.y + H + PROJECT_PAD));
    const x = preferences.direction === 'vertical' ? offset : PROJECT_PAD;
    const y = preferences.direction === 'vertical' ? PROJECT_PAD : offset;
    areas.push({ id: root.id, project: root.project, x, y, width, height });
    const { children, ...projectData } = root;
    nodes.push({ ...projectData, depth: 0, childCount: children.length,
      x: x + (preferences.direction === 'vertical' ? (width - W) / 2 : PROJECT_PAD),
      y: y + (preferences.direction === 'horizontal' ? (height - H) / 2 : PROJECT_PAD) });
    for (const entry of entries) {
      const { children: taskChildren, ...taskData } = entry.branch;
      const point = points.get(entry.branch.id)!;
      nodes.push({ ...taskData, parentId: entry.parentId, depth: entry.depth, childCount: taskChildren.length, x: x + point.x, y: y + point.y });
    }
    offset += (preferences.direction === 'vertical' ? width : height) + PROJECT_GAP;
  }
  return { nodes, areas, width: Math.max(320, ...areas.map(area => area.x + area.width + PROJECT_PAD)),
    height: Math.max(160, ...areas.map(area => area.y + area.height + PROJECT_PAD)) };
}

/** Reorder only the visible projects; hidden project order remains untouched. */
export function draggedProjectOrder(areas: readonly ProjectGraphArea[], savedOrder: readonly string[], id: string, delta: GraphPoint, direction: GraphDirection): string[] {
  const source = areas.find(area => area.id === id);
  if (!source) return [...savedOrder];
  const center = direction === 'vertical' ? source.x + source.width / 2 + delta.x : source.y + source.height / 2 + delta.y;
  const others = areas.filter(area => area.id !== id);
  const index = others.filter(area => (direction === 'vertical' ? area.x + area.width / 2 : area.y + area.height / 2) < center).length;
  const reordered = others.map(area => area.id);
  reordered.splice(index, 0, id);
  const visible = new Set(areas.map(area => area.id));
  const all = [...savedOrder, ...areas.map(area => area.id).filter(value => !savedOrder.includes(value))];
  let cursor = 0;
  return all.map(value => visible.has(value) ? reordered[cursor++] : value);
}
