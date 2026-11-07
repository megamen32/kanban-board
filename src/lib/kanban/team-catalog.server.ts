import type { NativeProjectAccess, NativeProjectAccessContext } from './native-project-access';
import { parseRelayScopeCatalog, type RelayScopeCatalog } from './project-reviewers';
import type { BoardTeamCatalog } from './team-catalog';

type ProjectTeam = BoardTeamCatalog['projectTeams'][number];
type Team = BoardTeamCatalog['teams'][number];

const MAX_PARALLEL_LOOKUPS = 4;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validLabel(value: unknown, maxLength = 512): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
    && value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value);
}

function projectsInView(projectNames: readonly string[]): string[] {
  return [...new Set(projectNames.filter(name => validLabel(name)))].sort(compareText);
}

function assemble(
  projects: readonly string[],
  teams: readonly Team[],
  projectTeams: readonly ProjectTeam[],
): BoardTeamCatalog {
  const allowed = new Set(projects);
  const links = new Map<string, ProjectTeam>();
  for (const link of projectTeams) {
    if (allowed.has(link.project)) {
      links.set(JSON.stringify([link.project, link.teamId, link.source]), link);
    }
  }
  const visibleLinks = [...links.values()].sort((a, b) => compareText(a.project, b.project)
    || compareText(a.teamId, b.teamId) || compareText(a.source, b.source));
  const linkedTeamIds = new Set(visibleLinks.map(link => link.teamId));
  const visibleTeams = [...new Map(teams.filter(team => linkedTeamIds.has(team.id))
    .map(team => [team.id, team])).values()]
    .sort((a, b) => compareText(a.name, b.name) || compareText(a.id, b.id));
  const linkedProjects = new Set(visibleLinks.map(link => link.project));
  const unknownProjectNames = projects.filter(project => !linkedProjects.has(project));
  return {
    status: unknownProjectNames.length === 0 ? 'ready' : visibleLinks.length > 0 ? 'partial' : 'unavailable',
    coverage: 'visible-projects',
    teams: visibleTeams,
    projectTeams: visibleLinks,
    unknownProjectNames,
  };
}

/** Project access has already been verified by the caller. This never grants access. */
export function nativeTeamCatalog(
  projectNames: readonly string[],
  successfulAccess: readonly NativeProjectAccess[],
): BoardTeamCatalog {
  const projects = projectsInView(projectNames);
  const allowed = new Set(projects);
  const teams: Team[] = [];
  const links: ProjectTeam[] = [];
  for (const access of successfulAccess) {
    if (!access || !validLabel(access.project) || !allowed.has(access.project)
      || !validLabel(access.team) || access.readAllowed !== true || typeof access.writeAllowed !== 'boolean') continue;
    const id = `exmanager:${access.team}`;
    teams.push({ id, name: access.team });
    links.push({ project: access.project, teamId: id, source: 'native-access' });
  }
  return assemble(projects, teams, links);
}

/** Bounded, request-local metadata checks. A failed lookup never removes an owner's cards. */
export async function resolveNativeTeamCatalog(
  projectNames: readonly string[],
  nativeContext: NativeProjectAccessContext | null,
): Promise<BoardTeamCatalog> {
  const projects = projectsInView(projectNames);
  if (!nativeContext) return nativeTeamCatalog(projects, []);
  const successful: NativeProjectAccess[] = [];
  let next = 0;
  async function worker(): Promise<void> {
    while (next < projects.length) {
      const project = projects[next++];
      try {
        const access = await nativeContext!.forProject(project);
        // The response must describe this exact request, never another candidate.
        if (access?.project === project) successful.push(access);
      } catch {
        // Denied, missing and unavailable are all unknown metadata. No permission is inferred.
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL_LOOKUPS, projects.length) }, () => worker()));
  return nativeTeamCatalog(projects, successful);
}

/** The caller supplies only projects already admitted by the legacy Board read policy. */
export function relayTeamCatalog(
  projectNames: readonly string[],
  catalog: RelayScopeCatalog | null,
): BoardTeamCatalog {
  const projects = projectsInView(projectNames);
  if (!catalog) return assemble(projects, [], []);
  let verified: RelayScopeCatalog;
  try {
    verified = parseRelayScopeCatalog(catalog);
  } catch {
    return assemble(projects, [], []);
  }
  const allowed = new Set(projects);
  const namesById = new Map<string, string>();
  const teams: Team[] = [];
  const links: ProjectTeam[] = [];
  for (const team of verified.teams) {
    const id = `relay-scope:${team.id}`;
    const name = team.name ?? team.id;
    if (!validLabel(team.id, 200) || !validLabel(name, 200)) return assemble(projects, [], []);
    const previousName = namesById.get(id);
    if (previousName !== undefined && previousName !== name) return assemble(projects, [], []);
    namesById.set(id, name);
    const visibleProjects = team.kanbanProjects.filter(project => allowed.has(project));
    if (!visibleProjects.length) continue;
    teams.push({ id, name });
    for (const project of visibleProjects) {
      links.push({ project, teamId: id, source: 'relay-scope' });
    }
  }
  return assemble(projects, teams, links);
}
