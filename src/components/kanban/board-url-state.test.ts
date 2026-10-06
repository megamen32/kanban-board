import { describe, expect, it } from 'vitest';
import { parseBoardUrlState, serializeBoardUrlState, type BoardUrlState } from './board-url-state';

describe('board URL state', () => {
  it('opens a project-scoped team view from a secretary link', () => {
    const parsed = parseBoardUrlState(new URLSearchParams(
      'project=%D0%98%D0%98-%D0%91%D0%B5%D0%BD%D1%87%D0%BC%D0%B0%D1%80%D0%BA%D0%B8&view=all&tab=execution&assignee=%D0%9E%D0%BB%D0%B5%D0%B3&person=nikita&search=canary&layout=list',
    ));
    expect(parsed).toEqual({
      project: 'ИИ-Бенчмарки', workspaceView: 'all', tab: 'execution', assignee: 'Олег',
      person: 'nikita', search: 'canary', layout: 'list',
    });
  });

  it('keeps legacy layout links readable while rejecting invalid enum values', () => {
    expect(parseBoardUrlState(new URLSearchParams('view=kanban&tab=unknown&attention=everything&closed=deleted')))
      .toEqual({ layout: 'kanban' });
  });

  it('serializes the visible filters into a deterministic copyable URL', () => {
    const state: BoardUrlState = {
      project: 'Forenergo', workspaceView: 'all', layout: 'list', tab: 'execution',
      assignee: 'all', person: 'nikita', search: '', attention: 'all', closedKind: 'all', inboxOnly: false,
    };
    expect(serializeBoardUrlState(state).toString())
      .toBe('tab=execution&view=all&layout=list&project=Forenergo&person=nikita');
  });
});
