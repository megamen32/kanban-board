import fs from "node:fs";
import path from "node:path";
import { NIKITA_ACTOR } from "./transition-policy";

/**
 * Per-project approval source.
 *
 * The ExManager relay scope catalog is the only per-project membership
 * catalog the Board trusts: it binds a Kanban project to the team that owns
 * it and lists that team's members. `boardLogins` is the single optional
 * field that carries a member's Board login; it is the only place where a
 * project member is tied to a Board account.
 */
export interface RelayScopeTeam {
  id: string;
  kanbanProjects: string[];
  memberTelegramUserIds: string[];
  boardLogins?: Record<string, string>;
}

export interface RelayScopeCatalog {
  schemaVersion: number;
  owner: { telegramUserId: string };
  teams: RelayScopeTeam[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A catalog label: project, team and chat names keep their spaces. */
function label(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 200 || /[\u0000-\u001f]/u.test(value)) {
    throw new Error(`scope catalog ${name} is invalid`);
  }
  return value.trim();
}

/** A board login or a Telegram id: no spaces, written to `requires_approval_from` as configured. */
function identifier(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 64 || /[\s\u0000-\u001f]/u.test(value)) {
    throw new Error(`scope catalog ${name} is invalid`);
  }
  return value.trim();
}

function labelList(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.length > 64) throw new Error(`scope catalog ${name} is invalid`);
  return value.map((item, index) => label(item, `${name}[${index}]`));
}

function identifierList(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.length > 64) throw new Error(`scope catalog ${name} is invalid`);
  return value.map((item, index) => identifier(item, `${name}[${index}]`));
}

/** Unknown fields are ignored; a malformed used field fails closed. */
export function parseRelayScopeCatalog(value: unknown): RelayScopeCatalog {
  if (!isRecord(value)) throw new Error("scope catalog is invalid");
  if (value.schemaVersion !== 1) throw new Error("scope catalog schemaVersion is unsupported");
  if (!isRecord(value.owner)) throw new Error("scope catalog owner is invalid");
  const owner = { telegramUserId: identifier(value.owner.telegramUserId, "owner.telegramUserId") };
  if (!Array.isArray(value.teams) || !value.teams.length) throw new Error("scope catalog teams is invalid");
  const teams = value.teams.map((raw, index): RelayScopeTeam => {
    if (!isRecord(raw)) throw new Error(`scope catalog teams[${index}] is invalid`);
    const boardLogins: Record<string, string> = {};
    if (raw.boardLogins !== undefined) {
      if (!isRecord(raw.boardLogins)) throw new Error(`scope catalog teams[${index}].boardLogins is invalid`);
      for (const [member, login] of Object.entries(raw.boardLogins)) {
        boardLogins[identifier(member, `teams[${index}].boardLogins key`)] = identifier(login, `teams[${index}].boardLogins login`);
      }
    }
    return {
      id: label(raw.id, `teams[${index}].id`),
      kanbanProjects: labelList(raw.kanbanProjects, `teams[${index}].kanbanProjects`),
      memberTelegramUserIds: identifierList(raw.memberTelegramUserIds, `teams[${index}].memberTelegramUserIds`),
      ...(Object.keys(boardLogins).length ? { boardLogins } : {}),
    };
  });
  return { schemaVersion: 1, owner, teams };
}

/** The scope catalog path is server configuration, never request data. */
export function relayScopeCatalogFile(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const configured = env.EXMANAGER_RELAY_SCOPE_CATALOG_FILE?.trim();
  return configured ? configured : path.join(process.cwd(), "config", "relay-team-scopes.v1.json");
}

/** An absent catalog means no per-project second reviewer; a broken one fails closed. */
export function loadRelayScopeCatalog(file: string): RelayScopeCatalog | null {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error("scope catalog is unreadable");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("scope catalog is invalid JSON");
  }
  return parseRelayScopeCatalog(parsed);
}

/**
 * The project's second reviewer is the configured Board login of a team member
 * who is not the owner. A project without that mapping has no second reviewer.
 */
export function secondReviewerForProject(catalog: RelayScopeCatalog | null, project: string): string | undefined {
  if (!catalog) return undefined;
  const team = catalog.teams.find(candidate => candidate.kanbanProjects.includes(project));
  if (!team) return undefined;
  for (const memberId of team.memberTelegramUserIds) {
    if (memberId === catalog.owner.telegramUserId) continue;
    const login = team.boardLogins?.[memberId];
    if (!login || login === NIKITA_ACTOR) continue;
    return login;
  }
  return undefined;
}

/** Approval list of a new integrator card: the owner plus the project reviewer. */
export function approvalListForProject(project: string, options: { catalogFile?: string } = {}): string[] {
  const catalog = loadRelayScopeCatalog(options.catalogFile ?? relayScopeCatalogFile());
  const second = secondReviewerForProject(catalog, project);
  return second ? [NIKITA_ACTOR, second] : [NIKITA_ACTOR];
}
