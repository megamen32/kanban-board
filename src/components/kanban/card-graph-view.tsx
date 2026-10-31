'use client';

import { useMemo, useRef, useState } from 'react';
import { FolderKanban } from 'lucide-react';
import type { KanbanCard } from '@/lib/kanban/types';
import { buildCardGraph, layoutCardGraph, graphBounds, toggleGraphBranch,
  GRAPH_NODE_WIDTH as WIDTH, GRAPH_NODE_HEIGHT as HEIGHT, type CardGraphNode } from './card-graph-model';

const STATUS: Record<string, string> = { inbox: 'Входящие', todo: 'К выполнению', 'in-progress': 'В работе',
  review: 'На приёмке', blocked: 'Заблокировано', done: 'Готово', someday: 'Позже', archived: 'Архив' };

export function CardGraphScene({ nodes, expanded, onToggle, onOpen }: {
  nodes: readonly CardGraphNode[];
  expanded: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onOpen: (card: KanbanCard) => void;
}) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const { width, height } = graphBounds(nodes);
  return <div className="relative" style={{ width, height }}>
    <svg aria-hidden="true" width={width} height={height} className="pointer-events-none absolute inset-0">
      <defs><marker id="task-graph-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L8,4 L0,8 Z" fill="context-stroke" /></marker></defs>
      {nodes.map(node => {
        const parent = node.parentId ? byId.get(node.parentId) : undefined;
        if (!parent) return null;
        const x = parent.x + WIDTH;
        const y = parent.y + HEIGHT / 2;
        const endY = node.y + HEIGHT / 2;
        const middle = (x + node.x) / 2;
        return <path key={node.id} data-graph-edge={parent.kind === 'project' ? 'project-task' : 'parent-task'}
          data-from={parent.id} data-to={node.id}
          d={'M ' + x + ' ' + y + ' C ' + middle + ' ' + y + ', ' + middle + ' ' + endY + ', ' + (node.x - 2) + ' ' + endY}
          fill="none" strokeWidth="2.5" markerEnd="url(#task-graph-arrow)"
          className={parent.kind === 'project' ? 'stroke-sky-600 dark:stroke-sky-400' : 'stroke-slate-500 dark:stroke-slate-300'} />;
      })}
    </svg>
    {nodes.map(node => <div key={node.id} data-graph-kind={node.kind} data-graph-node={node.id}
      className={node.kind === 'project'
        ? 'absolute flex rounded-xl border-2 border-sky-500 bg-sky-50 text-sky-950 shadow-sm dark:bg-sky-950 dark:text-sky-50'
        : 'absolute flex rounded-lg border border-slate-300 bg-card text-card-foreground shadow-sm dark:border-slate-600'}
      style={{ left: node.x, top: node.y, width: WIDTH, height: HEIGHT }}>
      {node.kind === 'project' ? <button type="button" onClick={() => onToggle(node.id)}
        aria-label={'Проект: ' + node.label} aria-expanded={expanded.has(node.id)}
        className="min-w-0 flex-1 rounded-l-xl px-3 py-2 text-left hover:bg-sky-100 dark:hover:bg-sky-900 focus-visible:outline-2 focus-visible:outline-ring">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider"><FolderKanban aria-hidden className="h-3.5 w-3.5" />Проект</span>
        <span title={node.label} className="mt-1 block line-clamp-2 break-words text-sm font-semibold">{node.label}</span>
        <span className="mt-1 block text-[11px] opacity-75">Задач: {node.taskCount}</span>
      </button> : <button type="button" onClick={() => node.card && onOpen(node.card)}
        title={node.label} aria-label={'Открыть задачу: ' + node.label}
        className="min-w-0 flex-1 rounded-l-lg px-3 py-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
        <span className="block truncate text-[10px] text-muted-foreground">{node.card?.type === 'outcome' ? 'Результат' : 'Задача'} · {STATUS[node.card?.column ?? ''] ?? node.card?.column}</span>
        <span className="mt-1 block line-clamp-2 break-words text-sm font-medium">{node.label}</span>
        <span className="mt-1 block truncate text-[10px] text-muted-foreground">{node.card?.assignees?.join(', ') || node.card?.assignee || node.card?.owner || 'Не назначен'}</span>
      </button>}
      {node.childCount > 0 && <button type="button" aria-expanded={expanded.has(node.id)}
        aria-label={(expanded.has(node.id) ? 'Свернуть' : 'Раскрыть') + ' ' + (node.kind === 'project' ? 'проект' : 'подзадачи') + ': ' + node.label}
        onClick={() => onToggle(node.id)} className="w-10 shrink-0 rounded-r-lg border-l border-current/15 text-sm hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-ring">
        <span aria-hidden="true">{expanded.has(node.id) ? '−' : '+'}</span><span className="block text-xs opacity-70">{node.childCount}</span>
      </button>}
    </div>)}
  </div>;
}

