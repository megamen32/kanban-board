import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { v4 as uuidv4 } from 'uuid';
import { DEFAULT_COLUMNS, PLANNING_VERSION } from './types';
import type { KanbanCard, KanbanCardUpdates as TypedKanbanCardUpdates, KanbanColumn, PlanningEvidence, PlanningType, Priority } from './types';

const TASKS_DIR = process.env.TASKS_DIR || path.join(process.cwd(), 'data', 'tasks');
const KNOWN_FRONTMATTER_KEYS = new Set([
  'id', 'title', 'column', 'priority', 'tags', 'order', 'created', 'updated', 'dueAt',
  'version', 'project', 'assignees', 'owner', 'shared', 'planning_version', 'type', 'role', 'accountable',
  'assignee', 'important', 'urgent', 'week', 'big_rock', 'parent', 'scheduled_at',
  'today_rank', 'source', 'needs_review', 'suggested_assignee', 'waiting_for',
  'requires_approval_from', 'completed_by', 'completed_at', 'completion_evidence',
  'approval_evidence',
]);
const PLANNING_FRONTMATTER_KEYS = new Set([
  'planning_version', 'type', 'role', 'accountable', 'assignee', 'important', 'urgent',
  'week', 'big_rock', 'parent', 'scheduled_at', 'today_rank', 'source', 'needs_review',
  'suggested_assignee', 'waiting_for', 'requires_approval_from', 'completed_by',
  'completed_at', 'completion_evidence', 'approval_evidence',
]);
const LEGACY_CARD = Symbol('legacy-card');
const RAW_UNKNOWN_FRONTMATTER = Symbol('raw-unknown-frontmatter');
type RawFrontmatter = Record<string, unknown> & {
  [LEGACY_CARD]?: boolean;
  [RAW_UNKNOWN_FRONTMATTER]?: string;
};
const PLANNING_UPDATE_KEYS = new Set([
  'owner', 'shared', 'planningVersion', 'type', 'role', 'accountable', 'assignee', 'important', 'urgent',
  'week', 'bigRock', 'parent', 'scheduledAt', 'todayRank', 'source', 'needsReview',
  'suggestedAssignee', 'waitingFor', 'requiresApprovalFrom', 'completedBy', 'completedAt',
  'completionEvidence', 'approvalEvidence',
]);

function ensureDir(tasksDir = TASKS_DIR) {
  if (!fs.existsSync(/*turbopackIgnore: true*/ tasksDir)) {
    fs.mkdirSync(/*turbopackIgnore: true*/ tasksDir, { recursive: true });
  }
}

function sanitizeFileName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9а-яА-ЯёЁ\-_. ]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim() || 'untitled';
}

function slugify(title: string, id: string): string {
  const slug = sanitizeFileName(title);
  const shortId = id.split('-')[0];
  return `${slug}-${shortId}.md`;
}

export function getAllCards(tasksDir = TASKS_DIR): KanbanCard[] {
  ensureDir(tasksDir);
  const files: string[] = [];
  const visit = (dir: string, relative = '') => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const entryRelative = path.join(relative, entry.name);
      if (entry.isDirectory()) visit(path.join(dir, entry.name), entryRelative);
      else if (entry.isFile() && entry.name.endsWith('.md')) files.push(entryRelative);
    }
  };
  visit(tasksDir);
  const cards: KanbanCard[] = [];

  for (const file of files) {
    try {
      const card = readCardFile(path.join(tasksDir, file), tasksDir);
      if (card) cards.push(card);
    } catch (e) {
      console.error(`Error reading ${file}:`, e);
    }
  }

  return cards.sort((a, b) => a.order - b.order);
}

