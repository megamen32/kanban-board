import { describe, expect, it } from 'vitest';
import type { KanbanCard } from '../../lib/kanban/types';
import { defaultGraphLayout } from '../../lib/kanban/graph-layout-preferences';
import { buildCardGraph } from './card-graph-model';
import { draggedProjectOrder, freeGraphPoint, graphPositionKey, graphTaskDrop, GRAPH_ZONES, graphZoneIdOf, layoutProjectGrid } from './project-grid-layout';
const card = (id: string, project = 'Альфа', parent?: string): KanbanCard => ({ id, title: id, project, parent, owner: 'qa', description: '', column: 'todo', priority: 'medium', order: 0, tags: [], assignees: [], created: '', updated: '', version: 1, fileName: id + '.md' });
function graph(cards: KanbanCard[], prefs = defaultGraphLayout()) { const g = buildCardGraph(cards); return layoutProjectGrid(g.roots, new Set(g.branches), prefs); }
function groupedGraph(cards: KanbanCard[], prefs = defaultGraphLayout()) {
  return graph(cards, { ...prefs, groupByStatus: true });
}

describe('status subzones inside one project area', () => {
  it('maps every active status to exactly one zone and keeps unknown statuses visible', () => {
    const zone = (column: KanbanCard['column']) => graphZoneIdOf(column);
    expect(zone('inbox')).toBe('queue');
    expect(zone('todo')).toBe('queue');
    expect(zone('someday')).toBe('queue');
    expect(zone('in-progress')).toBe('work');
    expect(zone('blocked')).toBe('work');
    expect(zone('review')).toBe('review');
    expect(zone('done')).toBe('queue');
    expect(zone('archived')).toBe('queue');
    for (const zoneSpec of GRAPH_ZONES) expect(zoneSpec.label).toBeTruthy();
  });

  it('renders one subzone per used status group with labels, counts and no overlaps', () => {
    const input = [card('q1'), card('q2'), card('q3'), card('w1', 'Альфа'), card('b1', 'Альфа'), card('r1', 'Альфа')];
    input[2].column = 'someday';
    input[3].column = 'in-progress';
    input[4].column = 'blocked';
    input[5].column = 'review';
    const layout = groupedGraph(input);
    const area = layout.areas.find(item => item.project === 'Альфа')!;
    expect(area.zones.map(zone => zone.id)).toEqual(['queue', 'work', 'review']);
    const byId = (id: string) => area.zones.find(zone => zone.id === id)!;
    expect(byId('queue').count).toBe(3);
    expect(byId('work').count).toBe(2);
    expect(byId('review').count).toBe(1);
    for (const zone of area.zones) {
      expect(zone.x >= area.x && zone.x + zone.width <= area.x + area.width).toBe(true);
      expect(zone.y >= area.y && zone.y + zone.height <= area.y + area.height).toBe(true);
    }
    expect(byId('work').x).toBeGreaterThan(byId('queue').x + byId('queue').width);
    expect(byId('review').x).toBeGreaterThan(byId('work').x + byId('work').width);
    const nodes = layout.nodes.filter(node => node.kind === 'task');
    for (const node of nodes) {
      const zone = area.zones.find(item => item.x <= node.x && node.x + 248 <= item.x + item.width
        && item.y <= node.y && node.y + 100 <= item.y + item.height);
      expect(zone, node.id + ' inside its zone').toBeDefined();
    }
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      expect(a.x + 248 <= b.x || b.x + 248 <= a.x || a.y + 100 <= b.y || b.y + 100 <= a.y).toBe(true);
    }
    expect(groupedGraph(input)).toEqual(layout);
  });

  it('switching layout direction keeps zones stacked along the flow without overlaps', () => {
    const input = [card('q', 'Альфа'), card('w', 'Альфа'), card('r', 'Альфа')];
    input[1].column = 'in-progress';
    input[2].column = 'review';
    const horizontal = groupedGraph(input, { ...defaultGraphLayout(), direction: 'horizontal' });
    const area = horizontal.areas[0];
    const [queue, work, review] = area.zones;
    expect(work.y).toBeGreaterThan(queue.y + queue.height);
    expect(review.y).toBeGreaterThan(work.y + work.height);
    const nodes = horizontal.nodes.filter(node => node.kind === 'task');
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      expect(a.x + 248 <= b.x || b.x + 248 <= a.x || a.y + 100 <= b.y || b.y + 100 <= a.y).toBe(true);
    }
  });

  it('keeps remembered manual positions exact and never places others onto them', () => {
    const prefs = defaultGraphLayout();
    const input = [card('q', 'Альфа'), card('w', 'Альфа')];
    input[1].column = 'in-progress';
    const baseline = groupedGraph(input);
    const origin = baseline.areas[0];
    const originalWork = baseline.nodes.find(node => node.id === 'w')!;
    const remembered = { x: originalWork.x - origin.x, y: originalWork.y - origin.y };
    prefs.positions.vertical[graphPositionKey('Альфа', 'w', true)] = remembered;
    const layout = groupedGraph(input, prefs);
    const w = layout.nodes.find(node => node.id === 'w')!,
      q = layout.nodes.find(node => node.id === 'q')!;
    expect(w.x - layout.areas[0].x).toBe(remembered.x);
    expect(w.y - layout.areas[0].y).toBe(remembered.y);
    expect(q.x + 248 <= w.x || w.x + 248 <= q.x || q.y + 100 <= w.y || w.y + 100 <= q.y).toBe(true);
  });
});

