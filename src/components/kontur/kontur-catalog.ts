import type { KanbanCard } from '../../lib/kanban/types';
import type { BoardTeamCatalog } from '../../lib/kanban/team-catalog';
import { isClosedCard } from '../kanban/view-model';
import { UNKNOWN } from './kontur-model';
import { isProjectSection, type ProjectSection } from './kontur-config';

export const UNKNOWN_TEAM_FILTER = '__unknown_team__';
type Team = BoardTeamCatalog['teams'][number];

export interface KonturProject {
  name: string;
  registered: boolean;
  taskCount: number;
  openTaskCount: number;
  teams: Team[];
  teamUnknown: boolean;
  teamSnapshot?: BoardTeamCatalog['provenance'];
}

export interface KonturTeam extends Team {
  projects: KonturProject[];
  projectAssociationUnknown: boolean;
  taskCount: number | null;
  openTaskCount: number | null;
}

function snapshotProvenance(catalog: BoardTeamCatalog | undefined) {
  const provenance = catalog?.provenance;
  return catalog?.coverage === 'owner-catalog' && catalog.status !== 'unavailable'
    && provenance?.mode === 'snapshot' && provenance.source === 'exmanager' ? provenance : undefined;
}

function projectName(card: Pick<KanbanCard, 'project'>) {
  return card.project.trim() || UNKNOWN;
}

function orderNames(a: string, b: string) {
  if (a === b) return 0;
  if (a === UNKNOWN) return 1;
  if (b === UNKNOWN) return -1;
  return a.localeCompare(b, 'ru-RU', { numeric: true });
}

/** The caller supplies the complete authorized snapshot, before responsibility filters. */
export function buildProjectCatalog(
  cards: readonly KanbanCard[],
  registered: readonly { name: string }[],
  teamCatalog: BoardTeamCatalog,
): KonturProject[] {
  const projects = new Map<string, KonturProject>();
  const provenance = snapshotProvenance(teamCatalog);
  const ensure = (name: string) => {
    let project = projects.get(name);
    if (!project) {
      project = { name, registered: false, taskCount: 0, openTaskCount: 0, teams: [], teamUnknown: true };
      if (provenance) project.teamSnapshot = provenance;
      projects.set(name, project);
    }
    return project;
  };
  for (const entry of registered) {
    const name = entry.name.trim();
    if (name) ensure(name).registered = true;
  }
  for (const card of cards) {
    const project = ensure(projectName(card));
    project.taskCount += 1;
    if (!isClosedCard(card)) project.openTaskCount += 1;
  }

  // Relationships enrich visible identities; they never introduce new projects
  // or infer membership from names, aliases, prefixes or participants.
  if (teamCatalog.status !== 'unavailable') {
    const teams = new Map(teamCatalog.teams.map(team => [team.id, team]));
    for (const link of teamCatalog.projectTeams) {
      const project = projects.get(link.project);
      const team = teams.get(link.teamId);
      if (project && team && !project.teams.some(item => item.id === team.id)) {
        project.teams.push(team);
      }
    }
    const unknown = new Set(teamCatalog.unknownProjectNames);
    for (const project of projects.values()) {
      project.teams.sort((a, b) => orderNames(a.name, b.name) || a.id.localeCompare(b.id));
      project.teamUnknown = project.teams.length === 0 || unknown.has(project.name);
    }
  }
  return [...projects.values()].sort((a, b) => orderNames(a.name, b.name));
}

export function buildTeamCatalog(projects: readonly KonturProject[], catalog?: BoardTeamCatalog): KonturTeam[] {
  const teams = new Map<string, KonturTeam>();
  if (snapshotProvenance(catalog) && catalog) {
    const linkedTeams = new Set(catalog.projectTeams.map(link => link.teamId));
    // An observed owner roster can include teams whose project associations are
    // unknown. A project filter must not turn other, known links into unknown ones.
    for (const entry of catalog.teams) {
      if (!linkedTeams.has(entry.id)) teams.set(entry.id, {
        ...entry, projects: [], projectAssociationUnknown: true, taskCount: null, openTaskCount: null,
      });
    }
  }
  for (const project of projects) {
    for (const entry of project.teams) {
      let team = teams.get(entry.id);
      if (!team) {
        team = { ...entry, projects: [], projectAssociationUnknown: false, taskCount: 0, openTaskCount: 0 };
        teams.set(entry.id, team);
      }
      team.projectAssociationUnknown = false;
      team.projects.push(project);
      team.taskCount = (team.taskCount ?? 0) + project.taskCount;
      team.openTaskCount = (team.openTaskCount ?? 0) + project.openTaskCount;
    }
  }
  return [...teams.values()].sort((a, b) => orderNames(a.name, b.name) || a.id.localeCompare(b.id));
}

export function projectMatchesTeam(project: KonturProject, team: string): boolean {
  return team === 'all' || (team === UNKNOWN_TEAM_FILTER
    ? project.teamUnknown
    : project.teams.some(item => item.id === team));
}

/** Preserve the selected team in the URL while a failed metadata read cannot hide tasks. */
export function resolveTeamFilter(team: string, catalog: BoardTeamCatalog): string {
  if (catalog.status === 'unavailable') return 'all';
  if (snapshotProvenance(catalog) && catalog.teams.some(entry => entry.id === team)
    && !catalog.projectTeams.some(link => link.teamId === team)) return 'all';
  return team;
}

export function filterCardsByTeam(
  cards: readonly KanbanCard[],
  projects: readonly KonturProject[],
  team: string,
): KanbanCard[] {
  if (team === 'all') return [...cards];
  const names = new Set(projects.filter(project => projectMatchesTeam(project, team)).map(project => project.name));
  return cards.filter(card => names.has(projectName(card)));
}

export function projectTeamLabel(project: KonturProject | undefined): string {
  if (!project) return UNKNOWN;
  return [...project.teams.map(team => team.name), ...(project.teamUnknown ? [UNKNOWN] : [])].join(', ') || UNKNOWN;
}

/** A named project in an old URL always wins over the former navigation group. */
export function legacySectionForProject(project: string | null | undefined, section: string | null): ProjectSection {
  return (!project || project === 'all') && isProjectSection(section) ? section : 'all';
}

export interface KonturCatalogUrlState {
  team: string;
  view: 'projects' | 'teams';
}

function validTeamId(value: string | null): value is string {
  return value !== null && value.length > 0 && value.length <= 1024 && !/[\u0000-\u001f\u007f]/.test(value);
}

/** Team IDs are opaque, including case, spaces and punctuation. */
export function readCatalogUrlState(params: URLSearchParams): KonturCatalogUrlState {
  const team = params.get('team');
  return { team: validTeamId(team) ? team : 'all', view: params.get('catalogView') === 'teams' ? 'teams' : 'projects' };
}

/** Only updates catalogue parameters; unrelated board filters remain intact. */
export function writeCatalogUrlState(params: URLSearchParams, state: KonturCatalogUrlState, visible: boolean): void {
  if (validTeamId(state.team) && state.team !== 'all') params.set('team', state.team);
  else params.delete('team');
  if (visible && state.view === 'teams') params.set('catalogView', 'teams');
  else params.delete('catalogView');
}
