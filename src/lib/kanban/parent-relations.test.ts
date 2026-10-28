import { describe, expect, it } from 'vitest';
import { validateParentRelation } from './parent-relations';
import type { KanbanCard } from './types';

function card(id: string, parent?: string, project = 'ForEnergo', owner = 'nikita'): Pick<KanbanCard, 'id' | 'parent' | 'project' | 'owner'> {
  return { id, parent, project, owner };
}

describe('parent relation validation', () => {
  it('allows an unparented root and a same-project, same-owner nested edge', () => {
    const cards = [card('project'), card('direction', 'project'), card('tender', 'direction')];

    expect(() => validateParentRelation('pilot', undefined, 'ForEnergo', 'nikita', cards)).not.toThrow();
    expect(() => validateParentRelation('pilot', 'tender', 'ForEnergo', 'nikita', cards)).not.toThrow();
  });

  it.each([
    ['self', 'child', 'ForEnergo', 'nikita', [card('child')], 'parent_relation_self'],
    ['missing', 'absent', 'ForEnergo', 'nikita', [card('other')], 'parent_relation_missing'],
    ['different project', 'other', 'ForEnergo', 'nikita', [card('other', undefined, 'Another project')], 'parent_relation_scope_mismatch'],
    ['different owner', 'other', 'ForEnergo', 'oleg', [card('other')], 'parent_relation_scope_mismatch'],
    ['direct cycle', 'parent', 'ForEnergo', 'nikita', [card('child'), card('parent', 'child')], 'parent_relation_cycle'],
    ['indirect cycle', 'parent', 'ForEnergo', 'nikita', [card('child'), card('parent', 'ancestor'), card('ancestor', 'child')], 'parent_relation_cycle'],
  ] as const)('rejects %s', (_label, parentId, project, owner, cards, error) => {
    expect(() => validateParentRelation('child', parentId, project, owner, cards)).toThrow(error);
  });
});