export function readCardFile(filePath: string, tasksDir = TASKS_DIR): KanbanCard | null {
  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, 'utf-8');
  const { data, content } = matter(raw);
  const fileName = path.relative(tasksDir, filePath);
  const legacyName = path.basename(filePath).replace(/\.md$/, '');
  const relativeDirectory = path.dirname(fileName);
  const legacyProject = relativeDirectory !== '.' ? relativeDirectory.split(path.sep)[0] : legacyName;
  const planning = parsePlanningMetadata(data);
  const rawFrontmatter = Object.fromEntries(
    Object.entries(data).filter(([key]) => !KNOWN_FRONTMATTER_KEYS.has(key)),
  ) as RawFrontmatter;
  Object.defineProperty(rawFrontmatter, LEGACY_CARD, {
    value: !Object.keys(data).some(key => PLANNING_FRONTMATTER_KEYS.has(key)),
    enumerable: false,
    writable: true,
  });
  Object.defineProperty(rawFrontmatter, RAW_UNKNOWN_FRONTMATTER, {
    value: extractUnknownFrontmatter(raw, KNOWN_FRONTMATTER_KEYS),
    enumerable: false,
    writable: true,
  });

  const column = enumField(data.column, 'column', DEFAULT_COLUMNS.map(item => item.id), 'inbox');
  // Older personal notes used free-form priority labels; keep them visible.
  const priority = enumField(data.priority, 'priority', ['low', 'medium', 'high', 'critical'] as const, 'medium', true);

  return {
    id: data.id || legacyName,
    title: data.title || legacyName.replace(/-[^-]+$/, '').replace(/-/g, ' '),
    description: content.trim(),
    column,
    priority,
    tags: Array.isArray(data.tags) ? data.tags : [],
    order: typeof data.order === 'number' ? data.order : 0,
    created: data.created || new Date(fs.statSync(/*turbopackIgnore: true*/ filePath).birthtime).toISOString(),
    updated: data.updated || new Date(fs.statSync(/*turbopackIgnore: true*/ filePath).mtime).toISOString(),
    dueAt: typeof data.dueAt === 'string' ? data.dueAt : undefined,
    fileName,
    version: typeof data.version === 'number' ? data.version : 1,
    project: typeof data.project === 'string' && data.project.trim() ? data.project.trim() : legacyProject,
    assignees: Array.isArray(data.assignees) ? data.assignees.map(String) : [],
    owner: optionalString(data, 'owner') ?? 'nikita',
    shared: booleanField(data, 'shared', false),
    ...planning,
    rawFrontmatter,
  };
}

export function createCard(title: string, description: string = '', column: KanbanColumn = 'inbox', priority: Priority = 'medium', tags: string[] = [], project?: string, assignees: string[] = [], tasksDir = TASKS_DIR, dueAt?: string): KanbanCard {
  if (!project?.trim()) throw new Error('project is required for new cards');
  ensureDir(tasksDir);
  const id = uuidv4();
  const now = new Date().toISOString();
  const existing = getAllCards(tasksDir).filter(c => c.column === column);
  const maxOrder = existing.length > 0 ? Math.max(...existing.map(c => c.order)) + 1 : 0;

  const card: KanbanCard = {
    id,
    title,
    description,
    column,
    priority,
    tags,
    order: maxOrder,
    created: now,
    updated: now,
    ...(dueAt ? { dueAt } : {}),
    fileName: slugify(title, id),
    version: 1,
    project: project.trim(),
    assignees,
    owner: 'nikita',
    shared: false,
    ...defaultPlanningMetadata(),
  };

  writeCard(card, tasksDir);
  return card;
}

export type KanbanCardUpdates = TypedKanbanCardUpdates & Partial<Pick<KanbanCard, 'version'>>;

