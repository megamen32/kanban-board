'use client';

import { Fragment, useMemo, useRef, useState, type ReactNode } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, useDraggable, useSensor, useSensors, type DragEndEvent, type DragMoveEvent } from '@dnd-kit/core';
import { FolderKanban, GripVertical, Pin } from 'lucide-react';
import type { KanbanCard } from '@/lib/kanban/types';
import type { WorkspaceView } from './view-model';
import type { GraphDirection, GraphPoint } from '@/lib/kanban/graph-layout-preferences';
import { buildCardGraph, graphBounds, toggleGraphBranch,
  GRAPH_NODE_WIDTH as WIDTH, GRAPH_NODE_HEIGHT as HEIGHT, type CardGraphNode } from './card-graph-model';
import { draggedProjectOrder, graphTaskDrop, graphPositionKey, layoutProjectGrid, type ProjectGraphArea } from './project-grid-layout';
import { useGraphLayout } from './use-graph-layout';
import { WORKSPACE_HINT } from './view-model';

const STATUS: Record<string, string> = { inbox: 'Входящие', todo: 'К выполнению', 'in-progress': 'В работе',
  review: 'На приёмке', blocked: 'Заблокировано', done: 'Готово', someday: 'Позже', archived: 'Архив' };
/** Exact-status filter beside direction/density; 'all' shows every allowed card. */
const STATUS_FILTERS: readonly (readonly [string, string])[] = [['all', 'Все'], ['inbox', 'Входящие'],
  ['todo', 'К выполнению'], ['in-progress', 'В работе'], ['blocked', 'Заблокировано'],
  ['review', 'На приёмке'], ['someday', 'Бэклог']];
export type StatusFilter = (typeof STATUS_FILTERS)[number][0];
interface NodeActions { expanded: ReadonlySet<string>; onToggle: (id: string) => void; onOpen: (card: KanbanCard) => void }
const nodeClass = (node: CardGraphNode) => node.kind === 'project'
  ? 'absolute flex overflow-hidden rounded-xl border-2 border-sky-500 bg-sky-50 text-sky-950 shadow-sm dark:bg-sky-950 dark:text-sky-50'
  : 'absolute flex overflow-hidden rounded-lg border border-slate-300 bg-card text-card-foreground shadow-sm dark:border-slate-600';

function nodeBody(node: CardGraphNode, actions: NodeActions, handle?: ReactNode, pinned = false) {
  const { expanded, onToggle, onOpen } = actions;
  return <>
    {handle}
    {node.kind === 'project' ? <button type="button" onClick={() => onToggle(node.id)}
      aria-label={'Проект: ' + node.label} aria-expanded={expanded.has(node.id)}
      className={'min-w-0 flex-1 rounded-l-xl py-2 pr-2 text-left hover:bg-sky-100 dark:hover:bg-sky-900 focus-visible:outline-2 focus-visible:outline-ring ' + (handle ? 'pl-9' : 'pl-3')}>
      <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider"><FolderKanban aria-hidden className="h-3.5 w-3.5" />Проект</span>
      <span title={node.label} className="mt-1 line-clamp-2 max-h-11 min-w-0 break-words [overflow-wrap:anywhere] text-sm font-semibold">{node.label}</span>
      <span className="mt-1 block text-[11px] opacity-75">Задач: {node.taskCount}</span>
    </button> : <button type="button" onClick={() => node.card && onOpen(node.card)} title={node.label} aria-label={'Открыть задачу: ' + node.label}
      className={'min-w-0 flex-1 rounded-l-lg py-2 pr-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring ' + (handle ? 'pl-9' : 'pl-3')}>
      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">{pinned && <Pin aria-label="Ручная позиция" className="h-3 w-3" />}{node.card?.type === 'outcome' ? 'Результат' : 'Задача'} · {STATUS[node.card?.column ?? ''] ?? node.card?.column}</span>
      <span className="mt-1 line-clamp-2 max-h-11 min-w-0 break-words [overflow-wrap:anywhere] text-sm font-medium">{node.label}</span>
      <span className="mt-1 block truncate text-[10px] text-muted-foreground">{node.card?.assignees?.join(', ') || node.card?.assignee || node.card?.owner || 'Не назначен'}</span>
    </button>}
    {node.childCount > 0 && <button type="button" aria-expanded={expanded.has(node.id)}
      aria-label={(expanded.has(node.id) ? 'Свернуть' : 'Раскрыть') + ' ' + (node.kind === 'project' ? 'проект' : 'подзадачи') + ': ' + node.label}
      onClick={() => onToggle(node.id)} className="w-10 shrink-0 rounded-r-lg border-l border-current/15 text-sm hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-ring">
      <span aria-hidden="true">{expanded.has(node.id) ? '−' : '+'}</span><span className="block text-xs opacity-70">{node.childCount}</span>
    </button>}
  </>;
}
function DraggableGraphNode({ node, actions, pinned }: { node: CardGraphNode; actions: NodeActions; pinned: boolean }) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, isDragging } = useDraggable({ id: node.id });
  const handle = <button ref={setActivatorNodeRef} type="button" {...attributes} {...listeners}
    aria-label={'Перетащить ' + (node.kind === 'project' ? 'проект: ' : 'задачу: ') + node.label}
    title={node.kind === 'project' ? 'Перетащите, чтобы изменить порядок проектов' : 'Перетащите, чтобы изменить расположение задачи'}
    className="absolute inset-y-0 left-0 flex w-8 touch-none cursor-grab items-center justify-center rounded-l-lg text-muted-foreground hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-ring active:cursor-grabbing">
    <GripVertical aria-hidden className="h-4 w-4" />
  </button>;
  return <div ref={setNodeRef} data-graph-kind={node.kind} data-graph-node={node.id} className={nodeClass(node)}
    style={{ left: node.x, top: node.y, width: WIDTH, height: HEIGHT, zIndex: isDragging ? 20 : 2 }}>
    {nodeBody(node, actions, handle, pinned)}
  </div>;
}

