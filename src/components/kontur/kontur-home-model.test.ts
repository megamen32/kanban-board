import { describe, expect, it } from 'vitest';
import type { KanbanCard } from '@/lib/kanban/types';
import { homeItems, isQaCard } from './kontur-home-model';

const card = (patch: Partial<KanbanCard> = {}): KanbanCard => ({
  id: 'fixture', title: 'Task', description: '', owner: 'nikita', assignees: [], column: 'todo',
  project: 'Fixture', priority: 'medium', tags: [], version: 1, order: 0, fileName: 'fixture.md',
  created: '2026-11-08T00:00:00Z', updated: '2026-11-08T00:00:00Z', ...patch,
});
describe('home from authoritative cards', () => {
  it('hides closed, archived, backlog, later and explicitly marked QA', () => {
    const hidden = [card({column:'done'}), card({column:'archived'}), card({column:'inbox'}),
      card({column:'someday'}), card({tags:['qa']})];
    expect(homeItems(hidden, 'nikita')).toEqual([]);
  });
  it('does not guess QA from a title, project or a real blocker', () => {
    const value = card({title:'Fix test failures', project:'QA platform', blockerReason:'CI tests failed'});
    expect(isQaCard(value)).toBe(false);
    expect(homeItems([value], 'nikita')[0]).toMatchObject({bucket:'now', reason:'CI tests failed'});
  });
  it('distinguishes answers, personal work, other people and AI without duplicating cards', () => {
    const cards = [
      card({id:'answer', pendingQuestion:{id:'q',text:'Choose option',choices:[],askedAt:'2026-11-08T00:00:00Z',attemptOperationId:'op'}}),
      card({id:'now', assignees:['nikita']}),
      card({id:'other', assignees:['someone']}),
      card({id:'ai', executor:'dot'}),
    ];
    expect(homeItems(cards,'nikita').map(item => [item.card.id,item.bucket])).toEqual([
      ['answer','answer'],['now','now'],['other','waiting'],['ai','ai'],
    ]);
  });
  it('respects designated reviewers and only asks the responsible human', () => {
    expect(homeItems([card({column:'review',requiresApprovalFrom:['someone']})],'nikita')[0].bucket).not.toBe('answer');
    expect(homeItems([card({column:'review',requiresApprovalFrom:['Никита Розанов']})],'nikita')[0].bucket).toBe('answer');
  });
  it('keeps explicit waiting parties visible without claiming fresh activity', () => {
    expect(homeItems([card({waitingFor:['other'],executor:'dot'})],'nikita')[0]).toMatchObject({bucket:'waiting',reason:'Ожидается: other'});
  });
  it('uses priority and explicit today rank instead of inventing deadlines', () => {
    const cards = [card({id:'normal'}),card({id:'critical',priority:'critical'}),card({id:'today',todayRank:1})];
    expect(homeItems(cards,'nikita').map(item=>item.card.id)).toEqual(['today','critical','normal']);
    expect(cards[0].dueAt).toBeUndefined();
  });
});

describe('attention does not disappear behind planning or historical execution', () => {
  it('keeps incoming and later questions and review requests visible', () => {
    expect(homeItems([card({column:'inbox',needsReview:true})], 'nikita')[0].bucket).toBe('answer');
    const value = card({column:'someday',pendingQuestion:{id:'q',text:'Reply needed',choices:[],askedAt:'2026-11-08T00:00:00Z',attemptOperationId:'op'}});
    expect(homeItems([value], 'nikita')[0].bucket).toBe('answer');
  });
  it('does not send a reassigned human task into a collapsed historical AI group', () => {
    const value = card({assignees:['nikita'], executor:'dot', taskExecutionHistory:[{phase:'result'}] as KanbanCard['taskExecutionHistory']});
    expect(homeItems([value], 'nikita')[0].bucket).toBe('now');
    const stopped = card({taskExecutionHistory:[{phase:'stopped'}] as KanbanCard['taskExecutionHistory']});
    expect(homeItems([stopped], 'nikita')[0].bucket).toBe('now');
  });
});

describe('deadline attention', () => {
  it('puts actual overdue and explicitly urgent commitments before ordinary priority', () => {
    const values = [card({id:'high',priority:'high'}), card({id:'overdue',priority:'low',dueAt:'2026-11-07T00:00:00Z'}),
      card({id:'urgent',priority:'low',urgent:true})];
    expect(homeItems(values,'nikita',Date.parse('2026-11-08T00:00:00Z')).map(item=>item.card.id)).toEqual(['overdue','urgent','high']);
  });
});

it('keeps a calendar deadline current until the Moscow day ends', () => {
  const values = [
    card({ id: 'calendar', priority: 'low', dueAt: '2030-01-02' }),
    card({ id: 'high', priority: 'high' }),
  ];
  expect(homeItems(values, 'nikita', Date.parse('2030-01-02T20:59:59.998Z')).map(item => item.card.id))
    .toEqual(['high', 'calendar']);
  expect(homeItems(values, 'nikita', Date.parse('2030-01-02T21:00:00Z')).map(item => item.card.id))
    .toEqual(['calendar', 'high']);
});
