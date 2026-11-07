import fs from 'node:fs';
import path from 'node:path';
import type { BoardTeamCatalog } from './team-catalog';

const MAX_BYTES = 128 * 1024;
const MAX_TEAMS = 512;
const MAX_LINKS = 4096;
export const OWNER_TEAM_SNAPSHOT_RELATIVE_PATH = '.metadata/exmanager-team-catalog.json';

interface OwnerTeamSnapshot {
  schemaVersion: 1;
  sourceAppId: string;
  sourceRevision: string;
  observedAt: string;
  teams: { id: string; name: string }[];
  projectTeams: { project: string; teamId: string }[];
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, expected: string[]): boolean {
  return Object.keys(value).sort().join(',') === [...expected].sort().join(',');
}
function label(value: unknown, max = 512): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
    && value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value);
}
function validTime(value: unknown, now: number): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value && timestamp <= now + 300_000;
}

/** An operator imports an observed, owner-authorized directory. This is never an access grant. */
export function parseOwnerTeamSnapshot(value: unknown, now = Date.now()): OwnerTeamSnapshot | null {
  if (!record(value) || !keys(value, ['schemaVersion', 'sourceAppId', 'sourceRevision', 'observedAt', 'teams', 'projectTeams'])
    || value.schemaVersion !== 1 || typeof value.sourceAppId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.sourceAppId)
    || typeof value.sourceRevision !== 'string' || !/^[0-9a-f]{40}$/.test(value.sourceRevision)
    || !validTime(value.observedAt, now) || !Array.isArray(value.teams) || value.teams.length > MAX_TEAMS
    || !Array.isArray(value.projectTeams) || value.projectTeams.length > MAX_LINKS) return null;

  const ids = new Set<string>();
  const teams: OwnerTeamSnapshot['teams'] = [];
  for (const team of value.teams) {
    if (!record(team) || !keys(team, ['id', 'name']) || !label(team.name)
      || team.id !== `exmanager:${team.name}` || ids.has(team.id)) return null;
    ids.add(team.id);
    teams.push({ id: team.id, name: team.name });
  }
  const pairs = new Set<string>();
  const projectTeams: OwnerTeamSnapshot['projectTeams'] = [];
  for (const link of value.projectTeams) {
    if (!record(link) || !keys(link, ['project', 'teamId']) || !label(link.project)
      || !label(link.teamId, 1024) || !ids.has(link.teamId)) return null;
    const pair = JSON.stringify([link.project, link.teamId]);
    if (pairs.has(pair)) return null;
    pairs.add(pair);
    projectTeams.push({ project: link.project, teamId: link.teamId });
  }
  return {
    schemaVersion: 1, sourceAppId: value.sourceAppId, sourceRevision: value.sourceRevision,
    observedAt: value.observedAt, teams, projectTeams,
  };
}

/** Call only after the signed native identity and Board owner session both verified. */
export function readOwnerTeamCatalogSnapshot(tasksDir: string, projectNames: readonly string[]): BoardTeamCatalog | null {
  let descriptor: number | undefined;
  try {
    const filename = path.join(tasksDir, OWNER_TEAM_SNAPSHOT_RELATIVE_PATH);
    descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > MAX_BYTES) return null;
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    const length = fs.readSync(descriptor, bytes, 0, bytes.length, 0);
    if (length > MAX_BYTES) return null;
    const snapshot = parseOwnerTeamSnapshot(JSON.parse(bytes.subarray(0, length).toString('utf8')));
    if (!snapshot) return null;
    const projects = [...new Set(projectNames.filter(name => label(name)))].sort();
    const visible = new Set(projects);
    const projectTeams: BoardTeamCatalog['projectTeams'] = snapshot.projectTeams
      .filter(link => visible.has(link.project))
      .map(link => ({ ...link, source: 'exmanager-snapshot' }));
    const linkedProjects = new Set(projectTeams.map(link => link.project));
    const linkedTeams = new Set(projectTeams.map(link => link.teamId));
    const unknownProjectNames = projects.filter(name => !linkedProjects.has(name));
    return {
      status: unknownProjectNames.length || snapshot.teams.some(team => !linkedTeams.has(team.id)) ? 'partial' : 'ready',
      coverage: 'owner-catalog',
      teams: snapshot.teams,
      projectTeams,
      unknownProjectNames,
      provenance: { mode: 'snapshot', source: 'exmanager', observedAt: snapshot.observedAt, sourceRevision: snapshot.sourceRevision },
    };
  } catch {
    // Invalid, absent, unreadable and interrupted imports are all unknown metadata.
    return null;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}
