import { describe, expect, it } from 'vitest';
import type { KanbanCard } from '../../lib/kanban/types';
import type { BoardTeamCatalog } from '../../lib/kanban/team-catalog';
import { filterWorkspaceCards } from '../kanban/view-model';
import { filterCards, UNKNOWN } from './kontur-model';
import { projectMatchesSection } from './kontur-config';
import {
  UNKNOWN_TEAM_FILTER, buildProjectCatalog, buildTeamCatalog, filterCardsByTeam,
  legacySectionForProject, projectMatchesTeam, projectTeamLabel, readCatalogUrlState, resolveTeamFilter, writeCatalogUrlState,
} from './kontur-catalog';

function card(id: string, project: string, overrides: Partial<KanbanCard> = {}): KanbanCard {
  return {
    id, project, title: 'Synthetic task', description: '', column: 'todo', priority: 'medium',
    tags: [], order: 0, created: '2026-01-01T00:00:00Z', updated: '2026-01-01T00:00:00Z',
    fileName: id + '.md', version: 1, assignees: [], ...overrides,
  };
}

const emptyCatalog = (status: BoardTeamCatalog['status'] = 'ready'): BoardTeamCatalog => ({
  status, coverage: 'visible-projects', teams: [], projectTeams: [], unknownProjectNames: [],
});

function linkedCatalog(): BoardTeamCatalog {
  return {
    ...emptyCatalog(),
    teams: [{ id: 'fixture:one', name: 'Fixture team one' }, { id: 'fixture:two', name: 'Fixture team two' }],
    projectTeams: [
      { project: 'Fixture product', teamId: 'fixture:one', source: 'native-access' },
      { project: 'Fixture product', teamId: 'fixture:two', source: 'relay-scope' },
      { project: 'Fixture tools', teamId: 'fixture:one', source: 'native-access' },
    ],
  };
}

describe('Kontur authorized project catalogue', () => {
  it('keeps projects outside Mine/Shared and registered projects with no tasks', () => {
    const cards = [
      card('mine', 'Fixture personal', { assignees: ['fixture-me'] }),
      card('other', 'Fixture remote', { assignees: ['fixture-other'] }),
    ];
    const projects = buildProjectCatalog(cards, [{ name: 'Fixture empty' }], emptyCatalog());
    expect(filterWorkspaceCards(cards, 'fixture-me', 'mine').map(item => item.id)).toEqual(['mine']);
    expect(filterWorkspaceCards(cards, 'fixture-me', 'shared')).toEqual([]);
    expect(projects.map(project => project.name)).toEqual(['Fixture empty', 'Fixture personal', 'Fixture remote']);
    expect(projects.find(project => project.name === 'Fixture empty')).toMatchObject({
      registered: true, taskCount: 0, openTaskCount: 0, teamUnknown: true,
    });
  });

  it('keeps exact names separate and counts closed tasks without making preset projects', () => {
    const projects = buildProjectCatalog([
      card('a', 'Fixture product'), card('b', 'Fixture product', { column: 'done' }),
      card('c', 'Fixture product / engine'), card('d', 'fixture product'),
      card('e', 'Fixture archive', { column: 'archived' }),
    ], [{ name: 'Fixture product' }], emptyCatalog());
    expect(projects).toHaveLength(4);
    expect(projects.find(project => project.name === 'Fixture product')).toMatchObject({
      registered: true, taskCount: 2, openTaskCount: 1,
    });
    expect(projects.find(project => project.name === 'Fixture archive')?.openTaskCount).toBe(0);
    expect(buildProjectCatalog([], [], emptyCatalog())).toEqual([]);
  });

  it('keeps a missing project unknown without registering it', () => {
    expect(buildProjectCatalog([card('a', '  ')], [{ name: '' }], emptyCatalog())).toEqual([{
      name: UNKNOWN, registered: false, taskCount: 1, openTaskCount: 1, teams: [], teamUnknown: true,
    }]);
  });

  it('supports explicit many-to-many links without inferring task executor membership', () => {
    const projects = buildProjectCatalog([
      card('a', 'Fixture product', { assignees: ['fixture-outsider'] }),
      card('b', 'Fixture tools'), card('c', 'Fixture product / engine'),
    ], [], linkedCatalog());
    const product = projects.find(project => project.name === 'Fixture product')!;
    expect(product.teams.map(team => team.id)).toEqual(['fixture:one', 'fixture:two']);
    expect(projectTeamLabel(product)).toBe('Fixture team one, Fixture team two');
    expect(projectTeamLabel(projects.find(project => project.name === 'Fixture product / engine'))).toBe(UNKNOWN);
    const teams = buildTeamCatalog(projects);
    expect(teams.find(team => team.id === 'fixture:one')).toMatchObject({ taskCount: 2, openTaskCount: 2 });
    expect(teams.find(team => team.id === 'fixture:one')?.projects.map(project => project.name)).toEqual(['Fixture product', 'Fixture tools']);
  });

  it('does not introduce projects or teams from unrelated or invalid metadata links', () => {
    const metadata = linkedCatalog();
    metadata.teams.push({ id: 'fixture:orphan', name: 'Fixture orphan' });
    metadata.projectTeams.push(
      { project: 'Fixture hidden', teamId: 'fixture:orphan', source: 'native-access' },
      { project: 'Fixture product', teamId: 'fixture:missing', source: 'native-access' },
      { project: 'Fixture product', teamId: 'fixture:one', source: 'native-access' },
    );
    const projects = buildProjectCatalog([card('a', 'Fixture product')], [], metadata);
    expect(projects.map(project => project.name)).toEqual(['Fixture product']);
    expect(projects[0].teams).toHaveLength(2);
    expect(buildTeamCatalog(projects).map(team => team.id)).toEqual(['fixture:one', 'fixture:two']);
  });

  it('keeps tasks when metadata is unavailable and distinguishes unknown mappings', () => {
    const cards = [card('a', 'Fixture product'), card('b', 'Fixture unlinked')];
    const unavailable = { ...linkedCatalog(), status: 'unavailable' as const };
    const projects = buildProjectCatalog(cards, [], unavailable);
    expect(projects.every(project => project.teamUnknown && project.teams.length === 0)).toBe(true);
    expect(filterCardsByTeam(cards, projects, resolveTeamFilter('fixture:one', unavailable))).toEqual(cards);
    expect(resolveTeamFilter('fixture:one', { ...linkedCatalog(), status: 'partial' })).toBe('fixture:one');
    expect(filterCardsByTeam(cards, projects, UNKNOWN_TEAM_FILTER)).toEqual(cards);
    const partial = buildProjectCatalog(cards, [], { ...linkedCatalog(), status: 'partial' });
    expect(partial.find(project => project.name === 'Fixture product')?.teamUnknown).toBe(false);
    expect(partial.find(project => project.name === 'Fixture unlinked')?.teamUnknown).toBe(true);
  });

  it('intersects team, exact project and task filters while preserving native card references', () => {
    const cards = [
      card('a', 'Fixture product', { priority: 'high' }),
      card('b', 'Fixture product'), card('c', 'Fixture tools', { priority: 'high' }),
      card('d', 'Fixture unlinked'),
    ];
    const projects = buildProjectCatalog(cards, [], linkedCatalog());
    const teamCards = filterCardsByTeam(cards, projects, 'fixture:one');
    expect(teamCards.map(item => item.id)).toEqual(['a', 'b', 'c']);
    expect(filterCards(teamCards, { project: 'Fixture product', priority: 'high' })).toEqual([cards[0]]);
    expect(teamCards[0]).toBe(cards[0]);
    expect(filterCardsByTeam(cards, projects, UNKNOWN_TEAM_FILTER)).toEqual([cards[3]]);
    expect(filterCardsByTeam(cards, projects, 'fixture:not-visible')).toEqual([]);
    expect(projectMatchesTeam(projects[0], 'all')).toBe(true);
  });

  it('preserves old section URLs but gives explicit project identities priority', () => {
    expect(legacySectionForProject(null, 'airlock')).toBe('airlock');
    expect(legacySectionForProject('all', 'airlock')).toBe('airlock');
    expect(legacySectionForProject('Fixture product', 'airlock')).toBe('all');
    expect(legacySectionForProject(null, 'not-a-section')).toBe('all');
    expect(projectMatchesSection('Airlock', 'airlock')).toBe(true);
    expect(projectMatchesSection('Airlock / synthetic child', 'airlock')).toBe(false);
  });
});

