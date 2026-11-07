import type { KanbanCard } from '@/lib/kanban/types';
import type { KanbanProject } from '@/lib/kanban/project-store';
import { unavailableTeamCatalog, type BoardTeamCatalog } from '@/lib/kanban/team-catalog';

export class BoardReadError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

export interface BoardSnapshot {
  cards: KanbanCard[];
  projects: KanbanProject[];
  teamCatalog: BoardTeamCatalog;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function label(value: unknown, maxLength = 512): value is string {
  return typeof value === 'string' && Boolean(value) && value === value.trim()
    && value.length <= maxLength && !/[\u0000-\u001f\u007f]/u.test(value);
}

function invalidSnapshot(): never {
  throw new BoardReadError('Сервер не вернул данные доски. Возможно, требуется повторный вход.', 502);
}

function utcTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

/** Validate relationships against this snapshot, never against a global client cache. */
function readTeamCatalog(value: unknown, projectNames: ReadonlySet<string>): BoardTeamCatalog {
  if (!isRecord(value) || typeof value.status !== 'string' || !['ready', 'partial', 'unavailable'].includes(value.status)
    || (value.coverage !== 'visible-projects' && value.coverage !== 'owner-catalog')
    || !Array.isArray(value.teams) || value.teams.length > 4096
    || !Array.isArray(value.projectTeams) || value.projectTeams.length > 16384
    || !Array.isArray(value.unknownProjectNames) || value.unknownProjectNames.length > 16384) invalidSnapshot();

  const ownerCatalog = value.coverage === 'owner-catalog';
  let provenance: BoardTeamCatalog['provenance'];
  if (ownerCatalog) {
    const source = value.provenance;
    if (!isRecord(source) || source.mode !== 'snapshot' || source.source !== 'exmanager'
      || !utcTimestamp(source.observedAt) || typeof source.sourceRevision !== 'string'
      || !/^[a-f0-9]{40}$/.test(source.sourceRevision) || value.status === 'unavailable') invalidSnapshot();
    provenance = {mode: 'snapshot', source: 'exmanager', observedAt: source.observedAt, sourceRevision: source.sourceRevision};
  } else if (value.provenance !== undefined) invalidSnapshot();

  const teamIds = new Set<string>();
  const teams = value.teams.map(team => {
    if (!isRecord(team) || !label(team.id, 1024) || !label(team.name) || teamIds.has(team.id)) invalidSnapshot();
    teamIds.add(team.id);
    return {id: team.id, name: team.name};
  });
  const linkedTeams = new Set<string>();
  const linkedProjects = new Set<string>();
  const links = new Set<string>();
  const projectTeams = value.projectTeams.map((link): BoardTeamCatalog['projectTeams'][number] => {
    if (!isRecord(link) || !label(link.project) || !projectNames.has(link.project)
      || !label(link.teamId, 1024) || !teamIds.has(link.teamId)) invalidSnapshot();
    let source: BoardTeamCatalog['projectTeams'][number]['source'];
    if (ownerCatalog) {
      if (link.source !== 'exmanager-snapshot') invalidSnapshot();
      source = 'exmanager-snapshot';
    } else {
      if (link.source !== 'native-access' && link.source !== 'relay-scope') invalidSnapshot();
      source = link.source;
    }
    const key = JSON.stringify([link.project, link.teamId]);
    if (links.has(key)) invalidSnapshot();
    links.add(key);
    linkedTeams.add(link.teamId);
    linkedProjects.add(link.project);
    return {project: link.project, teamId: link.teamId, source};
  });
  const unknown = new Set<string>();
  for (const name of value.unknownProjectNames) {
    if (!label(name) || !projectNames.has(name) || linkedProjects.has(name) || unknown.has(name)) invalidSnapshot();
    unknown.add(name);
  }
  const orphanTeams = teams.some(team => !linkedTeams.has(team.id));
  if ([...projectNames].some(name => !linkedProjects.has(name) && !unknown.has(name))) invalidSnapshot();
  if (ownerCatalog) {
    if (value.status !== (unknown.size > 0 || orphanTeams ? 'partial' : 'ready')) invalidSnapshot();
  } else if (orphanTeams
    || (value.status === 'ready' && unknown.size > 0)
    || (value.status === 'partial' && (!linkedProjects.size || !unknown.size))
    || (value.status === 'unavailable' && linkedProjects.size > 0)) invalidSnapshot();

  return {
    status: value.status as BoardTeamCatalog['status'],
    coverage: ownerCatalog ? 'owner-catalog' : 'visible-projects',
    ...(provenance ? {provenance} : {}),
    teams,
    projectTeams,
    unknownProjectNames: [...unknown],
  };
}

/** Login HTML and HTTP errors must never masquerade as an empty, current board. */
export async function readBoardSnapshot(response: Response): Promise<BoardSnapshot> {
  if (!response.ok) {
    const message = response.status === 401 || response.status === 403
      ? 'Доступ к доске не подтверждён. Войдите в свой аккаунт и обновите данные.'
      : response.status === 429
        ? 'Сервис ограничил частоту запросов (429). Данные пока не обновлены.'
        : 'Не удалось обновить доску. Актуальное состояние неизвестно.';
    throw new BoardReadError(message, response.status);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!isRecord(body) || !Array.isArray(body.cards)
    || body.cards.some(card => !isRecord(card) || typeof card.id !== 'string' || !Number.isSafeInteger(card.version))
    || ('projects' in body && (!Array.isArray(body.projects) || body.projects.some(project =>
      !isRecord(project) || !label(project.id) || !label(project.externalKey) || !label(project.name))))) invalidSnapshot();

  const cards = body.cards as KanbanCard[];
  const projects = (body.projects ?? []) as KanbanProject[];
  const projectNames = new Set([
    ...cards.map(card => typeof card.project === 'string' ? card.project.trim() : ''),
    ...projects.map(project => project.name),
  ].filter(Boolean));
  const teamCatalog = body.teamCatalog === undefined
    ? unavailableTeamCatalog([...projectNames])
    : readTeamCatalog(body.teamCatalog, projectNames);
  return {cards, projects, teamCatalog};
}
