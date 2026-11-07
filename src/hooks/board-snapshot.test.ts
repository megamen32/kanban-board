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

const snapshotProvenance = {
  mode: 'snapshot', source: 'exmanager', observedAt: '2026-01-02T03:04:05.000Z', sourceRevision: 'a'.repeat(40),
} as const;
const ownerCatalog: BoardTeamCatalog = {
  status: 'partial', coverage: 'owner-catalog', provenance: snapshotProvenance,
  teams: [{id: 'fixture:crew', name: 'Fixture crew'}, {id: 'fixture:unlinked', name: 'Fixture unlinked'}],
  projectTeams: [{project: 'Alpha', teamId: 'fixture:crew', source: 'exmanager-snapshot'}],
  unknownProjectNames: ['Empty'],
};

describe('dated owner team snapshots', () => {
  it('retains observed teams when every project association is unknown', async () => {
    const metadata = {...ownerCatalog, projectTeams: [], unknownProjectNames: ['Alpha', 'Empty']};
    expect((await readBoardSnapshot(Response.json({cards: [card], projects: [project], teamCatalog: metadata}))).teamCatalog)
      .toEqual(metadata);
  });

  it('retains a partial owner roster without visible projects or fabricated links', async () => {
    const metadata = {...ownerCatalog, projectTeams: [], unknownProjectNames: []};
    expect((await readBoardSnapshot(Response.json({cards: [], projects: [], teamCatalog: metadata}))).teamCatalog)
      .toEqual(metadata);
  });

  it('keeps partial status for an unlinked team even when every visible project has a link', async () => {
    const metadata = {...ownerCatalog, unknownProjectNames: []};
    expect((await readBoardSnapshot(Response.json({cards: [card], teamCatalog: metadata}))).teamCatalog).toEqual(metadata);
    await expect(readBoardSnapshot(Response.json({cards: [card], teamCatalog: {...metadata, status: 'ready'}})))
      .rejects.toMatchObject({status: 502});
  });

  it('accepts a complete dated snapshot without claiming that it is live', async () => {
    const metadata: BoardTeamCatalog = {
      ...ownerCatalog, status: 'ready', teams: ownerCatalog.teams.slice(0, 1), unknownProjectNames: [],
    };
    expect((await readBoardSnapshot(Response.json({cards: [card], teamCatalog: metadata}))).teamCatalog).toEqual(metadata);
    await expect(readBoardSnapshot(Response.json({cards: [card], teamCatalog: {...metadata, status: 'partial'}})))
      .rejects.toMatchObject({status: 502});
  });

  it('requires exact snapshot provenance and valid UTC observation time', async () => {
    for (const provenance of [
      undefined, null, {...snapshotProvenance, mode: 'live'}, {...snapshotProvenance, source: 'guessed'},
      {...snapshotProvenance, observedAt: '2026-01-02T03:04:05'},
      {...snapshotProvenance, observedAt: '2026-01-02T03:04:05Z'},
      {...snapshotProvenance, observedAt: '2026-01-02T03:04:05.0Z'},
      {...snapshotProvenance, observedAt: '2026-01-02T03:04:05+00:00'},
      {...snapshotProvenance, observedAt: '2026-02-30T03:04:05.000Z'},
      {...snapshotProvenance, observedAt: 'not-a-date'},
      {...snapshotProvenance, sourceRevision: 'a'.repeat(39)},
      {...snapshotProvenance, sourceRevision: 'A'.repeat(40)},
    ]) {
      await expect(readBoardSnapshot(Response.json({cards: [card], projects: [project], teamCatalog: {...ownerCatalog, provenance}})))
        .rejects.toMatchObject({status: 502});
    }
  });

  it('keeps snapshot and live source contracts separate and rejects hidden project links', async () => {
    for (const change of [
      {status: 'unavailable'},
      {projectTeams: [{...ownerCatalog.projectTeams[0], source: 'native-access'}]},
      {projectTeams: [{...ownerCatalog.projectTeams[0], source: 'relay-scope'}]},
      {projectTeams: [{...ownerCatalog.projectTeams[0], project: 'Fixture hidden'}]},
    ]) {
      await expect(readBoardSnapshot(Response.json({cards: [card], projects: [project], teamCatalog: {...ownerCatalog, ...change}})))
        .rejects.toMatchObject({status: 502});
    }
    for (const change of [
      {projectTeams: [{...catalog.projectTeams[0], source: 'exmanager-snapshot'}]},
      {provenance: snapshotProvenance},
    ]) {
      await expect(readBoardSnapshot(Response.json({cards: [card], projects: [project], teamCatalog: {...catalog, ...change}})))
        .rejects.toMatchObject({status: 502});
    }
  });

  it('copies only display metadata and provenance, never snapshot permission claims', async () => {
    const metadata = {
      ...ownerCatalog,
      provenance: {...snapshotProvenance, privateSource: 'synthetic-only'},
      teams: ownerCatalog.teams.map(team => ({...team, canRead: true, members: ['synthetic-only']})),
      projectTeams: ownerCatalog.projectTeams.map(link => ({...link, readAllowed: true, writeAllowed: true})),
    };
    expect((await readBoardSnapshot(Response.json({cards: [card], projects: [project], teamCatalog: metadata}))).teamCatalog)
      .toEqual(ownerCatalog);
  });
});