describe('opt-in stages and drag placement', () => {
  it('keeps the original linked project matrix by default, grouping only when requested', () => {
    const input = [card('q'), card('w'), card('r')];
    input[1].column = 'in-progress';
    input[2].column = 'review';
    const automatic = graph(input);
    const grouped = groupedGraph(input);
    expect(defaultGraphLayout().groupByStatus).toBe(false);
    expect(automatic.areas[0].zones).toEqual([]);
    expect(grouped.areas[0].zones.map(zone => zone.id)).toEqual(['queue', 'work', 'review']);
    expect(automatic.nodes.find(node => node.id === 'q')?.parentId).toBe(grouped.nodes.find(node => node.id === 'q')?.parentId);
    expect(graph(input)).toEqual(automatic);
  });

  it('swaps a task onto an occupied card without pushing anything outside its area', () => {
    const input = [card('a'), card('b'), card('c')];
    const before = graph(input);
    const a = before.nodes.find(node => node.id === 'a')!;
    const b = before.nodes.find(node => node.id === 'b')!;
    const delta = { x: b.x - a.x, y: b.y - a.y };
    const prefs = defaultGraphLayout();
    const patch = graphTaskDrop(before.nodes, before.areas, a.id, delta, prefs);
    expect(patch).not.toBeNull();
    expect(Object.keys(patch!)).toHaveLength(2);
    prefs.positions.vertical = { ...patch! };
    const after = graph(input, prefs);
    const moved = after.nodes.find(node => node.id === 'a')!;
    const swapped = after.nodes.find(node => node.id === 'b')!;
    expect({ x: moved.x, y: moved.y }).toEqual({ x: b.x, y: b.y });
    expect({ x: swapped.x, y: swapped.y }).toEqual({ x: a.x, y: a.y });
    expect(after.areas[0].width).toBe(before.areas[0].width);
    expect(after.areas[0].height).toBe(before.areas[0].height);
    expect(moved.parentId).toBe(a.parentId);
    expect(graphTaskDrop(before.nodes, before.areas, a.id, { x: 4000, y: 0 }, prefs)).toBeNull();
  });

  it('snaps a free drop to an empty matrix cell without enlarging the project', () => {
    const input = [card('a'), card('b'), card('c')];
    const before = graph(input);
    const area = before.areas[0];
    const a = before.nodes.find(node => node.id === 'a')!;
    const b = before.nodes.find(node => node.id === 'b')!;
    const c = before.nodes.find(node => node.id === 'c')!;
    const empty = { x: b.x, y: c.y };
    const patch = graphTaskDrop(before.nodes, before.areas, a.id,
      { x: empty.x - a.x, y: empty.y - a.y }, defaultGraphLayout())!;
    expect(Object.keys(patch)).toEqual([graphPositionKey('Альфа', 'a')]);
    const prefs = defaultGraphLayout();
    prefs.positions.vertical = patch;
    const after = graph(input, prefs);
    expect({ x: after.nodes.find(node => node.id === 'a')!.x,
      y: after.nodes.find(node => node.id === 'a')!.y }).toEqual(empty);
    expect(after.areas[0].width).toBe(area.width);
    expect(after.areas[0].height).toBe(area.height);
  });

  it('isolates grouped positions and refuses a drop into a different stage', () => {
    const input = [card('q1'), card('q2'), card('work')];
    input[2].column = 'in-progress';
    const prefs = { ...defaultGraphLayout(), groupByStatus: true };
    const grouped = graph(input, prefs);
    const queue = grouped.nodes.find(node => node.id === 'q1')!;
    const otherQueue = grouped.nodes.find(node => node.id === 'q2')!;
    const work = grouped.nodes.find(node => node.id === 'work')!;
    const swap = graphTaskDrop(grouped.nodes, grouped.areas, queue.id,
      { x: otherQueue.x - queue.x, y: otherQueue.y - queue.y }, prefs)!;
    expect(Object.keys(swap)).toEqual(expect.arrayContaining([
      graphPositionKey('Альфа', queue.id, true), graphPositionKey('Альфа', otherQueue.id, true),
    ]));
    expect(graphTaskDrop(grouped.nodes, grouped.areas, queue.id,
      { x: work.x - queue.x, y: work.y - queue.y }, prefs)).toBeNull();
    prefs.positions.vertical = { ...swap };
    expect(graph(input, prefs).nodes.find(node => node.id === 'q1')?.x).toBe(otherQueue.x);
    const plain = graph(input, { ...prefs, groupByStatus: false });
    expect(plain.areas[0].zones).toEqual([]);
  });
});