export function updateCard(id: string, updates: KanbanCardUpdates, expectedVersion?: number, tasksDir = TASKS_DIR): KanbanCard | { conflict: true; serverCard: KanbanCard } {
  const card = findCardById(id, tasksDir);
  if (!card) throw new Error(`Card ${id} not found`);
  if (updates.project !== undefined && !updates.project.trim()) throw new Error('project is required');

  // Conflict detection
  if (expectedVersion !== undefined && card.version !== expectedVersion) {
    return { conflict: true, serverCard: card };
  }

  const { dueAt: dueAtUpdate, ...otherUpdates } = updates;
  const normalizedUpdates = Object.fromEntries(
    Object.entries(otherUpdates).map(([key, value]) => [key, value === null ? undefined : value]),
  ) as Omit<KanbanCardUpdates, 'dueAt'>;
  const planningEdit = Object.entries(normalizedUpdates).some(([key, value]) =>
    PLANNING_UPDATE_KEYS.has(key) && isExplicitPlanningUpdate(key, value));
  const rawFrontmatter = card.rawFrontmatter;
  if (planningEdit && legacyMarker(rawFrontmatter)) {
    updatedRawFrontmatter(card, true);
  }
  const updated: KanbanCard = {
    ...card,
    ...normalizedUpdates,
    ...(dueAtUpdate !== undefined && dueAtUpdate !== null ? { dueAt: dueAtUpdate } : {}),
    updated: new Date().toISOString(),
    version: card.version + 1,
  };
  if (dueAtUpdate === null) delete updated.dueAt;

  // Validate before removing a renamed file so malformed planning updates are atomic.
  buildFrontmatter(updated);

  // If title changed, rename file
  if (updates.title && updates.title !== card.title) {
    const oldPath = path.join(tasksDir, card.fileName);
    if (fs.existsSync(oldPath)) fs.unlinkSync(/*turbopackIgnore: true*/ oldPath);
    updated.fileName = slugify(updates.title, id);
  }

  writeCard(updated, tasksDir);
  return updated;
}

export function deleteCard(id: string, tasksDir = TASKS_DIR): boolean {
  const card = findCardById(id, tasksDir);
  if (!card) return false;

  const filePath = path.join(tasksDir, card.fileName);
  if (fs.existsSync(filePath)) fs.unlinkSync(/*turbopackIgnore: true*/ filePath);
  return true;
}

export function moveCard(id: string, newColumn: KanbanColumn, newOrder?: number, tasksDir = TASKS_DIR): KanbanCard | { conflict: true; serverCard: KanbanCard } {
  return updateCard(id, {
    column: newColumn,
    ...(newOrder !== undefined ? { order: newOrder } : {}),
  }, undefined, tasksDir);
}

export function reorderColumn(column: KanbanColumn, cardIds: string[], tasksDir = TASKS_DIR): KanbanCard[] {
  const results: KanbanCard[] = [];
  cardIds.forEach((id, index) => {
    const card = findCardById(id, tasksDir);
    if (card && card.column === column) {
      const updated = updateCard(id, { order: index }, undefined, tasksDir) as KanbanCard;
      results.push(updated);
    }
  });
  return results;
}

export function findCardById(id: string, tasksDir = TASKS_DIR): KanbanCard | null {
  ensureDir(tasksDir);
  const files = getAllCards(tasksDir);
  return files.find(card => card.id === id) ?? null;
}

export function importExistingFile(filePath: string, tasksDir = TASKS_DIR): KanbanCard | null {
  if (!fs.existsSync(filePath) || !filePath.endsWith('.md')) return null;

  const card = readCardFile(filePath, tasksDir);
  if (!card) return null;

  // Check if already imported (by id or filename)
  const existing = findCardById(card.id, tasksDir);
  if (existing) return existing;

  // Assign UUID if missing
  if (!card.id || card.id === card.fileName.replace('.md', '')) {
    card.id = uuidv4();
  }

  // Write to tasks dir
  const destPath = path.join(tasksDir, slugify(card.title, card.id));
  const frontmatter = buildFrontmatter(card);
  fs.writeFileSync(destPath, frontmatter + (card.description ? '\n' + card.description : ''));

  return card;
}

export function getTasksDir(tasksDir = TASKS_DIR): string {
  return tasksDir;
}

