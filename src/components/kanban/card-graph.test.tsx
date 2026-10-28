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
  it('expands one branch, collapses it and retains the other visible roots', () => {
    const cards = [card('root'), card('child', 'root'), card('leaf', 'child'), card('other')];
    const { roots } = buildCardGraph(cards);
    const initial = new Set(['root']);
    expect(layoutCardGraph(roots, initial).map(node => node.card.id)).toEqual(['root', 'child', 'other']);
    const expanded = toggleGraphBranch(initial, 'child');
    expect(layoutCardGraph(roots, expanded).map(node => node.card.id)).toEqual(['root', 'child', 'leaf', 'other']);
    expect(layoutCardGraph(roots, toggleGraphBranch(expanded, 'root')).map(node => node.card.id)).toEqual(['root', 'other']);
  });

  it('keeps filtered and cross-scope orphans and renders only the current dataset', () => {
    const child = card('child', 'hidden');
    const parent = { ...card('parent'), owner: 'another' };
    const crossScopeChild = card('cross', 'parent');
    const graph = buildCardGraph([child, parent, crossScopeChild]);
    expect(graph.roots.map(node => node.card.id)).toEqual(['child', 'parent', 'cross']);
    const html = renderToStaticMarkup(<CardGraphView cards={[child]} onOpen={() => {}} />);
    expect(html).toContain('Задача child');
    expect(html).not.toContain('Задача parent');
    expect(html).not.toContain('Задача hidden');
  });

  it('preserves every node once for cycles and a deep chain without unbounded recursion', () => {
    const cards = [card('a', 'b'), card('b', 'a'), card('self', 'self'), ...Array.from({ length: 1200 }, (_, index) => card(`deep-${index}`, index ? `deep-${index - 1}` : undefined))];
    const graph = buildCardGraph(cards);
    const nodes = layoutCardGraph(graph.roots, new Set(graph.branches));
    expect(new Set(nodes.map(node => node.card.id)).size).toBe(cards.length);
    expect(nodes).toHaveLength(cards.length);
    expect(Math.max(...nodes.map(node => node.depth))).toBeLessThanOrEqual(24);
  });

  it('opens the exact card and toggles the branch through separate buttons', () => {
    const root = card('root');
    const graph = buildCardGraph([root, card('child', 'root')]);
    const onOpen = vi.fn();
    const onToggle = vi.fn();
    const elements = buttons(CardGraphScene({ nodes: layoutCardGraph(graph.roots, new Set()), expanded: new Set(), onOpen, onToggle }));
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
    const html = renderToStaticMarkup(<CardGraphScene nodes={layoutCardGraph(graph.roots, new Set(['root']))} expanded={new Set(['root'])} onOpen={() => {}} onToggle={() => {}} />);
    expect(html).toContain('<path');
    expect(html).toContain('aria-expanded="true"');
  });
});
