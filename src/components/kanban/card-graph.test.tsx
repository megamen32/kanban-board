import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { KanbanCard } from '@/lib/kanban/types';
import { buildCardGraph, layoutCardGraph, toggleGraphBranch } from './card-graph-model';
import { CardGraphScene, CardGraphView } from './card-graph-view';

function card(id: string, parent?: string): KanbanCard {
  return { id, title: `Задача ${id}`, parent, project: 'Synthetic project', owner: 'synthetic', description: '', column: 'todo', priority: 'medium', tags: [], order: 0, created: '', updated: '', fileName: `${id}.md`, version: 1, assignees: [] };
}

function buttons(element: React.ReactNode): React.ReactElement<React.ComponentProps<'button'>>[] {
  if (!React.isValidElement<{ children?: React.ReactNode }>(element)) return [];
  const children = React.Children.toArray(element.props.children).flatMap(child => buttons(child));
  return element.type === 'button' ? [element as React.ReactElement<React.ComponentProps<'button'>>, ...children] : children;
}

describe('filtered card graph', () => {
  it('renders an always-visible scope switch in the graph when provided', () => {
    const html = renderToStaticMarkup(<CardGraphView cards={[card('mine')]} onOpen={() => {}}
      workspaceView="all" onWorkspaceViewChange={() => {}} />);
    expect(html).toContain('Фильтр задач графа');
    expect(html).toContain('Моё');
    expect(html).toContain('Общее');
    expect(html).toContain('Всё');
    expect(html).toContain('aria-pressed="true"');
  });

  it('offers the exact-status filter beside direction controls without dropping layout data', () => {
    const html = renderToStaticMarkup(<CardGraphView cards={[card('q')]} onOpen={() => {}} />);
    expect(html).toContain('Фильтр точного статуса');
    for (const label of ['Все', 'Входящие', 'К выполнению', 'В работе', 'Заблокировано', 'На приёмке', 'Бэклог']) {
      expect(html).toContain('>' + label + '<');
    }
  });

  it('groups tasks into status subzones inside project areas and drops the project membership web there', () => {
    const queue = card('queue-card');
    const working = { ...card('work-card'), column: 'in-progress' as const };
    const reviewing = { ...card('review-card'), column: 'review' as const };
    const html = renderToStaticMarkup(<CardGraphView cards={[queue, working, reviewing]} onOpen={() => {}} />);
    expect(html).toContain('data-graph-zone="queue"');
    expect(html).toContain('data-graph-zone="work"');
    expect(html).toContain('data-graph-zone="review"');
    expect(html).toContain('Очередь · 1');
    expect(html).toContain('В работе · 1');
    expect(html).toContain('На приёмке · 1');
    expect(html).not.toContain('data-graph-edge="project-task"');
    expect(html).not.toContain('data-graph-edge="parent-task"');
  });

  it('keeps real parent-child connectors inside project areas, without inventing project links', () => {
    const parent = card('root');
    parent.column = 'in-progress';
    const child = card('leaf', 'root');
    child.column = 'review';
    const html = renderToStaticMarkup(<CardGraphView cards={[parent, child]} onOpen={() => {}} />);
    expect(html).toContain('data-graph-edge="parent-task"');
    expect(html).not.toContain('data-graph-edge="project-task"');
  });


  it('clips long task titles within their graph cards', () => {
    const longTask = { ...card('long'), title: 'Очень длинное описание задачи '.repeat(20) };
    const graph = buildCardGraph([longTask]);
    const html = renderToStaticMarkup(<CardGraphScene
      nodes={layoutCardGraph(graph.roots, new Set(graph.branches))}
      expanded={new Set(graph.branches)} onOpen={() => {}} onToggle={() => {}} />);
    expect(html).toContain('line-clamp-2');
    expect(html).toContain('overflow-hidden');
    expect(html).toContain('aria-label="Открыть задачу: ');
    expect(html).not.toContain('block line-clamp-2');
  });
  it('adds a real project parent and membership edges even when tasks have no parent field', () => {
    const alpha = { ...card('a'), project: 'Проект Альфа' };
    const beta = { ...card('b'), project: 'Проект Бета' };
    const graph = buildCardGraph([alpha, { ...card('c'), project: 'Проект Альфа' }, beta]);
    const expanded = new Set(graph.branches);
    const nodes = layoutCardGraph(graph.roots, expanded);
    expect(graph.roots.map(node => node.label)).toEqual(['Проект Альфа', 'Проект Бета']);
    expect(nodes.filter(node => node.kind === 'project')).toHaveLength(2);
    for (const task of nodes.filter(node => node.kind === 'task')) {
      const parent = nodes.find(node => node.id === task.parentId)!;
      expect(parent.kind).toBe('project');
      expect(parent.project).toBe(task.project);
      expect(task.x).toBeGreaterThan(parent.x);
    }
    const html = renderToStaticMarkup(<CardGraphScene nodes={nodes} expanded={expanded} onOpen={() => {}} onToggle={() => {}} />);
    expect(html.match(/data-graph-edge="project-task"/g)).toHaveLength(3);
    expect(html).toContain('Проект Альфа');
    expect(html).toContain('Проект Бета');
    expect(html).toContain('marker-end="url(#task-graph-arrow)"');
  });

  it('lays parent tasks between children and draws both relation types without overlap', () => {
    const graph = buildCardGraph([card('root'), card('a', 'root'), card('b', 'root')]);
    const nodes = layoutCardGraph(graph.roots, new Set(graph.branches));
    const root = nodes.find(node => node.id === 'root')!;
    const a = nodes.find(node => node.id === 'a')!;
    const b = nodes.find(node => node.id === 'b')!;
    expect(root.y).toBe((a.y + b.y) / 2);
    expect(b.y - a.y).toBeGreaterThanOrEqual(100);
    const html = renderToStaticMarkup(<CardGraphScene nodes={nodes} expanded={new Set(graph.branches)} onOpen={() => {}} onToggle={() => {}} />);
    expect(html.match(/data-graph-edge="parent-task"/g)).toHaveLength(2);
    expect(layoutCardGraph(graph.roots, new Set()).map(node => node.kind)).toEqual(['project']);
  });

  it('expands one branch, collapses it and retains the other visible roots', () => {
    const cards = [card('root'), card('child', 'root'), card('leaf', 'child'), card('other')];
    const { roots } = buildCardGraph(cards);
    const initial = new Set([roots[0].id, 'root']);
    expect(layoutCardGraph(roots, initial).filter(node => node.card).map(node => node.card!.id)).toEqual(['root', 'child', 'other']);
    const expanded = toggleGraphBranch(initial, 'child');
    expect(layoutCardGraph(roots, expanded).filter(node => node.card).map(node => node.card!.id)).toEqual(['root', 'child', 'leaf', 'other']);
    expect(layoutCardGraph(roots, toggleGraphBranch(expanded, 'root')).filter(node => node.card).map(node => node.card!.id)).toEqual(['root', 'other']);
  });

  it('keeps filtered and cross-scope orphans and renders only the current dataset', () => {
    const child = card('child', 'hidden');
    const parent = { ...card('parent'), owner: 'another' };
    const crossScopeChild = card('cross', 'parent');
    const graph = buildCardGraph([child, parent, crossScopeChild]);
    expect(graph.roots.flatMap(node => node.children.map(child => child.card!.id))).toEqual(['child', 'parent', 'cross']);
    const html = renderToStaticMarkup(<CardGraphView cards={[child]} onOpen={() => {}} />);
    expect(html).toContain('Задача child');
    expect(html).not.toContain('Задача parent');
    expect(html).not.toContain('Задача hidden');
  });

  it('preserves every node once for cycles and a deep chain without unbounded recursion', () => {
    const cards = [card('a', 'b'), card('b', 'a'), card('self', 'self'), ...Array.from({ length: 1200 }, (_, index) => card(`deep-${index}`, index ? `deep-${index - 1}` : undefined))];
    const graph = buildCardGraph(cards);
    const nodes = layoutCardGraph(graph.roots, new Set(graph.branches)).filter(node => node.card);
    expect(new Set(nodes.map(node => node.card!.id)).size).toBe(cards.length);
    expect(nodes).toHaveLength(cards.length);
    expect(Math.max(...nodes.map(node => node.depth))).toBeLessThanOrEqual(25);
  });

  it('opens the exact card and toggles the branch through separate buttons', () => {
    const root = card('root');
    const graph = buildCardGraph([root, card('child', 'root')]);
    const onOpen = vi.fn();
    const onToggle = vi.fn();
    const elements = buttons(CardGraphScene({ nodes: layoutCardGraph(graph.roots, new Set([graph.roots[0].id])), expanded: new Set([graph.roots[0].id]), onOpen, onToggle }));
    const open = elements.find(button => button.props['aria-label'] === 'Открыть задачу: Задача root')!;
    const toggle = elements.find(button => button.props['aria-label'] === 'Раскрыть подзадачи: Задача root')!;
    open.props.onClick!({} as React.MouseEvent<HTMLButtonElement>);
    expect(onOpen).toHaveBeenCalledWith(root);
    expect(onToggle).not.toHaveBeenCalled();
    toggle.props.onClick!({} as React.MouseEvent<HTMLButtonElement>);
    expect(onToggle).toHaveBeenCalledWith(root.id);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('renders a parent-child connector and accessible expanded state', () => {
    const graph = buildCardGraph([card('root'), card('child', 'root')]);
    const html = renderToStaticMarkup(<CardGraphScene nodes={layoutCardGraph(graph.roots, new Set([graph.roots[0].id, 'root']))} expanded={new Set([graph.roots[0].id, 'root'])} onOpen={() => {}} onToggle={() => {}} />);
    expect(html).toContain('<path');
    expect(html).toContain('aria-expanded="true"');
  });
});