function buildFrontmatter(card: KanbanCard): string {
  validatePlanningMetadata(card);
  enumField(card.column, 'column', DEFAULT_COLUMNS.map(item => item.id), 'inbox');
  enumField(card.priority, 'priority', ['low', 'medium', 'high', 'critical'] as const, 'medium');
  const data: Record<string, unknown> = {
    id: card.id,
    title: card.title,
    column: card.column,
    priority: card.priority,
    tags: card.tags,
    order: card.order,
    created: card.created,
    updated: card.updated,
    version: card.version,
    project: card.project,
    assignees: card.assignees,
    owner: card.owner ?? 'nikita',
    shared: card.shared ?? false,
  };
  if (!legacyMarker(card.rawFrontmatter)) {
    Object.assign(data, {
      planning_version: card.planningVersion ?? PLANNING_VERSION,
      type: card.type ?? 'action',
      important: card.important ?? false,
      urgent: card.urgent ?? false,
      big_rock: card.bigRock ?? false,
      needs_review: card.needsReview ?? false,
      waiting_for: card.waitingFor ?? [],
      requires_approval_from: card.requiresApprovalFrom ?? [],
      completion_evidence: card.completionEvidence ?? [],
      approval_evidence: card.approvalEvidence ?? [],
    });
  }
  if (card.dueAt) data.dueAt = card.dueAt;
  if (card.role !== undefined) data.role = card.role;
  if (card.accountable !== undefined) data.accountable = card.accountable;
  if (card.assignee !== undefined) data.assignee = card.assignee;
  if (card.week !== undefined) data.week = card.week;
  if (card.parent !== undefined) data.parent = card.parent;
  if (card.scheduledAt !== undefined) data.scheduled_at = card.scheduledAt;
  if (card.todayRank !== undefined) data.today_rank = card.todayRank;
  if (card.source !== undefined) data.source = card.source;
  if (card.suggestedAssignee !== undefined) data.suggested_assignee = card.suggestedAssignee;
  if (card.completedBy !== undefined) data.completed_by = card.completedBy;
  if (card.completedAt !== undefined) data.completed_at = card.completedAt;

  const generated = matter.stringify('', data).trimEnd();
  const rawUnknown = (card.rawFrontmatter as RawFrontmatter | undefined)?.[RAW_UNKNOWN_FRONTMATTER];
  if (!rawUnknown) return generated;

  const closingDelimiter = generated.lastIndexOf('\n---');
  if (closingDelimiter < 0) return generated;
  return `${generated.slice(0, closingDelimiter)}\n${rawUnknown}${generated.slice(closingDelimiter)}`;
}

function writeCard(card: KanbanCard, tasksDir = TASKS_DIR): void {
  ensureDir(tasksDir);
  const filePath = path.join(tasksDir, card.fileName);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const frontmatter = buildFrontmatter(card);
  fs.writeFileSync(filePath, frontmatter + (card.description ? '\n' + card.description : ''));
}

interface PlanningMetadata {
  planningVersion: 1;
  type: PlanningType;
  role?: string;
  accountable?: string;
  assignee?: string;
  important: boolean;
  urgent: boolean;
  week?: string;
  bigRock: boolean;
  parent?: string;
  scheduledAt?: string;
  todayRank?: 1 | 2 | 3;
  source?: string;
  needsReview: boolean;
  suggestedAssignee?: string;
  waitingFor: string[];
  requiresApprovalFrom: string[];
  completedBy?: string;
  completedAt?: string;
  completionEvidence: PlanningEvidence[];
  approvalEvidence: PlanningEvidence[];
}

function defaultPlanningMetadata(): PlanningMetadata {
  return {
    planningVersion: PLANNING_VERSION,
    type: 'action',
    important: false,
    urgent: false,
    bigRock: false,
    needsReview: false,
    waitingFor: [],
    requiresApprovalFrom: [],
    completionEvidence: [],
    approvalEvidence: [],
  };
}