describe('deterministic per-project matrix', () => {
  it('puts projects side by side and wraps 100 tasks into six columns, not a 100-item line', () => {
    const input = [...Array.from({ length: 100 }, (_, i) => card('a' + i)), card('b', 'Бета')];
    const layout = graph(input);
    const alpha = layout.areas.find(area => area.project === 'Альфа')!;
    const beta = layout.areas.find(area => area.project === 'Бета')!;
    expect(beta.x).toBeGreaterThan(alpha.x + alpha.width);
    expect(beta.y).toBe(alpha.y);
    const nodes = layout.nodes.filter(node => node.kind === 'task' && node.project === 'Альфа');
    expect(new Set(nodes.map(node => node.x)).size).toBe(6);
    expect(new Set(nodes.map(node => node.y)).size).toBe(17);
    expect(nodes.every(node => node.x >= alpha.x && node.x + 248 <= alpha.x + alpha.width && node.y + 100 <= alpha.y + alpha.height)).toBe(true);
    expect(graph(input)).toEqual(layout);
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      expect(a.x + 248 <= b.x || b.x + 248 <= a.x || a.y + 100 <= b.y || b.y + 100 <= a.y).toBe(true);
    }
  });
  it('rotates the flow without overlapping the project header and keeps ancestors above children', () => {
    const input = [card('a'), card('child', 'Альфа', 'a'), card('b', 'Бета')];
    const vertical = graph(input);
    expect(vertical.nodes.find(node => node.id === 'child')!.y).toBeGreaterThan(vertical.nodes.find(node => node.id === 'a')!.y + 100);
    const horizontal = graph(input, { ...defaultGraphLayout(), direction: 'horizontal' });
    expect(horizontal.areas[1].y).toBeGreaterThan(horizontal.areas[0].y + horizontal.areas[0].height);
    const task = horizontal.nodes.find(node => node.id === 'a')!;
    const project = horizontal.nodes.find(node => node.id === task.parentId)!;
    expect(task.x).toBeGreaterThanOrEqual(project.x + 248);
  });
  it('keeps pinned positions, places other tasks around them and separates orientation preferences', () => {
    const prefs = defaultGraphLayout();
    prefs.positions.vertical[graphPositionKey('Альфа', 'a')] = { x: 32, y: 160 };
    const input = [card('a'), card('b')];
    const layout = graph(input, prefs);
    const a = layout.nodes.find(node => node.id === 'a')!, b = layout.nodes.find(node => node.id === 'b')!;
    expect(a.x - layout.areas[0].x).toBe(32);
    expect(a.y - layout.areas[0].y).toBe(160);
    expect(a.y + 100 <= b.y || a.x + 248 <= b.x).toBe(true);
    expect(freeGraphPoint({ x: 32, y: 160 }, [{ x: 32, y: 160 }], 'vertical').y).toBeGreaterThan(260);
    expect(prefs.positions.horizontal).toEqual({});
  });
  it('reorders visible projects without losing an existing hidden project', () => {
    const layout = graph([card('a'), card('b', 'Бета'), card('c', 'Гамма')]);
    const [a, b, c] = layout.areas.map(area => area.id);
    const hidden = '@project:"Скрытый"';
    const order = draggedProjectOrder(layout.areas, [a, hidden, b, c], a, { x: 9999, y: 0 }, 'vertical');
    expect(order).toEqual([b, hidden, c, a]);
    expect(graph([card('a'), card('b', 'Бета'), card('c', 'Гамма')], { ...defaultGraphLayout(), projectOrder: order }).areas.map(area => area.id)).toEqual([b, c, a]);
  });
});