export function CardGraphView({ cards, onOpen }: { cards: readonly KanbanCard[]; onOpen: (card: KanbanCard) => void }) {
  const graph = useMemo(() => buildCardGraph(cards), [cards]);
  const [expansion, setExpansion] = useState<ReadonlySet<string> | null>(null);
  const [zoom, setZoom] = useState(1);
  const viewport = useRef<HTMLDivElement>(null);
  const expanded = expansion ?? new Set(graph.branches);
  const nodes = layoutCardGraph(graph.roots, expanded);
  const { width, height } = graphBounds(nodes);
  const taskCount = nodes.filter(node => node.kind === 'task').length;
  return <section aria-label="Граф задач" className="flex min-h-0 min-w-0 flex-col p-3 sm:p-5">
    <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
      <button type="button" className="rounded border px-2 py-2 hover:bg-muted" onClick={() => setExpansion(new Set(graph.branches))}>Раскрыть всё</button>
      <button type="button" className="rounded border px-2 py-2 hover:bg-muted" onClick={() => setExpansion(new Set())}>Только проекты</button>
      <button type="button" aria-label="Уменьшить граф" disabled={zoom <= 0.4} className="rounded border px-3 py-2 disabled:opacity-40" onClick={() => setZoom(value => Math.max(0.4, value - 0.2))}>−</button>
      <button type="button" aria-label="Масштаб 100%" className="rounded border px-2 py-2" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
      <button type="button" aria-label="Увеличить граф" disabled={zoom >= 1.6} className="rounded border px-3 py-2 disabled:opacity-40" onClick={() => setZoom(value => Math.min(1.6, value + 0.2))}>+</button>
      <button type="button" className="rounded border px-2 py-2 hover:bg-muted" onClick={() => setZoom(Math.max(0.4, Math.min(1, (viewport.current?.clientWidth ?? width) / width)))}>По ширине</button>
      <span role="status" className="text-muted-foreground">Проектов: {graph.roots.length} · Задач: {taskCount} из {cards.length}</span>
    </div>
    <p className="mb-3 text-xs text-muted-foreground"><span className="font-medium text-sky-700 dark:text-sky-300">Проект</span> → задача → подзадача. Линии показывают проект и родительскую задачу; нажатие открывает карточку.</p>
    {cards.length === 0 ? <p className="p-6 text-sm text-muted-foreground">По текущим фильтрам задач нет</p> : <div ref={viewport} tabIndex={0} aria-label="Область графа с прокруткой" className="max-h-[72dvh] overflow-auto overscroll-contain rounded-xl border bg-muted/15">
      <div style={{ width: width * zoom, height: height * zoom }}>
        <div style={{ width, height, transform: 'scale(' + zoom + ')', transformOrigin: 'top left' }}>
          <CardGraphScene nodes={nodes} expanded={expanded} onToggle={id => setExpansion(toggleGraphBranch(expanded, id))} onOpen={onOpen} />
        </div>
      </div>
    </div>}
  </section>;
}