/** Mark a legacy card as explicitly planning-edited without exposing an internal YAML key. */
function updatedRawFrontmatter(card: KanbanCard, planning: boolean): void {
  const rawFrontmatter = (card.rawFrontmatter ?? {}) as RawFrontmatter;
  if (rawFrontmatter[LEGACY_CARD] === !planning) return;
  const copy = { ...rawFrontmatter } as RawFrontmatter;
  Object.defineProperty(copy, LEGACY_CARD, { value: !planning, enumerable: false, writable: true });
  Object.defineProperty(copy, RAW_UNKNOWN_FRONTMATTER, {
    value: rawFrontmatter[RAW_UNKNOWN_FRONTMATTER],
    enumerable: false,
    writable: true,
  });
  card.rawFrontmatter = copy;
}

function legacyMarker(rawFrontmatter: Record<string, unknown> | undefined): boolean {
  return Boolean(rawFrontmatter && (rawFrontmatter as RawFrontmatter)[LEGACY_CARD]);
}

/** Returns whether a planning update carries a non-default user choice. */
function isExplicitPlanningUpdate(key: string, value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false;
  if (key === 'type') return value !== 'action';
  if (key === 'important' || key === 'urgent' || key === 'bigRock' || key === 'needsReview') return value === true;
  if (key === 'waitingFor' || key === 'requiresApprovalFrom' || key === 'completionEvidence' || key === 'approvalEvidence') {
    return Array.isArray(value) && value.length > 0;
  }
  return true;
}

/** Extract unknown top-level YAML entries without parsing or reserializing their source text. */
function extractUnknownFrontmatter(raw: string, knownKeys: Set<string>): string {
  const match = raw.match(/^---[ \t]*(?:\r\n|\n|\r)([\s\S]*?)(?:\r\n|\n|\r)---(?:\r\n|\n|\r|$)/);
  if (!match) return '';

  const body = match[1];
  const lines = body.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g)?.filter(Boolean) ?? [];
  const unknownLines: string[] = [];
  let pendingTrivia: string[] = [];
  let collectingUnknown = false;

  for (const line of lines) {
    const content = line.replace(/(?:\r\n|\n|\r)$/, '');
    const topLevelKey = parseTopLevelYamlKey(content);
    if (topLevelKey !== undefined) {
      collectingUnknown = !knownKeys.has(topLevelKey);
      if (collectingUnknown) unknownLines.push(...pendingTrivia);
      pendingTrivia = [];
      if (collectingUnknown) unknownLines.push(line);
      continue;
    }
    if (collectingUnknown) {
      unknownLines.push(line);
    } else if (content.trim() === '' || /^\s*#/.test(content)) {
      pendingTrivia.push(line);
    } else {
      pendingTrivia = [];
    }
  }

  return unknownLines.join('').replace(/(?:\r\n|\n|\r)$/, '');
}

