'use client';

import { useMemo, useState } from 'react';
import type { KanbanCard } from '@/lib/kanban/types';
import { buildCardGraph, layoutCardGraph, toggleGraphBranch, type CardGraphNode } from './card-graph-model';

const COLUMN = 288;
const ROW = 108;
const WIDTH = 240;
const HEIGHT = 88;

export function CardGraphScene({ nodes, expanded, onToggle, onOpen }: {
  nodes: readonly CardGraphNode[];
  expanded: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onOpen: (card: KanbanCard) => void;
}) {
  const byId = new Map(nodes.map(node => [node.card.id, node]));
  const width = nodes.reduce((max, node) => Math.max(max, node.depth * COLUMN + WIDTH + 32), 280);
  return <div className="relative" style={{ width, height: Math.max(120, nodes.length * ROW + 24) }}>
    <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full">
      {nodes.map(node => {
        const parent = node.parentId ? byId.get(node.parentId) : undefined;
        if (!parent) return null;
        const x = parent.depth * COLUMN + WIDTH + 16;
        const y = parent.row * ROW + HEIGHT / 2 + 12;
        const endX = node.depth * COLUMN + 16;
        const endY = node.row * ROW + HEIGHT / 2 + 12;
        return <path key={node.card.id} d={`M${x},${y} H${x + 24} V${endY} H${endX}`} fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground/50" />;
      })}
    </svg>
    {nodes.map(node => <div key={node.card.id} className="absolute flex rounded-lg border bg-card text-card-foreground shadow-sm" style={{ left: node.depth * COLUMN + 16, top: node.row * ROW + 12, width: WIDTH, height: HEIGHT }}>
      <button type="button" onClick={() => onOpen(node.card)} title={node.card.title} aria-label={`Открыть задачу: ${node.card.title}`} className="min-w-0 flex-1 rounded-l-lg px-3 py-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
        <span className="block truncate text-[10px] text-muted-foreground">{node.card.type === 'outcome' ? 'Результат' : 'Действие'} · {node.card.project}</span>
        <span className="mt-1 line-clamp-2 break-words text-sm font-medium">{node.card.title}</span>
      </button>
      {node.childCount > 0 && <button type="button" aria-expanded={expanded.has(node.card.id)} aria-label={`${expanded.has(node.card.id) ? 'Свернуть' : 'Раскрыть'} подзадачи: ${node.card.title}`} onClick={() => onToggle(node.card.id)} className="w-11 shrink-0 rounded-r-lg border-l text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
        <span aria-hidden="true">{expanded.has(node.card.id) ? '−' : '+'}</span><span className="block text-xs text-muted-foreground">{node.childCount}</span>
      </button>}
    </div>)}
  </div>;
}

export function CardGraphView({ cards, onOpen }: { cards: readonly KanbanCard[]; onOpen: (card: KanbanCard) => void }) {
  const graph = useMemo(() => buildCardGraph(cards), [cards]);
  const [expansion, setExpansion] = useState<ReadonlySet<string> | null>(null);
  const [zoom, setZoom] = useState(1);
  const expanded = expansion ?? new Set(graph.roots.map(node => node.card.id));
  const nodes = layoutCardGraph(graph.roots, expanded);
  const width = nodes.reduce((max, node) => Math.max(max, node.depth * COLUMN + WIDTH + 32), 280);
  const height = Math.max(120, nodes.length * ROW + 24);
  return <section aria-label="Граф задач" className="flex min-h-0 min-w-0 flex-col p-3 sm:p-6">
    <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
      <button type="button" className="rounded border px-2 py-2 hover:bg-muted" onClick={() => setExpansion(new Set(graph.branches))}>Раскрыть всё</button>
      <button type="button" className="rounded border px-2 py-2 hover:bg-muted" onClick={() => setExpansion(new Set())}>Свернуть всё</button>
      <button type="button" aria-label="Уменьшить граф" disabled={zoom <= 0.5} className="rounded border px-3 py-2 disabled:opacity-40" onClick={() => setZoom(value => Math.max(0.5, value - 0.25))}>−</button>
      <button type="button" aria-label="Масштаб 100%" className="rounded border px-2 py-2" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
      <button type="button" aria-label="Увеличить граф" disabled={zoom >= 1.5} className="rounded border px-3 py-2 disabled:opacity-40" onClick={() => setZoom(value => Math.min(1.5, value + 0.25))}>+</button>
      <span role="status" className="text-muted-foreground">Показано {nodes.length} из {cards.length}</span>
    </div>
    <p className="mb-2 text-xs text-muted-foreground">Нажмите на задачу, чтобы открыть её. Кнопки + и − раскрывают ветви. Прокрутите граф, чтобы увидеть соседние уровни.</p>
    {cards.length === 0 ? <p className="p-6 text-sm text-muted-foreground">По текущим фильтрам задач нет</p> : <div tabIndex={0} aria-label="Область графа с прокруткой" className="max-h-[70dvh] overflow-auto overscroll-contain rounded-lg border bg-muted/20">
      <div style={{ width: width * zoom, height: height * zoom }}>
        <div style={{ width, height, transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
          <CardGraphScene nodes={nodes} expanded={expanded} onToggle={id => setExpansion(toggleGraphBranch(expanded, id))} onOpen={onOpen} />
        </div>
      </div>
    </div>}
  </section>;
}