describe('Kontur catalogue URL state', () => {
  it('round-trips exact long IDs and leaves project and server filters intact', () => {
    const team = 'exmanager:' + 'Fixture / Команда : ?# +% '.repeat(22) + ' ';
    expect(team.length).toBeGreaterThan(512);
    const params = new URLSearchParams({ project: 'Fixture / product', server: 'fixture-host', screen: 'catalog' });
    writeCatalogUrlState(params, { team, view: 'teams' }, true);
    const restored = new URLSearchParams(params.toString());
    expect(readCatalogUrlState(restored)).toEqual({ team, view: 'teams' });
    expect(restored.get('project')).toBe('Fixture / product');
    expect(restored.get('server')).toBe('fixture-host');
  });

  it('keeps the unknown selection across reloads and metadata outages', () => {
    const params = new URLSearchParams();
    const state = { team: UNKNOWN_TEAM_FILTER, view: 'projects' as const };
    expect(resolveTeamFilter(state.team, emptyCatalog('unavailable'))).toBe('all');
    writeCatalogUrlState(params, state, true);
    expect(readCatalogUrlState(new URLSearchParams(params.toString()))).toEqual(state);
    writeCatalogUrlState(params, { team: 'fixture:one', view: 'teams' }, false);
    expect(params.get('team')).toBe('fixture:one');
    expect(params.has('catalogView')).toBe(false);
  });

  it('ignores invalid IDs without truncating them into another identity', () => {
    for (const value of ['', 'x'.repeat(1025), 'fixture:' + String.fromCharCode(0) + 'invalid']) {
      expect(readCatalogUrlState(new URLSearchParams({ team: value })).team).toBe('all');
    }
    const exactLimit = 'x'.repeat(1024);
    expect(readCatalogUrlState(new URLSearchParams({ team: exactLimit })).team).toBe(exactLimit);
    const params = new URLSearchParams({ team: 'fixture:old', project: 'Fixture product' });
    writeCatalogUrlState(params, { team: 'all', view: 'projects' }, true);
    expect(params.has('team')).toBe(false);
    expect(params.get('project')).toBe('Fixture product');
  });
});