/** Identify a top-level YAML mapping key while allowing colons inside quoted keys. */
function parseTopLevelYamlKey(content: string): string | undefined {
  const doubleQuoted = content.match(/^"((?:[^"\\]|\\.)*)":(?:[ \t].*)?$/);
  if (doubleQuoted) {
    try {
      return JSON.parse(`"${doubleQuoted[1]}"`) as string;
    } catch {
      return doubleQuoted[1];
    }
  }

  const singleQuoted = content.match(/^'((?:[^']|'')*)':(?:[ \t].*)?$/);
  if (singleQuoted) return singleQuoted[1].replace(/''/g, "'");

  return content.match(/^([^\s:#][^:]*):(?:[ \t].*)?$/)?.[1]?.trim();
}

function invalidPlanningField(field: string, detail: string): Error {
  return new Error(`Invalid planning field "${field}": ${detail}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(data: Record<string, unknown>, field: string): string | undefined {
  const value = data[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) throw invalidPlanningField(field, 'expected a non-empty string');
  return value;
}

function booleanField(data: Record<string, unknown>, field: string, fallback: boolean): boolean {
  const value = data[field];
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw invalidPlanningField(field, 'expected a boolean');
  return value;
}

function enumField<T extends string>(value: unknown, field: string, values: readonly T[], fallback: T, tolerateUnknown = false): T {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !values.includes(value as T)) {
    if (tolerateUnknown) return fallback;
    throw invalidPlanningField(field, `expected one of ${values.join(', ')}`);
  }
  return value as T;
}

function optionalEnumField<T extends string>(value: unknown, field: string, values: readonly T[]): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw invalidPlanningField(field, `expected one of ${values.join(', ')}`);
  }
  return value as T;
}

function stringArrayField(data: Record<string, unknown>, field: string): string[] {
  const value = data[field];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) {
    throw invalidPlanningField(field, 'expected an array of non-empty strings');
  }
  return [...value];
}

function evidenceArrayField(data: Record<string, unknown>, field: string): PlanningEvidence[] {
  const value = data[field];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(item => !isRecord(item))) {
    throw invalidPlanningField(field, 'expected an array of objects');
  }
  return value as PlanningEvidence[];
}

function rfc3339WithOffset(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw invalidPlanningField(field, 'expected RFC3339 timestamp with offset');
  }
  return value;
}

function parsePlanningMetadata(data: Record<string, unknown>): PlanningMetadata {
  const planningVersion = data.planning_version;
  if (planningVersion !== undefined && planningVersion !== PLANNING_VERSION) {
    throw invalidPlanningField('planning_version', 'only version 1 is supported');
  }
  const type = enumField(data.type, 'type', ['outcome', 'action'] as const, 'action');
  const todayRank = data.today_rank;
  if (todayRank !== undefined && (typeof todayRank !== 'number' || !Number.isInteger(todayRank) || todayRank < 1 || todayRank > 3)) {
    throw invalidPlanningField('today_rank', 'expected an integer from 1 to 3');
  }
  const week = data.week;
  if (week !== undefined && (typeof week !== 'string' || !/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/.test(week))) {
    throw invalidPlanningField('week', 'expected an ISO week such as 2026-W33');
  }

  return {
    ...defaultPlanningMetadata(),
    type: (type as PlanningType | undefined) ?? 'action',
    role: optionalString(data, 'role'),
    accountable: optionalString(data, 'accountable'),
    assignee: optionalString(data, 'assignee'),
    important: booleanField(data, 'important', false),
    urgent: booleanField(data, 'urgent', false),
    week: week as string | undefined,
    bigRock: booleanField(data, 'big_rock', false),
    parent: optionalString(data, 'parent'),
    scheduledAt: rfc3339WithOffset(data.scheduled_at, 'scheduled_at'),
    todayRank: todayRank as 1 | 2 | 3 | undefined,
    source: optionalString(data, 'source'),
    needsReview: booleanField(data, 'needs_review', false),
    suggestedAssignee: optionalString(data, 'suggested_assignee'),
    waitingFor: stringArrayField(data, 'waiting_for'),
    requiresApprovalFrom: stringArrayField(data, 'requires_approval_from'),
    completedBy: optionalString(data, 'completed_by'),
    completedAt: rfc3339WithOffset(data.completed_at, 'completed_at'),
    completionEvidence: evidenceArrayField(data, 'completion_evidence'),
    approvalEvidence: evidenceArrayField(data, 'approval_evidence'),
  };
}

function validatePlanningMetadata(card: KanbanCard): void {
  parsePlanningMetadata({
    planning_version: card.planningVersion,
    type: card.type,
    role: card.role,
    accountable: card.accountable,
    assignee: card.assignee,
    important: card.important,
    urgent: card.urgent,
    week: card.week,
    big_rock: card.bigRock,
    parent: card.parent,
    scheduled_at: card.scheduledAt,
    today_rank: card.todayRank,
    source: card.source,
    needs_review: card.needsReview,
    suggested_assignee: card.suggestedAssignee,
    waiting_for: card.waitingFor,
    requires_approval_from: card.requiresApprovalFrom,
    completed_by: card.completedBy,
    completed_at: card.completedAt,
    completion_evidence: card.completionEvidence,
    approval_evidence: card.approvalEvidence,
  });
}
