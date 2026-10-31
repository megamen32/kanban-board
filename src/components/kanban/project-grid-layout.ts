import type { GraphDirection, GraphLayoutPreferences, GraphPoint } from '@/lib/kanban/graph-layout-preferences';
import type { KanbanCard } from '@/lib/kanban/types';
import { GRAPH_NODE_HEIGHT as H, GRAPH_NODE_WIDTH as W, type CardGraphBranch, type CardGraphNode } from './card-graph-model';

export const PROJECT_PAD = 28;
const GAP = 32;
const PROJECT_GAP = 64;
const HEADER = H + PROJECT_PAD * 2;
const HORIZONTAL_HEADER = W + PROJECT_PAD * 2;
const ZONE_GAP = 24;
const ZONE_PAD = 16;
const ZONE_HEADER = 32;
const ZONE_LABEL = 96;
/** Display-only status subzones inside one project area; dragging never changes a card's status. */
export const GRAPH_ZONES = [
  { id: 'queue', label: 'Очередь', columns: new Set<KanbanCard['column']>(['inbox', 'todo', 'someday']) },
  { id: 'work', label: 'В работе', columns: new Set<KanbanCard['column']>(['in-progress', 'blocked']) },
  { id: 'review', label: 'На приёмке', columns: new Set<KanbanCard['column']>(['review']) },
] as const;
export type GraphZoneId = (typeof GRAPH_ZONES)[number]['id'];
/** Every active card status belongs to one zone; unknown statuses stay visible in the queue. */
export function graphZoneIdOf(column: KanbanCard['column']): GraphZoneId {
  return (GRAPH_ZONES.find(zone => zone.columns.has(column)) ?? GRAPH_ZONES[0]).id;
}
export interface GraphZone { id: GraphZoneId; label: string; x: number; y: number; width: number; height: number; count: number }
export interface ProjectGraphArea { id: string; project: string; x: number; y: number; width: number; height: number; zones: GraphZone[] }
export interface ProjectGrid { nodes: CardGraphNode[]; areas: ProjectGraphArea[]; width: number; height: number }
export function graphPositionKey(project: string, id: string, grouped = false): string {
  // Existing saved positions remain the default tree view. Grouping gets separate pins.
  return JSON.stringify(grouped ? ['status-groups', project, id] : [project, id]);
}
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

