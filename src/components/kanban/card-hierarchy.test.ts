import { describe, expect, test } from 'vitest';
import { getCardAncestorChain, getEligibleParentCards, getVisibleCardChildren, groupVisibleCardHierarchy } from './card-hierarchy';

const cards = [
  { id: 'root', title: 'ForEnergo', parent: undefined, project: 'ForEnergo', owner: 'nikita' },
  { id: 'direction', title: 'Направление 1', parent: 'root', project: 'ForEnergo', owner: 'nikita' },
  { id: 'tender', title: 'Тендеры', parent: 'direction', project: 'ForEnergo', owner: 'nikita' },
  { id: 'pilot', title: 'Пилот', parent: 'tender', project: 'ForEnergo', owner: 'nikita' },
  { id: 'other-project', title: 'Другая задача', parent: undefined, project: 'Other', owner: 'nikita' },
  { id: 'other-owner', title: 'Чужая задача', parent: undefined, project: 'ForEnergo', owner: 'another-user' },
];

describe('card hierarchy presentation', () => {
  test('builds visible ancestor breadcrumbs and children for the selected branch', () => {
    expect(getCardAncestorChain(cards[3], cards).map(card => card.id)).toEqual(['root', 'direction', 'tender']);
    expect(getVisibleCardChildren(cards[2], cards).map(card => card.id)).toEqual(['pilot']);
  });

  test('parent choices exclude self, descendants, other projects, and other owners', () => {
    expect(getEligibleParentCards(cards[2], cards).map(card => card.id).sort()).toEqual(['direction', 'root']);
  });

  test('ancestor traversal terminates on malformed cycles and hides out-of-scope links', () => {
    const cycle = [
      { id: 'a', title: 'A', parent: 'b', project: 'ForEnergo', owner: 'nikita' },
      { id: 'b', title: 'B', parent: 'a', project: 'ForEnergo', owner: 'nikita' },
      { id: 'outside', title: 'Outside', parent: undefined, project: 'ForEnergo', owner: 'another-user' },
    ];
    expect(getCardAncestorChain(cycle[0], cycle).map(card => card.id)).toEqual(['b']);
    expect(getCardAncestorChain({ ...cycle[0], parent: 'outside' }, cycle)).toEqual([]);
  });

  test('groups only children in the visible selection and keeps a child visible when its parent is filtered out', () => {
    const full = cards as unknown as import('@/lib/kanban/types').KanbanCard[];
    const visible = groupVisibleCardHierarchy(full.filter(card => card.id !== 'direction'));
    expect(visible.map(group => group.card.id)).toContain('tender');
    expect(visible.find(group => group.card.id === 'root')?.children).toEqual([]);
    const filteredParent = groupVisibleCardHierarchy(full.filter(card => card.id === 'root' || card.id === 'tender'));
    expect(filteredParent.map(group => group.card.id)).toContain('tender');
    expect(filteredParent.find(group => group.card.id === 'root')?.children).toEqual([]);
  });
});
