import { describe, expect, it, vi } from 'vitest';
import type { NativeProjectAccess, NativeProjectAccessContext } from './native-project-access';
import { parseRelayScopeCatalog, secondReviewerForProject, type RelayScopeCatalog } from './project-reviewers';
import { nativeTeamCatalog, relayTeamCatalog, resolveNativeTeamCatalog } from './team-catalog.server';

function access(project: string, team: string): NativeProjectAccess {
  return { project, team, readAllowed: true, writeAllowed: false };
}

function relayCatalog(): RelayScopeCatalog {
  return {
    schemaVersion: 1,
    owner: { telegramUserId: '100' },
    teams: [
      { id: 'alpha', name: 'Команда / Alpha: QA', kanbanProjects: ['Alpha', 'Hidden'],
        memberTelegramUserIds: ['100', '101'], boardLogins: { '101': 'fixture-reviewer' } },
      { id: 'beta', name: 'Beta', kanbanProjects: ['Alpha', 'Beta'],
        memberTelegramUserIds: ['102'] },
      { id: 'hidden', name: 'Private team', kanbanProjects: ['Hidden'],
        memberTelegramUserIds: ['103'] },
    ],
  };
}

describe('native team catalog projection', () => {
  it('keeps only exact admitted projects and successful grants, without members or capabilities', () => {
    const rows = [
      { ...access('Alpha', 'Crew / A: QA'), userId: 'private-member', members: ['private-member'] },
      access('alpha', 'Wrong case'),
      access('Hidden', 'Hidden team'),
      { ...access('Beta', 'Denied'), readAllowed: false },
      { ...access('Gamma', 'Malformed'), writeAllowed: 'yes' },
    ] as unknown as NativeProjectAccess[];
    expect(nativeTeamCatalog(['Gamma', 'Beta', 'Alpha'], rows)).toEqual({
      status: 'partial',
      coverage: 'visible-projects',
      teams: [{ id: 'exmanager:Crew / A: QA', name: 'Crew / A: QA' }],
      projectTeams: [{ project: 'Alpha', teamId: 'exmanager:Crew / A: QA', source: 'native-access' }],
      unknownProjectNames: ['Beta', 'Gamma'],
    });
  });

  it('deduplicates exact entries and preserves multiple verified relationships without choosing one', () => {
    const rows = [access('Beta', 'One'), access('Alpha', 'Two'), access('Alpha', 'One'), access('Alpha', 'One')];
    const expected = {
      status: 'ready',
      coverage: 'visible-projects',
      teams: [{ id: 'exmanager:One', name: 'One' }, { id: 'exmanager:Two', name: 'Two' }],
      projectTeams: [
        { project: 'Alpha', teamId: 'exmanager:One', source: 'native-access' },
        { project: 'Alpha', teamId: 'exmanager:Two', source: 'native-access' },
        { project: 'Beta', teamId: 'exmanager:One', source: 'native-access' },
      ],
      unknownProjectNames: [],
    };
    expect(nativeTeamCatalog(['Beta', 'Alpha', 'Alpha'], rows)).toEqual(expected);
    expect(nativeTeamCatalog(['Alpha', 'Beta'], rows.toReversed())).toEqual(expected);
  });

  it('does not adopt invalid or normalized identities', () => {
    const rows = [
      access('Alpha', ' padded '),
      access('Beta', 'bad\nteam'),
      access('Gamma', ''),
      access('Delta', 'x'.repeat(513)),
      access('Alpha ', 'Wrong project'),
    ];
    expect(nativeTeamCatalog(['Alpha', 'Beta', 'Gamma', 'Delta'], rows)).toMatchObject({
      status: 'unavailable', teams: [], projectTeams: [], unknownProjectNames: ['Alpha', 'Beta', 'Delta', 'Gamma'],
    });
  });

  it('handles a verified empty visible set without claiming an app-wide inventory', () => {
    expect(nativeTeamCatalog([], [access('Hidden', 'Hidden')])).toEqual({
      status: 'ready', coverage: 'visible-projects', teams: [], projectTeams: [], unknownProjectNames: [],
    });
  });
});