/** Each project owns one vertical area; its tasks are grouped into status subzones. Wide levels wrap into a matrix per zone. */
function layoutGroupedProjectGrid(roots: readonly CardGraphBranch[], expanded: ReadonlySet<string>, preferences: GraphLayoutPreferences): ProjectGrid {
  const nodes: CardGraphNode[] = [];
  const areas: ProjectGraphArea[] = [];
  let offset = PROJECT_PAD;
  for (const root of orderedProjects(roots, preferences.projectOrder)) {
    const rows = levels(root, expanded);
    const entries = rows.flat();
    const positions = preferences.positions[preferences.direction];
    const points = new Map<string, GraphPoint>();
    const occupied: GraphPoint[] = [];
    // Place remembered nodes first, so new tasks never evict manual positions.
    for (const entry of [...entries].sort((a, b) => a.branch.id.localeCompare(b.branch.id))) {
      const remembered = positions[graphPositionKey(root.project, entry.branch.id, true)];
      if (!remembered) continue;
      const placed = freeGraphPoint(remembered, occupied, preferences.direction);
      points.set(entry.branch.id, placed); occupied.push(placed);
    }
    // Status zones keep the saved level order and each get a compact matrix.
    const zones = GRAPH_ZONES.map(zone => ({
      zone,
      rows: rows.map(row => row.filter(entry => graphZoneIdOf(entry.branch.card?.column ?? 'inbox') === zone.id)).filter(row => row.length),
    })).filter(bucket => bucket.rows.length);
    const zoneGrids = zones.map(bucket => {
      const widest = Math.max(0, ...bucket.rows.map(row => row.length));
      const columns = matrixColumns(widest, preferences.columns);
      const spans = bucket.rows.reduce((sum, row) => sum + Math.ceil(row.length / columns), 0);
      const count = bucket.rows.reduce((sum, row) => sum + row.length, 0);
      const laneStep = preferences.direction === 'vertical' ? W : H;
      const laneExtent = columns * (laneStep + GAP) - GAP;
      const lineStep = preferences.direction === 'vertical' ? H : W;
      const lineExtent = spans * (lineStep + GAP) - GAP;
      const major = laneExtent + ZONE_PAD * 2;
      const cross = preferences.direction === 'vertical'
        ? ZONE_HEADER + lineExtent + ZONE_PAD
        : ZONE_LABEL + ZONE_PAD + lineExtent + ZONE_PAD;
      return { ...bucket, zone: bucket.zone, columns, count, major, cross, lines: spans, origin: 0 };
    });
    let cursor = PROJECT_PAD;
    for (const grid of zoneGrids) {
      grid.origin = cursor;
      cursor += grid.major + ZONE_GAP;
    }
    for (const grid of zoneGrids) {
      let startLine = 0;
      for (const row of grid.rows) {
        row.forEach((entry, index) => {
          if (points.has(entry.branch.id)) return;
          const lane = index % grid.columns;
          const line = startLine + Math.floor(index / grid.columns);
          const desired = preferences.direction === 'vertical'
            ? { x: grid.origin + ZONE_PAD + lane * (W + GAP), y: HEADER + ZONE_HEADER + line * (H + GAP) }
            : { x: HORIZONTAL_HEADER + ZONE_LABEL + ZONE_PAD + line * (W + GAP), y: grid.origin + ZONE_PAD + lane * (H + GAP) };
          const placed = freeGraphPoint(desired, occupied, preferences.direction);
          points.set(entry.branch.id, placed); occupied.push(placed);
        });
        startLine += Math.ceil(row.length / grid.columns);
      }
    }
    const zoneRects = zoneGrids.map(grid => ({
      id: grid.zone.id, label: grid.zone.label, count: grid.count,
      x: preferences.direction === 'vertical' ? grid.origin : HORIZONTAL_HEADER,
      y: preferences.direction === 'vertical' ? HEADER : grid.origin,
      width: preferences.direction === 'vertical' ? grid.major : grid.cross,
      height: preferences.direction === 'vertical' ? grid.cross : grid.major,
    }));
    const widthExtent = Math.max(0, ...zoneRects.map(rect => rect.x + rect.width));
    const heightExtent = Math.max(0, ...zoneRects.map(rect => rect.y + rect.height));
    const width = Math.max(W + PROJECT_PAD * 2, widthExtent, ...occupied.map(p => p.x + W + PROJECT_PAD));
    const height = Math.max(H + PROJECT_PAD * 2, heightExtent, ...occupied.map(p => p.y + H + PROJECT_PAD));
    const x = preferences.direction === 'vertical' ? offset : PROJECT_PAD;
    const y = preferences.direction === 'vertical' ? PROJECT_PAD : offset;
    areas.push({ id: root.id, project: root.project, x, y, width, height,
      zones: zoneRects.map(rect => ({ ...rect, x: x + rect.x, y: y + rect.y })) });
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

function layoutUngroupedProjectGrid(roots: readonly CardGraphBranch[], expanded: ReadonlySet<string>, preferences: GraphLayoutPreferences): ProjectGrid {
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
    areas.push({ id: root.id, project: root.project, x, y, width, height, zones: [] });
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

/** Stage grouping is opt-in and never changes task metadata or default pins. */
export function layoutProjectGrid(
  roots: readonly CardGraphBranch[], expanded: ReadonlySet<string>, preferences: GraphLayoutPreferences,
): ProjectGrid {
  return preferences.groupByStatus
    ? layoutGroupedProjectGrid(roots, expanded, preferences)
    : layoutUngroupedProjectGrid(roots, expanded, preferences);
}

/** Snap one drop inside the current project (and stage, when grouped).
 * Dropping onto another task swaps their positions; it never changes status,
 * hierarchy or business cards. A free drop must not inflate the entire project.
 */
export function graphTaskDrop(
  nodes: readonly CardGraphNode[], areas: readonly ProjectGraphArea[],
  draggedId: string, delta: GraphPoint, preferences: GraphLayoutPreferences,
): Record<string, GraphPoint> | null {
  const node = nodes.find(item => item.id === draggedId && item.kind === 'task');
  if (!node) return null;
  const area = areas.find(item => item.project === node.project);
  if (!area) return null;
  const zone = preferences.groupByStatus
    ? area.zones.find(item => item.id === graphZoneIdOf(node.card?.column ?? 'inbox'))
    : undefined;
  if (preferences.groupByStatus && !zone) return null;
  const rect = zone ?? area;
  const minX = preferences.groupByStatus
    ? rect.x + (preferences.direction === 'vertical' ? ZONE_PAD : ZONE_LABEL + ZONE_PAD)
    : area.x + (preferences.direction === 'vertical' ? PROJECT_PAD : HORIZONTAL_HEADER);
  const minY = preferences.groupByStatus
    ? rect.y + (preferences.direction === 'vertical' ? ZONE_HEADER : ZONE_PAD)
    : area.y + (preferences.direction === 'vertical' ? HEADER : PROJECT_PAD);
  const maxX = Math.max(minX, rect.x + rect.width - (zone ? ZONE_PAD : PROJECT_PAD) - W);
  const maxY = Math.max(minY, rect.y + rect.height - (zone ? ZONE_PAD : PROJECT_PAD) - H);
  const dropX = node.x + delta.x;
  const dropY = node.y + delta.y;
  const centerX = dropX + W / 2;
  const centerY = dropY + H / 2;
  // Releasing outside the selected project/stage is not a task reassignment.
  if (centerX < minX - W / 2 || centerX > maxX + W * 1.5
    || centerY < minY - H / 2 || centerY > maxY + H * 1.5) return null;
  // A grid slot, not an arbitrary 8px offset: releasing in a free cell leaves the
  // project bounds stable and gives consistent positions across reloads/devices.
  const snapSlot = (value: number, start: number, end: number, step: number) =>
    start + Math.min(Math.max(0, Math.floor((end - start + 1) / step)),
      Math.max(0, Math.round((value - start) / step))) * step;
  const nextX = snapSlot(dropX, minX, maxX, W + GAP);
  const nextY = snapSlot(dropY, minY, maxY, H + GAP);
  const others = nodes.filter(item => item.kind === 'task' && item.project === node.project && item.id !== draggedId
    && (!preferences.groupByStatus || graphZoneIdOf(item.card?.column ?? 'inbox') === zone?.id));
  // Swap with a card under the pointer or snapped slot; never push an occupied
  // cell beneath every other item or silently move a card into another status.
  const hits = (other: CardGraphNode, x: number, y: number) =>
    x < other.x + W + 8 && x + W + 8 > other.x
      && y < other.y + H + 8 && y + H + 8 > other.y;
  const target = [...others].filter(item => hits(item, dropX, dropY) || hits(item, nextX, nextY))
    .sort((a, b) => (a.x - dropX) ** 2 + (a.y - dropY) ** 2
      - (b.x - dropX) ** 2 - (b.y - dropY) ** 2 || a.id.localeCompare(b.id))[0];
  const key = (item: CardGraphNode) => graphPositionKey(item.project, item.id, preferences.groupByStatus);
  const relative = (point: CardGraphNode | GraphPoint) => ({ x: Math.max(0, Math.round(point.x - area.x)),
    y: Math.max(0, Math.round(point.y - area.y)) });
  if (target) return { [key(node)]: relative(target), [key(target)]: relative(node) };
  if (Math.abs(nextX - node.x) < 4 && Math.abs(nextY - node.y) < 4) return null;
  return { [key(node)]: relative({ x: nextX, y: nextY }) };
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
