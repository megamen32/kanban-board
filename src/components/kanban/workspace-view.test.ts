import { describe, expect, it } from 'vitest';
import { filterWorkspaceCards, getPeople } from './view-model';
import type { KanbanCard } from '@/lib/kanban/types';

const card = (id: string, extra: Partial<KanbanCard> = {}): KanbanCard => ({
  id, title: id, description: '', column: 'todo', priority: 'medium', tags: [], order: 0,
  created: '2026-08-12T00:00:00.000Z', updated: '2026-08-12T00:00:00.000Z', fileName: `${id}.md`, version: 1,
  project: 'EE Frontier', assignees: [], owner: 'nikita', shared: false, ...extra,
});

describe('personal and shared workspace views', () => {
  const cards = [
    card('nikita-private'),
    card('marina-private', { owner: 'marina', assignees: ['marina'] }),
    card('ee-shared', { owner: 'nikita', shared: true, assignees: ['marina'] }),
  ];

  it('shows a person their own work and work that requires them', () => {
    expect(filterWorkspaceCards(cards, 'marina', 'mine').map(item => item.id)).toEqual(['marina-private', 'ee-shared']);
  });

  it('excludes owned cards with another executor from «Моё»', () => {
    const cards = [
      card('done-by-dmitry', { owner: 'nikita', assignees: ['Дмитрий'] }),
      card('mine-empty-execs', { owner: 'nikita' }),
      card('mine-as-executor', { owner: 'dmitry', assignees: ['Никита'] }),
    ];
    expect(filterWorkspaceCards(cards, 'nikita', 'mine').map(item => item.id)).toEqual(['mine-empty-execs', 'mine-as-executor']);
  });

  it('never counts waiting or approval mentions as personal work', () => {
    const cards = [
      card('waiting-only', { owner: 'dmitry', waitingFor: ['Никита'] }),
      card('approval-only', { owner: 'dmitry', requiresApprovalFrom: ['Никита'] }),
      card('approver-with-other-executor', { owner: 'dmitry', assignees: ['Дмитрий'], requiresApprovalFrom: ['Никита'] }),
    ];
    expect(filterWorkspaceCards(cards, 'nikita', 'mine')).toEqual([]);
  });

  it('shows multi-participant and explicitly shared cards as «Общее» without relying on a stale flag', () => {
    const cards = [
      card('flagged', { owner: 'nikita', shared: true }),
      card('owner-and-executor', { owner: 'dmitry', assignees: ['григорий'] }),
      card('owner-only-private', { owner: 'nikita' }),
      card('waiter-makes-it-common', { owner: 'dmitry', waitingFor: ['григорий'] }),
      card('same-person-twice', { owner: 'dmitry', assignees: ['dmitry'] }),
    ];
    expect(filterWorkspaceCards(cards, 'marina', 'shared').map(item => item.id)).toEqual(['flagged', 'owner-and-executor', 'waiter-makes-it-common']);
  });

  it('keeps common projects visible independently of the card owner', () => {
    expect(filterWorkspaceCards(cards, 'marina', 'shared').map(item => item.id)).toEqual(['ee-shared']);
  });

  it('discovers people from owners and assignments for the first-entry picker', () => {
    expect(getPeople([...cards, card('cyrillic-nikita', { assignees: ['Никита'] })])).toEqual(['Никита Розанов', 'marina']);
  });

  it('shows Nikita aliases as one person and filters them through the stable identity', () => {
    const aliases = [
      card('latin-name', { owner: 'nikita' }),
      card('cyrillic-name', { owner: 'Никита' }),
      card('full-name', { owner: 'Никита Розанов' }),
    ];

    expect(getPeople(aliases)).toEqual(['Никита Розанов']);
    for (const alias of ['nikita', 'Никита', 'Никита Розанов']) {
      expect(filterWorkspaceCards(aliases, alias, 'mine').map(item => item.id)).toEqual([
        'latin-name', 'cyrillic-name', 'full-name',
      ]);
    }
  });
});
