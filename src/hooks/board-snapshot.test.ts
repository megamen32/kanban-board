import { describe, expect, it } from 'vitest';
import { readBoardSnapshot } from './board-snapshot';
import { unavailableTeamCatalog, type BoardTeamCatalog } from '@/lib/kanban/team-catalog';

const card = {id: 'fixture', version: 7, project: 'Alpha'};
const project = {id: 'registered-project', externalKey: 'fixture:empty', name: 'Empty'};
const catalog: BoardTeamCatalog = {
  status: 'partial', coverage: 'visible-projects',
  teams: [{id: 'exmanager:Crew', name: 'Crew'}],
  projectTeams: [{project: 'Alpha', teamId: 'exmanager:Crew', source: 'native-access'}],
  unknownProjectNames: ['Empty'],
};

describe('honest native board reads', () => {
  it('keeps old server compatibility while marking team metadata as unknown', async () => {
    await expect(readBoardSnapshot(Response.json({cards: [], projects: []})))
      .resolves.toEqual({cards: [], projects: [], teamCatalog: unavailableTeamCatalog()});
  });
  it('retains canonical IDs and versions without inventing project names', async () => {
    await expect(readBoardSnapshot(Response.json({cards: [card]})))
      .resolves.toEqual({cards: [card], projects: [], teamCatalog: unavailableTeamCatalog(['Alpha'])});
  });
  it('rejects expired login, ACL and rate-limit responses instead of showing zero tasks', async () => {
    for (const status of [401, 403, 429, 503]) {
      await expect(readBoardSnapshot(Response.json({error: 'failure'}, {status}))).rejects.toMatchObject({status});
    }
  });
  it('rejects successful login HTML and malformed snapshots', async () => {
    await expect(readBoardSnapshot(new Response('<html>Login</html>'))).rejects.toMatchObject({status: 502});
    for (const body of [{}, {cards: [{}]}, {cards: [], projects: null}, {cards: [], projects: [{}]}]) {
      await expect(readBoardSnapshot(Response.json(body))).rejects.toMatchObject({status: 502});
    }
  });
  it('preserves authorized projects and known teams even when some relationships are unknown', async () => {
    await expect(readBoardSnapshot(Response.json({cards: [card], projects: [project], teamCatalog: catalog})))
      .resolves.toEqual({cards: [card], projects: [project], teamCatalog: catalog});
  });
  it('accepts multiple confirmed teams on one project without merging their identity', async () => {
    const many: BoardTeamCatalog = {
      status: 'ready', coverage: 'visible-projects',
      teams: [{id: 'exmanager:First', name: 'Same label'}, {id: 'relay-scope:second', name: 'Same label'}],
      projectTeams: [
        {project: 'Alpha', teamId: 'exmanager:First', source: 'native-access'},
        {project: 'Alpha', teamId: 'relay-scope:second', source: 'relay-scope'},
      ],
      unknownProjectNames: [],
    };
    expect((await readBoardSnapshot(Response.json({cards: [card], teamCatalog: many}))).teamCatalog).toEqual(many);
  });
  it('rejects team metadata for a project outside the authorized snapshot', async () => {
    for (const change of [
      {projectTeams: [{project: 'Hidden', teamId: 'exmanager:Crew', source: 'native-access'}]},
      {unknownProjectNames: ['Empty', 'Hidden']},
      {teams: [...catalog.teams, {id: 'exmanager:Hidden', name: 'Hidden'}]},
    ]) {
      await expect(readBoardSnapshot(Response.json({cards: [card], projects: [project], teamCatalog: {...catalog, ...change}})))
        .rejects.toMatchObject({status: 502});
    }
  });
  it('rejects dangling, duplicate and malformed relationships instead of asserting a false team', async () => {
    for (const change of [
      {teams: null},
      {teams: [...catalog.teams, catalog.teams[0]]},
      {projectTeams: [{...catalog.projectTeams[0], teamId: 'missing'}]},
      {projectTeams: [...catalog.projectTeams, catalog.projectTeams[0]]},
      {projectTeams: [{...catalog.projectTeams[0], source: 'guessed'}]},
      {unknownProjectNames: ['Alpha', 'Empty']},
      {unknownProjectNames: []},
      {unknownProjectNames: ['Empty', 'Empty']},
      {status: ['ready']},
      {status: ['partial']},
      {status: 1},
      {status: 'ready'},
      {status: 'unavailable'},
      {coverage: 'all-teams'},
    ]) {
      await expect(readBoardSnapshot(Response.json({cards: [card], projects: [project], teamCatalog: {...catalog, ...change}})))
        .rejects.toMatchObject({status: 502});
    }
  });
  it('strips unexpected private fields from the client team projection', async () => {
    const extra = {
      ...catalog,
      teams: [{...catalog.teams[0], memberTelegramUserIds: ['secret']}],
      projectTeams: [{...catalog.projectTeams[0], writeAllowed: true}],
    };
    const snapshot = await readBoardSnapshot(Response.json({cards: [card], projects: [project], teamCatalog: extra}));
    expect(snapshot.teamCatalog).toEqual(catalog);
  });
});
