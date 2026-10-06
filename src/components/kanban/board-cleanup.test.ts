import { describe, expect, it } from 'vitest';
import type { KanbanCard } from '../../lib/kanban/types';
import { DEFAULT_COLUMNS } from '../../lib/kanban/types';
import { filterAttentionCards, filterWorkspaceCards, getBoardCounts, getPlanningTabCards, isClosedCard, searchCards } from './view-model';

const card = (id: string, extra: Partial<KanbanCard> = {}): KanbanCard => ({
  id, title: id, description: '', column: 'todo', priority: 'medium', tags: [], order: 0,
  created: '2026-09-07T00:00:00Z', updated: '2026-09-07T00:00:00Z', fileName: `${id}.md`,
  version: 1, project: 'ИИ-Бенчмарки', assignees: [], ...extra,
});

describe('non-destructive board cleanup views', () => {
  it('keeps cancelled and completed cards distinct and readable', () => {
    const cards = [card('active'), card('cancelled', { column: 'archived' }), card('finished', { column: 'done' })];
    const before = JSON.stringify(cards);
    expect(getPlanningTabCards(cards, 'closed').map(item => item.id)).toEqual(['cancelled', 'finished']);
    expect(cards.filter(item => !isClosedCard(item)).map(item => item.id)).toEqual(['active']);
    expect(JSON.stringify(cards)).toBe(before);
    expect(DEFAULT_COLUMNS.find(item => item.id === 'archived')?.title).toBe('Не планируется');
    expect(DEFAULT_COLUMNS.find(item => item.id === 'done')?.title).toBe('Готово');
  });

  it('does not count closed cards as active or needing an assignee', () => {
    const cards = [card('unassigned'), card('blocked', { column: 'blocked', assignees: ['Дмитрий'] }),
      card('assigned', { assignee: 'Григорий' }), card('done', { column: 'done' }), card('cancelled', { column: 'archived' })];
    expect(getBoardCounts(cards)).toEqual({ active: 3, done: 1, archived: 1, blocked: 1, unassigned: 1 });
    expect(filterAttentionCards(cards, 'blocked').map(item => item.id)).toEqual(['blocked']);
    expect(filterAttentionCards(cards, 'unassigned').map(item => item.id)).toEqual(['unassigned']);
  });

  it('searches Russian text, people and provenance without changing data', () => {
    const cards = [card('one', { title: 'Тестировать бота', assignees: ['Дмитрий'], source: 'telegram:5453051466:1516' }),
      card('two', { description: 'UX конкурентов', assignees: ['Григорий'] })];
    const before = JSON.stringify(cards);
    expect(searchCards(cards, ' ДМИТРИЙ  1516 ').map(item => item.id)).toEqual(['one']);
    expect(searchCards(cards, 'ux григорий').map(item => item.id)).toEqual(['two']);
    expect(searchCards(cards, 'дмитрий конкурентов')).toEqual([]);
    expect(searchCards(cards, '  ')).toBe(cards);
    expect(JSON.stringify(cards)).toBe(before);
  });

  it('matches the existing Nikita aliases in both directions', () => {
    const cards = [card('cyrillic', { assignees: ['Никита'] }), card('latin', { assignee: 'nikita' }), card('other', { owner: 'Григорий' })];
    expect(filterWorkspaceCards(cards, 'nikita', 'mine').map(item => item.id)).toEqual(['cyrillic', 'latin']);
    expect(filterWorkspaceCards(cards, 'Никита', 'mine').map(item => item.id)).toEqual(['cyrillic', 'latin']);
  });
});