describe('bounded native catalog resolution', () => {
  it('uses at most four concurrent checks and looks up each exact project once', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let active = 0;
    let peak = 0;
    const forProject = vi.fn(async (project: string) => {
      active += 1;
      peak = Math.max(peak, active);
      await gate;
      active -= 1;
      return access(project, 'Shared crew');
    });
    const names = Array.from({ length: 9 }, (_, i) => `Project ${i}`);
    const pending = resolveNativeTeamCatalog([...names, names[0]], { userId: 'fixture-user', forProject });
    expect(forProject).toHaveBeenCalledTimes(4);
    release();
    const result = await pending;
    expect(peak).toBe(4);
    expect(forProject).toHaveBeenCalledTimes(9);
    expect(result.status).toBe('ready');
    expect(result.projectTeams).toHaveLength(9);
    expect(result.teams).toEqual([{ id: 'exmanager:Shared crew', name: 'Shared crew' }]);
  });

  it('keeps successful links while access denial and source failure remain unknown', async () => {
    const context: NativeProjectAccessContext = {
      userId: 'fixture-user',
      async forProject(project) {
        if (project === 'Denied') throw new Error('native_project_access_denied');
        if (project === 'Offline') throw new Error('private source diagnostics');
        return access(project, 'Known');
      },
    };
    const result = await resolveNativeTeamCatalog(['Offline', 'Allowed', 'Denied'], context);
    expect(result).toEqual({
      status: 'partial', coverage: 'visible-projects',
      teams: [{ id: 'exmanager:Known', name: 'Known' }],
      projectTeams: [{ project: 'Allowed', teamId: 'exmanager:Known', source: 'native-access' }],
      unknownProjectNames: ['Denied', 'Offline'],
    });
    expect(JSON.stringify(result)).not.toContain('diagnostics');
  });

  it('rejects a response for another candidate even when that project is visible', async () => {
    const context: NativeProjectAccessContext = {
      userId: 'fixture-user',
      async forProject(project) {
        if (project === 'Alpha') return access('Beta', 'Wrong response');
        throw new Error('native_project_access_denied');
      },
    };
    expect(await resolveNativeTeamCatalog(['Alpha', 'Beta'], context)).toMatchObject({
      status: 'unavailable', teams: [], projectTeams: [], unknownProjectNames: ['Alpha', 'Beta'],
    });
    expect(await resolveNativeTeamCatalog(['Alpha'], null)).toMatchObject({
      status: 'unavailable', unknownProjectNames: ['Alpha'],
    });
  });
});

describe('legacy team catalog projection', () => {
  it('shows only already admitted projects and their teams without exposing private directory data', () => {
    const result = relayTeamCatalog(['Alpha'], relayCatalog());
    expect(result).toEqual({
      status: 'ready', coverage: 'visible-projects',
      teams: [
        { id: 'relay-scope:beta', name: 'Beta' },
        { id: 'relay-scope:alpha', name: 'Команда / Alpha: QA' },
      ],
      projectTeams: [
        { project: 'Alpha', teamId: 'relay-scope:alpha', source: 'relay-scope' },
        { project: 'Alpha', teamId: 'relay-scope:beta', source: 'relay-scope' },
      ],
      unknownProjectNames: [],
    });
    for (const privateValue of ['private-member', 'fixture-reviewer', 'Hidden', 'memberTelegramUserIds', 'boardLogins']) {
      expect(JSON.stringify(result)).not.toContain(privateValue);
    }
  });

  it('keeps legacy names optional, distinct from native identity, and preserves reviewer selection', () => {
    const source = relayCatalog();
    delete source.teams[0].name;
    const parsed = parseRelayScopeCatalog(source);
    expect(secondReviewerForProject(parsed, 'Alpha')).toBe('fixture-reviewer');
    expect(relayTeamCatalog(['Alpha'], parsed).teams).toContainEqual({ id: 'relay-scope:alpha', name: 'alpha' });
    expect(nativeTeamCatalog(['Alpha'], [access('Alpha', 'alpha')]).teams)
      .toEqual([{ id: 'exmanager:alpha', name: 'alpha' }]);
  });

  it('reports absent, broken and ambiguous catalogs without inventing a link', () => {
    expect(relayTeamCatalog(['Alpha'], null)).toMatchObject({ status: 'unavailable', unknownProjectNames: ['Alpha'] });
    const broken = { ...relayCatalog(), schemaVersion: 2 };
    expect(relayTeamCatalog(['Alpha'], broken)).toMatchObject({ status: 'unavailable', teams: [], projectTeams: [] });
    const ambiguous = relayCatalog();
    ambiguous.teams.push({ ...ambiguous.teams[0], name: 'Conflicting label' });
    expect(relayTeamCatalog(['Alpha'], ambiguous)).toMatchObject({ status: 'unavailable', teams: [], projectTeams: [] });
    const malformedName = relayCatalog();
    malformedName.teams[0].name = 'Bad\nlabel';
    expect(() => parseRelayScopeCatalog(malformedName)).toThrow();
    expect(relayTeamCatalog(['Alpha'], malformedName)).toMatchObject({ status: 'unavailable', teams: [], projectTeams: [] });
  });

  it('does not infer a link by case, prefix or equal display label', () => {
    const result = relayTeamCatalog(['alpha', 'Alpha extension', 'Beta team'], relayCatalog());
    expect(result).toMatchObject({
      status: 'unavailable', teams: [], projectTeams: [], unknownProjectNames: ['Alpha extension', 'Beta team', 'alpha'],
    });
  });
});