export function CardGraphScene({ nodes, expanded, onToggle, onOpen, direction = 'horizontal', areas = [], draggable = false, positions = {}, grouped = false }: {
  nodes: readonly CardGraphNode[]; expanded: ReadonlySet<string>; onToggle: (id: string) => void; onOpen: (card: KanbanCard) => void;
  direction?: GraphDirection; areas?: readonly ProjectGraphArea[]; draggable?: boolean; positions?: Record<string, GraphPoint>; grouped?: boolean;
}) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const bounds = graphBounds(nodes);
  const width = Math.max(bounds.width, ...areas.map(area => area.x + area.width + 28));
  const height = Math.max(bounds.height, ...areas.map(area => area.y + area.height + 28));
  return <div className="relative" style={{ width, height }}>
    {areas.map(area => <Fragment key={area.id}>
      <div data-project-area={area.project} aria-hidden className="pointer-events-none absolute rounded-2xl border border-sky-500/20 bg-sky-500/[0.035]"
        style={{ left: area.x, top: area.y, width: area.width, height: area.height }} />
      {area.zones?.map(zone => <div key={zone.id} data-graph-zone={zone.id} data-graph-zone-label={zone.label} aria-hidden
        title={`${zone.label}: ${zone.count}`}
        className="pointer-events-none absolute flex items-start rounded-lg border border-sky-500/15 bg-sky-500/[0.04] p-1 text-[10px] font-medium uppercase tracking-wide text-sky-700/70 dark:text-sky-300/70"
        style={{ left: zone.x + 8, top: zone.y + 6, maxWidth: zone.width - 16 }}>{zone.label} · {zone.count}</div>)}
    </Fragment>)}
    <svg aria-hidden="true" width={width} height={height} className="pointer-events-none absolute inset-0">
      <defs><marker id="task-graph-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L8,4 L0,8 Z" fill="context-stroke" /></marker></defs>
      {nodes.map(node => {
        const parent = node.parentId ? byId.get(node.parentId) : undefined;
        if (!parent) return null;
        const x = parent.x + (direction === 'vertical' ? WIDTH / 2 : WIDTH);
        const y = parent.y + (direction === 'vertical' ? HEIGHT : HEIGHT / 2);
        const endX = node.x + (direction === 'vertical' ? WIDTH / 2 : -2);
        const endY = node.y + (direction === 'vertical' ? -2 : HEIGHT / 2);
        const middle = direction === 'vertical' ? (y + endY) / 2 : (x + endX) / 2;
        const path = direction === 'vertical'
          ? 'M ' + x + ' ' + y + ' C ' + x + ' ' + middle + ', ' + endX + ' ' + middle + ', ' + endX + ' ' + endY
          : 'M ' + x + ' ' + y + ' C ' + middle + ' ' + y + ', ' + middle + ' ' + endY + ', ' + endX + ' ' + endY;
        return <path key={node.id} data-graph-edge={parent.kind === 'project' ? 'project-task' : 'parent-task'} data-from={parent.id} data-to={node.id}
          d={path} fill="none" strokeWidth={parent.kind === 'project' ? '1.75' : '2.5'} markerEnd="url(#task-graph-arrow)"
          className={parent.kind === 'project' ? 'stroke-sky-600/70 dark:stroke-sky-400/70' : 'stroke-slate-500 dark:stroke-slate-300'} />;
      })}
    </svg>
    {nodes.map(node => draggable
      ? <DraggableGraphNode key={node.id} node={node} actions={{ expanded, onToggle, onOpen }} pinned={!!positions[graphPositionKey(node.project, node.id, grouped)]} />
      : <div key={node.id} data-graph-kind={node.kind} data-graph-node={node.id} className={nodeClass(node)}
          style={{ left: node.x, top: node.y, width: WIDTH, height: HEIGHT }}>{nodeBody(node, { expanded, onToggle, onOpen })}</div>)}
  </div>;
}

