/** Display metadata only. Teams never grant task access or change project identity. */
export interface BoardTeam {
  id: string;
  name: string;
}

export interface BoardProjectTeam {
  /** Exact canonical project name, including spaces and punctuation. */
  project: string;
  teamId: string;
  source: 'native-access' | 'relay-scope';
}

/** Only relationships for projects already authorized in this board snapshot. */
export interface BoardTeamCatalog {
  status: 'ready' | 'partial' | 'unavailable';
  coverage: 'visible-projects';
  teams: BoardTeam[];
  projectTeams: BoardProjectTeam[];
  unknownProjectNames: string[];
}

/** An older server or unavailable source must not look like a verified empty roster. */
export function unavailableTeamCatalog(projectNames: readonly string[] = []): BoardTeamCatalog {
  return {
    status: 'unavailable',
    coverage: 'visible-projects',
    teams: [],
    projectTeams: [],
    unknownProjectNames: [...new Set(projectNames.filter(Boolean))].sort(),
  };
}