export function CardGraphView({ cards, onOpen, workspaceView, onWorkspaceViewChange }: {
  cards: readonly KanbanCard[];
  onOpen: (card: KanbanCard) => void;
  workspaceView?: WorkspaceView;
  onWorkspaceViewChange?: (value: WorkspaceView) => void;
}) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const filtered = useMemo(() => statusFilter === 'all'
    ? cards
    : cards.filter(card => card.column === statusFilter), [cards, statusFilter]);
  const graph = useMemo(() => buildCardGraph(filtered), [filtered]);
  const preferences = useGraphLayout();
  const [expansion, setExpansion] = useState<ReadonlySet<string> | null>(null);
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<{ id: string; delta: GraphPoint } | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const expanded = useMemo(() => expansion ?? new Set(graph.branches), [expansion, graph.branches]);
  const layout = useMemo(() => layoutProjectGrid(graph.roots, expanded, preferences.layout), [graph.roots, expanded, preferences.layout]);
  const direction = preferences.layout.direction;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const onMove = (event: DragMoveEvent) => setDrag({ id: String(event.active.id), delta: { x: event.delta.x / zoom, y: event.delta.y / zoom } });
  const onEnd = (event: DragEndEvent) => {
    const id = String(event.active.id);
    const node = layout.nodes.find(item => item.id === id);
    const delta = { x: event.delta.x / zoom, y: event.delta.y / zoom };
    setDrag(null);
    if (!node || (Math.abs(delta.x) < 1 && Math.abs(delta.y) < 1)) return;
    if (node.kind === 'project') {
      const next = draggedProjectOrder(layout.areas, preferences.layout.projectOrder, id, delta, direction);
      const before = layout.areas.map(area => area.id);
      const after = next.filter(projectId => before.includes(projectId));
      if (JSON.stringify(after) !== JSON.stringify(before)) preferences.change({ projectOrder: next });
      return;
    }
    const values = graphTaskDrop(layout.nodes, layout.areas, id, delta, preferences.layout);
    if (values) preferences.change({ placement: { direction, values } });
  };
  const draggedNode = drag && layout.nodes.find(node => node.id === drag.id);
  const displayed = drag ? layout.nodes.map(node => node.id === drag.id || (draggedNode?.kind === 'project' && draggedNode.project === node.project)
    ? { ...node, x: Math.max(0, node.x + drag.delta.x), y: Math.max(0, node.y + drag.delta.y) } : node) : layout.nodes;
  const displayedAreas = drag && draggedNode?.kind === 'project' ? layout.areas.map(area => area.id === drag.id
    ? { ...area, x: Math.max(0, area.x + drag.delta.x), y: Math.max(0, area.y + drag.delta.y) } : area) : layout.areas;
  const bounds = graphBounds(displayed);
  const width = Math.max(layout.width, bounds.width);
  const height = Math.max(layout.height, bounds.height);
  const tasks = layout.nodes.filter(node => node.kind === 'task');
  const automatic = () => {
    const values = Object.fromEntries(tasks.map(node => [graphPositionKey(node.project, node.id, preferences.layout.groupByStatus), null]));
    preferences.change({ placement: { direction, values } });
  };
  const button = 'rounded border bg-background px-2 py-2 text-xs hover:bg-muted disabled:opacity-40';
  const savedLabel = { loading: 'Загрузка раскладки…', saved: 'Сохранено на сервере', saving: 'Сохранение…', error: 'Раскладка не сохранена', readonly: 'Войдите, чтобы сохранять расположение' }[preferences.status];
  return <section aria-label="Граф задач" className="flex min-h-0 min-w-0 flex-col p-3 sm:p-5" data-layout-direction={direction}>
    {workspaceView && onWorkspaceViewChange && (
      <div aria-label="Фильтр задач графа" className="mb-2 flex w-fit flex-wrap items-center gap-1 rounded-md border p-1 text-xs">
        <span className="px-2 text-muted-foreground">Задачи:</span>
        {([['mine', 'Моё'], ['shared', 'Общее'], ['all', 'Всё']] as const).map(([value, label]) => (
          <button key={value} type="button" title={WORKSPACE_HINT[value]} aria-label={`${label}: ${WORKSPACE_HINT[value]}`} aria-pressed={workspaceView === value}
            className={'rounded px-3 py-1.5 ' + (workspaceView === value ? 'bg-secondary font-semibold' : 'hover:bg-muted')}
            onClick={() => onWorkspaceViewChange(value)}>{label}</button>
        ))}
      </div>
    )}

    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
      <label className="flex items-center gap-1">Направление
        <select aria-label="Направление графа" className={button} value={direction} disabled={!preferences.editable}
          onChange={event => preferences.change({ direction: event.target.value as GraphDirection })}>
          <option value="vertical">Сверху вниз</option><option value="horizontal">Слева направо</option>
        </select>
      </label>
      <button type="button" className={button + (preferences.layout.groupByStatus ? ' border-sky-500 bg-sky-500/10' : '')}
        aria-pressed={preferences.layout.groupByStatus}
        title="Не меняет задачи или их статусы. Показывает дополнительные области внутри каждого проекта."
        disabled={!preferences.editable}
        onClick={() => preferences.change({ groupByStatus: !preferences.layout.groupByStatus })}>
        {preferences.layout.groupByStatus ? '✓ Группировать по этапам' : 'Группировать по этапам'}
      </button>
      <label className="flex items-center gap-1">Статус
        <select aria-label="Фильтр точного статуса задач" className={button} value={statusFilter}
          title="Показывает задачи одного статуса; скрытые задачи сохраняют свои позиции раскладки"
          onChange={event => setStatusFilter(event.target.value as StatusFilter)}>
          {STATUS_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-1">{direction === 'vertical' ? 'Столбцов' : 'Рядов'}
        <select aria-label="Плотность сетки задач" className={button} value={preferences.layout.columns} disabled={!preferences.editable}
          onChange={event => preferences.change({ columns: Number(event.target.value) })}>
          <option value={0}>Авто</option>{[1, 2, 3, 4, 5, 6].map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <button type="button" className={button} disabled={!preferences.editable} onClick={automatic} title="Вернуть видимые задачи в сетку; скрытые позиции и порядок проектов сохранятся">Разложить автоматически</button>
      <button type="button" className={button} onClick={() => setExpansion(new Set(graph.branches))}>Раскрыть всё</button>
      <button type="button" className={button} onClick={() => setExpansion(new Set())}>Только проекты</button>
      <button type="button" aria-label="Уменьшить граф" className={button} disabled={zoom <= 0.25} onClick={() => setZoom(value => Math.max(0.25, value - 0.15))}>−</button>
      <button type="button" aria-label="Масштаб 100%" className={button} onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
      <button type="button" aria-label="Увеличить граф" className={button} disabled={zoom >= 1.6} onClick={() => setZoom(value => Math.min(1.6, value + 0.15))}>+</button>
      <button type="button" className={button} onClick={() => setZoom(Math.max(0.25, Math.min(1, (viewport.current?.clientWidth ?? width) / width)))}>По ширине</button>
    </div>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>Проектов: {graph.roots.length} · Задач: {tasks.length} из {filtered.length}. Перетаскивание за ⋮⋮: проект меняет порядок; задачи меняются местами или занимают свободную ячейку. Статус и связи не меняются; между этапами задачи переводятся через карточку.</span>
      <span role="status" aria-live="polite" className={preferences.status === 'error' ? 'text-red-600' : ''}>Моя раскладка · {savedLabel}</span>
      {preferences.status === 'error' && <button className={button} onClick={preferences.retry}>Повторить сохранение</button>}
    </div>
    {cards.length === 0 ? <p className="p-6 text-sm text-muted-foreground">По текущим фильтрам задач нет</p>
      : filtered.length === 0 ? <p className="p-6 text-sm text-muted-foreground">Задач выбранного статуса нет</p>
      : <DndContext id="task-project-graph" sensors={sensors} autoScroll onDragMove={onMove} onDragEnd={onEnd} onDragCancel={() => setDrag(null)}
          accessibility={{ screenReaderInstructions: { draggable: 'Нажмите пробел для перемещения, стрелки для изменения позиции, пробел для сохранения или Escape для отмены.' } }}>
        <div ref={viewport} tabIndex={0} aria-label="Область графа с прокруткой" className="max-h-[70dvh] overflow-auto overscroll-contain rounded-xl border bg-muted/15">
          <div style={{ width: width * zoom, height: height * zoom }}>
            <div style={{ width, height, transform: 'scale(' + zoom + ')', transformOrigin: 'top left' }}>
              <CardGraphScene nodes={displayed} areas={displayedAreas} direction={direction} expanded={expanded}
                onToggle={id => setExpansion(toggleGraphBranch(expanded, id))} onOpen={onOpen} draggable={preferences.editable}
                positions={preferences.layout.positions[direction]} grouped={preferences.layout.groupByStatus} />
            </div>
          </div>
        </div>
      </DndContext>}
  </section>;
}
