import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { v4 as uuidv4 } from 'uuid';
import { DEFAULT_COLUMNS, parseCatalogTaskLink, PLANNING_VERSION } from './types';
import { cancelSourceOperationForCardLocked, withSourceOperationLock } from './source-operation';
import type { CatalogTaskLink, KanbanCard, KanbanCardUpdates as TypedKanbanCardUpdates, KanbanColumn, PlanningEvidence, PlanningType, Priority, SourceAdmissionBinding, TaskExecutionContinuation, TaskExecutionReceipt, TaskExecutionSessionControl, TaskExecutionSessionControls, TaskResult, TaskReviewRecord } from './types';

const TASKS_DIR = process.env.TASKS_DIR || path.join(process.cwd(), 'data', 'tasks');
const KNOWN_FRONTMATTER_KEYS = new Set([
  'id', 'title', 'column', 'priority', 'tags', 'order', 'created', 'updated', 'dueAt',
  'version', 'project', 'assignees', 'owner', 'shared', 'planning_version', 'type', 'role', 'accountable',
  'assignee', 'important', 'urgent', 'week', 'big_rock', 'parent', 'scheduled_at',
  'today_rank', 'source', 'needs_review', 'suggested_assignee', 'waiting_for',
  'requires_approval_from', 'completed_by', 'completed_at', 'completion_evidence',
  'approval_evidence', 'result_history', 'review_history', 'next_action',
  'source_admission', 'catalog_task_link', 'task_execution_history',
]);
const PLANNING_FRONTMATTER_KEYS = new Set([
  'planning_version', 'type', 'role', 'accountable', 'assignee', 'important', 'urgent',
  'week', 'big_rock', 'parent', 'scheduled_at', 'today_rank', 'source', 'needs_review',
  'suggested_assignee', 'waiting_for', 'requires_approval_from', 'completed_by',
  'completed_at', 'completion_evidence', 'approval_evidence', 'result_history', 'review_history', 'next_action',
]);
const LEGACY_CARD = Symbol('legacy-card');
const RAW_UNKNOWN_FRONTMATTER = Symbol('raw-unknown-frontmatter');
const MAX_FILENAME_COMPONENT_BYTES = 255;
const MAX_TEMP_SUFFIX_BYTES = Buffer.byteLength(`.${Number.MAX_SAFE_INTEGER}.${'0'.repeat(36)}.tmp`, 'utf8');
type RawFrontmatter = Record<string, unknown> & {
  [LEGACY_CARD]?: boolean;
  [RAW_UNKNOWN_FRONTMATTER]?: string;
};
const PLANNING_UPDATE_KEYS = new Set([
  'owner', 'shared', 'planningVersion', 'type', 'role', 'accountable', 'assignee', 'important', 'urgent',
  'week', 'bigRock', 'parent', 'scheduledAt', 'todayRank', 'source', 'needsReview',
  'suggestedAssignee', 'waitingFor', 'requiresApprovalFrom', 'completedBy', 'completedAt',
  'completionEvidence', 'approvalEvidence', 'resultHistory', 'reviewHistory', 'nextAction',
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
  const suffix = `-${id.split('-')[0]}.md`;
  // writeCard appends .<pid>.<uuid>.tmp before rename; reserve its maximum
  // byte budget so long UTF-8 titles work on filesystems with NAME_MAX=255.
  const budget = MAX_FILENAME_COMPONENT_BYTES - MAX_TEMP_SUFFIX_BYTES - Buffer.byteLength(suffix, 'utf8');
  let slug = '', bytes = 0;
  for (const char of sanitizeFileName(title)) {
    const size = Buffer.byteLength(char, 'utf8');
    if (bytes + size > budget) break;
    slug += char; bytes += size;
  }
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
  const cardId = data.id || legacyName;
  const catalogLink = data.catalog_task_link !== undefined ? parseCatalogTaskLink(data.catalog_task_link) : undefined;
  if (catalogLink && catalogLink.taskId !== cardId) throw new Error('canonical catalog link task ID does not match Markdown card');
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
    id: cardId,
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
    ...(data.source_admission && typeof data.source_admission === 'object' ? { sourceAdmission: data.source_admission as SourceAdmissionBinding } : {}),
    ...(catalogLink ? { catalogLink } : {}),
    ...(data.task_execution_history !== undefined ? { taskExecutionHistory: taskExecutionHistoryField(data.task_execution_history) } : {}),
    rawFrontmatter,
  };
}

export function createCard(title: string, description: string = '', column: KanbanColumn = 'inbox', priority: Priority = 'medium', tags: string[] = [], project?: string, assignees: string[] = [], tasksDir = TASKS_DIR, dueAt?: string): KanbanCard {
  return withSourceOperationLock(tasksDir, () => createCardRecord(title, description, column, priority, tags, project, assignees, tasksDir, dueAt));
}

function createCardRecord(title: string, description: string, column: KanbanColumn, priority: Priority, tags: string[], project: string | undefined, assignees: string[], tasksDir: string, dueAt?: string, id = uuidv4(), sourceAdmission?: SourceAdmissionBinding, sourceOutcome?: { source: string; needsReview: boolean }): KanbanCard {
  if (!project?.trim()) throw new Error('project is required for new cards');
  ensureDir(tasksDir);
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
    ...(sourceAdmission ? { sourceAdmission } : {}),
    owner: 'nikita',
    shared: false,
    ...defaultPlanningMetadata(),
    ...(sourceOutcome ? { source: sourceOutcome.source, needsReview: sourceOutcome.needsReview } : {}),
  };

  writeCard(card, tasksDir);
  return card;
}

/** Write with the ID reserved in the board journal; caller must hold the board writer lock. */
export function createAdmittedCard(input: {
  id: string; title: string; description: string; project: string;
  priority: Priority; assignees: string[]; dueAt?: string; sourceAdmission: SourceAdmissionBinding;
}, tasksDir = TASKS_DIR): KanbanCard {
  const classification = input.sourceAdmission.classification;
  const column = classification === 'idea' ? 'someday' : 'inbox';
  const tags = classification === 'explicit-task' ? ['source-admitted']
    : classification === 'idea' ? ['source-idea'] : ['source-review'];
  return createCardRecord(input.title, input.description, column, input.priority, tags, input.project,
    input.assignees, tasksDir, input.dueAt, input.id, input.sourceAdmission,
    classification === 'explicit-task' ? undefined : {
      source: `source:${classification}`, needsReview: classification === 'ambiguous',
    });
}

export type KanbanCardUpdates = TypedKanbanCardUpdates & Partial<Pick<KanbanCard, 'version'>>;

export function updateCard(id: string, updates: KanbanCardUpdates, expectedVersion?: number, tasksDir = TASKS_DIR): KanbanCard | { conflict: true; serverCard: KanbanCard } {
  return withSourceOperationLock(tasksDir, () => updateCardRecord(id, updates, expectedVersion, tasksDir));
}

function updateCardRecord(id: string, updates: KanbanCardUpdates, expectedVersion: number | undefined, tasksDir: string): KanbanCard | { conflict: true; serverCard: KanbanCard } {
  if (Object.hasOwn(updates as object, 'sourceAdmission')) {
    throw new Error('source admission binding is immutable');
  }
  if (Object.hasOwn(updates as object, 'catalogLink')) {
    throw new Error('canonical catalog link is immutable');
  }
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
  ) as Omit<KanbanCardUpdates, 'dueAt' | 'nextAction'> & { nextAction?: string };
  if (normalizedUpdates.taskExecutionHistory !== undefined) {
    normalizedUpdates.taskExecutionHistory = taskExecutionHistoryField(normalizedUpdates.taskExecutionHistory);
  }
  if (normalizedUpdates.parent !== undefined) assertAcyclicParent(id, normalizedUpdates.parent, tasksDir);
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
  if (updates.title && updates.title !== card.title && !card.sourceAdmission) {
    const oldPath = path.join(tasksDir, card.fileName);
    if (fs.existsSync(oldPath)) fs.unlinkSync(/*turbopackIgnore: true*/ oldPath);
    updated.fileName = slugify(updates.title, id);
  }

  writeCard(updated, tasksDir);
  return updated;
}

function assertAcyclicParent(cardId: string, parentId: string | undefined, tasksDir: string): void {
  let current = parentId;
  const visited = new Set([cardId]);
  while (current) {
    if (visited.has(current)) throw new Error('parent_relation_cycle');
    visited.add(current);
    current = findCardById(current, tasksDir)?.parent;
  }
}

export function deleteCard(id: string, tasksDir = TASKS_DIR): boolean {
  return withSourceOperationLock(tasksDir, () => {
    const card = findCardById(id, tasksDir);
    if (!card) return false;
    cancelSourceOperationForCardLocked(card, tasksDir);
    const filePath = path.join(tasksDir, card.fileName);
    if (fs.existsSync(filePath)) fs.unlinkSync(/*turbopackIgnore: true*/ filePath);
    fsyncDirectory(path.dirname(filePath));
    return true;
  });
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
  if (card.sourceAdmission) throw new Error('source admission cards cannot be imported from an external file');

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

export type CatalogTaskLinkWriteResult =
  | { status: 'created' | 'reused'; card: KanbanCard; link: CatalogTaskLink }
  | { status: 'stale' | 'conflict' };

/**
 * Read-only exact replay check serialized with ordinary Board card writers.
 * The sole permitted version delta is the +1 made by this link commit; any
 * later unrelated card edit makes the historical replay stale.
 */
export function readCatalogTaskLinkForReplay(
  cardId: string,
  expectedBoardVersion: number,
  untrustedLink: CatalogTaskLink,
  tasksDir = TASKS_DIR,
): { status: 'reused'; card: KanbanCard; link: CatalogTaskLink } | { status: 'stale' | 'conflict' | 'missing' } {
  const link = parseCatalogTaskLink(untrustedLink);
  if (link.taskId !== cardId || link.boardVersion !== expectedBoardVersion) throw new Error('catalog replay identity does not match requested operation');
  return withSourceOperationLock(tasksDir, () => {
    const card = findCardById(cardId, tasksDir);
    if (!card) return { status: 'missing' };
    if (!card.catalogLink) return { status: 'missing' };
    if (!sameCatalogTaskLink(card.catalogLink, link)) return { status: 'conflict' };
    if (card.version !== expectedBoardVersion + 1) return { status: 'stale' };
    return { status: 'reused', card, link: card.catalogLink };
  });
}

/** Internal persistence boundary. Call only after the canonical owner readback succeeds. */
export function persistCatalogTaskLink(
  cardId: string,
  expectedVersion: number,
  untrustedLink: CatalogTaskLink,
  tasksDir = TASKS_DIR,
): CatalogTaskLinkWriteResult {
  const link = parseCatalogTaskLink(untrustedLink);
  if (link.taskId !== cardId || link.boardVersion !== expectedVersion) throw new Error('catalog link identity does not match CAS target');
  return withSourceOperationLock(tasksDir, () => {
    const card = findCardById(cardId, tasksDir);
    if (!card) throw new Error('catalog link task was not found');
    if (card.catalogLink) {
      if (!sameCatalogTaskLink(card.catalogLink, link)) return { status: 'conflict' };
      return { status: 'reused', card, link: card.catalogLink };
    }
    if (card.version !== expectedVersion) return { status: 'stale' };
    if (getAllCards(tasksDir).some(candidate => candidate.id !== cardId
        && candidate.catalogLink?.operationRef === link.operationRef)) return { status: 'conflict' };

    const updated: KanbanCard = {
      ...card,
      catalogLink: link,
      version: card.version + 1,
      updated: new Date().toISOString(),
    };
    writeCard(updated, tasksDir);
    const readback = findCardById(cardId, tasksDir);
    if (!readback?.catalogLink || !sameCatalogTaskLink(readback.catalogLink, link)) {
      throw new Error('canonical catalog link readback mismatch');
    }
    return { status: 'created', card: readback, link: readback.catalogLink };
  });
}

export function findCatalogTaskLink(cardId: string, tasksDir = TASKS_DIR): CatalogTaskLink | null {
  return findCardById(cardId, tasksDir)?.catalogLink ?? null;
}

function sameCatalogTaskLink(a: CatalogTaskLink, b: CatalogTaskLink): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
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
    ...(card.sourceAdmission ? { source_admission: card.sourceAdmission } : {}),
    ...(card.catalogLink ? { catalog_task_link: parseCatalogTaskLink(card.catalogLink) } : {}),
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
  data.result_history = card.resultHistory ?? [];
  data.review_history = card.reviewHistory ?? [];
  if (card.taskExecutionHistory?.length) data.task_execution_history = card.taskExecutionHistory;
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
  if (card.nextAction !== undefined) data.next_action = card.nextAction;

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
  const tmp = `${filePath}.${process.pid}.${uuidv4()}.tmp`;
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, frontmatter + (card.description ? '\n' + card.description : ''));
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, filePath);
  fsyncDirectory(path.dirname(filePath));
}

function fsyncDirectory(dir: string): void {
  const fd = fs.openSync(dir, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
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
  resultHistory: TaskResult[];
  reviewHistory: TaskReviewRecord[];
  nextAction?: string;
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
    resultHistory: [],
    reviewHistory: [],
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

function taskExecutionHistoryField(value: unknown): TaskExecutionReceipt[] {
  if (!Array.isArray(value) || value.length > 32) throw invalidPlanningField('task_execution_history', 'expected at most 32 execution receipts');
  const seen = new Set<string>();
  return value.map((entry, index) => {
    const field = `task_execution_history[${index}]`;
    const continuations = taskExecutionContinuationsField(entry, field);
    const sessionControls = taskExecutionSessionControlsField(entry, field);
    if (!isRecord(entry)
      || typeof entry.operationId !== 'string' || !/^[a-f0-9]{64}$/.test(entry.operationId)
      || seen.has(entry.operationId)
      || typeof entry.requestHash !== 'string' || !/^[a-f0-9]{64}$/.test(entry.requestHash)
      || !Number.isSafeInteger(entry.lastBoardVersion) || (entry.lastBoardVersion as number) < 1
      || typeof entry.createInputId !== 'string' || !/^[a-f0-9]{64}$/.test(entry.createInputId)
      || typeof entry.messageInputId !== 'string' || !/^[a-f0-9]{64}$/.test(entry.messageInputId)
      || !['intent', 'create-unknown', 'created', 'dispatch-unknown', 'running', 'waiting', 'stopped', 'result'].includes(String(entry.phase))
      || typeof entry.hostId !== 'string' || !entry.hostId.trim() || entry.hostId.length > 512
      || !['codex', 'zcode', 'opencode'].includes(String(entry.harness))
      || typeof entry.startedBy !== 'string' || !entry.startedBy.trim() || entry.startedBy.length > 256
      || entry.requestedBy !== undefined && (typeof entry.requestedBy !== 'string' || !entry.requestedBy.trim() || entry.requestedBy.length > 256 || /[\x00-\x1f\x7f]/.test(entry.requestedBy))
      || typeof entry.createdAt !== 'string' || Number.isNaN(Date.parse(entry.createdAt))
      || typeof entry.updatedAt !== 'string' || Number.isNaN(Date.parse(entry.updatedAt))
      || entry.nativeSessionId !== undefined && (typeof entry.nativeSessionId !== 'string' || !entry.nativeSessionId.trim() || entry.nativeSessionId.length > 512)
      || entry.nativeTurnId !== undefined && (typeof entry.nativeTurnId !== 'string' || !entry.nativeTurnId.trim() || entry.nativeTurnId.length > 512)
      || entry.createReceiptText !== undefined && (typeof entry.createReceiptText !== 'string' || entry.createReceiptText.length > 4096)
      || entry.dispatchReceiptText !== undefined && (typeof entry.dispatchReceiptText !== 'string' || entry.dispatchReceiptText.length > 4096)
      || entry.lastProgress !== undefined && (typeof entry.lastProgress !== 'string' || entry.lastProgress.length > 4000)
      || entry.lastProgressAt !== undefined && (typeof entry.lastProgressAt !== 'string' || Number.isNaN(Date.parse(entry.lastProgressAt)))
      || entry.projectBinding !== undefined && !isTaskExecutionProjectBinding(entry.projectBinding, entry.hostId)
      || entry.taskDecisionRequest !== undefined && (!isRecord(entry.taskDecisionRequest)
        || Object.keys(entry.taskDecisionRequest).some(key => !['requestId', 'requestHash', 'purpose', 'version'].includes(key))
        || typeof entry.taskDecisionRequest.requestId !== 'string' || !/^td-[a-f0-9]{40}$/.test(entry.taskDecisionRequest.requestId)
        || typeof entry.taskDecisionRequest.requestHash !== 'string' || !/^[a-f0-9]{64}$/.test(entry.taskDecisionRequest.requestHash)
        || typeof entry.taskDecisionRequest.purpose !== 'string' || !entry.taskDecisionRequest.purpose.trim()
        || entry.taskDecisionRequest.purpose.length > 128 || /[\x00-\x1f\x7f]/.test(entry.taskDecisionRequest.purpose)
        || !Number.isSafeInteger(entry.taskDecisionRequest.version) || (entry.taskDecisionRequest.version as number) < 1
        || (entry.taskDecisionRequest.version as number) > (entry.lastBoardVersion as number))) {
      throw invalidPlanningField(field, 'invalid immutable operation identity or receipt state');
    }
    if (['created', 'dispatch-unknown', 'running', 'waiting', 'stopped', 'result'].includes(String(entry.phase)) && !entry.nativeSessionId) {
      throw invalidPlanningField(`${field}.nativeSessionId`, 'required after session creation');
    }
    if (['running', 'waiting', 'result'].includes(String(entry.phase)) && !entry.nativeTurnId) {
      throw invalidPlanningField(`${field}.nativeTurnId`, 'required after native turn admission');
    }
    const projectBinding = entry.projectBinding === undefined ? undefined : normalizeTaskExecutionProjectBinding(entry.projectBinding);
    seen.add(entry.operationId);
    return {
      operationId: entry.operationId,
      requestHash: entry.requestHash,
      lastBoardVersion: entry.lastBoardVersion as number,
      createInputId: entry.createInputId,
      messageInputId: entry.messageInputId,
      phase: entry.phase as TaskExecutionReceipt['phase'],
      hostId: entry.hostId,
      harness: entry.harness as TaskExecutionReceipt['harness'],
      ...(projectBinding ? { projectBinding } : {}),
      ...(typeof entry.nativeSessionId === 'string' ? { nativeSessionId: entry.nativeSessionId } : {}),
      ...(typeof entry.nativeTurnId === 'string' ? { nativeTurnId: entry.nativeTurnId } : {}),
      ...(typeof entry.requestedBy === 'string' ? { requestedBy: entry.requestedBy } : {}),
      ...(isRecord(entry.taskDecisionRequest) ? { taskDecisionRequest: {
        requestId: entry.taskDecisionRequest.requestId as string,
        requestHash: entry.taskDecisionRequest.requestHash as string,
        purpose: entry.taskDecisionRequest.purpose as string,
        version: entry.taskDecisionRequest.version as number,
      } } : {}),
      ...(typeof entry.createReceiptText === 'string' ? { createReceiptText: entry.createReceiptText } : {}),
      ...(typeof entry.dispatchReceiptText === 'string' ? { dispatchReceiptText: entry.dispatchReceiptText } : {}),
      ...(typeof entry.lastProgress === 'string' ? { lastProgress: entry.lastProgress } : {}),
      ...(typeof entry.lastProgressAt === 'string' ? { lastProgressAt: entry.lastProgressAt } : {}),
      ...(continuations ? { continuations } : {}),
      ...(sessionControls ? { sessionControls } : {}),
      startedBy: entry.startedBy,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
  });
}

function taskExecutionSessionControlsField(entry: unknown, field: string): TaskExecutionSessionControls | undefined {
  if (!isRecord(entry) || entry.sessionControls === undefined) return undefined;
  const value = entry.sessionControls;
  if (!isRecord(value) || Object.keys(value).some(key => !['direct', 'stop'].includes(key))) {
    throw invalidPlanningField(`${field}.sessionControls`, 'expected direct/stop receipt states');
  }
  const result: TaskExecutionSessionControls = {};
  const parseControl = (item: unknown, itemField: string): TaskExecutionSessionControl => {
    if (!isRecord(item)
      || Object.keys(item).some(key => !['requestHash', 'phase', 'updatedAt'].includes(key))
      || typeof item.requestHash !== 'string' || !/^[a-f0-9]{64}$/.test(item.requestHash)
      || !['intent', 'accepted', 'unknown'].includes(String(item.phase))
      || typeof item.updatedAt !== 'string' || Number.isNaN(Date.parse(item.updatedAt))) {
      throw invalidPlanningField(itemField, 'invalid session control receipt');
    }
    return {
      requestHash: item.requestHash,
      phase: item.phase as TaskExecutionSessionControl['phase'],
      updatedAt: item.updatedAt,
    };
  };
  if (value.direct !== undefined) {
    if (!Array.isArray(value.direct)) throw invalidPlanningField(`${field}.sessionControls.direct`, 'expected a direct action receipt list');
    const seenHashes = new Set<string>();
    result.direct = value.direct.map((item, index) => {
      const parsed = parseControl(item, `${field}.sessionControls.direct[${index}]`);
      if (seenHashes.has(parsed.requestHash)) throw invalidPlanningField(`${field}.sessionControls.direct`, 'duplicate direct request hash');
      seenHashes.add(parsed.requestHash);
      return parsed;
    });
  }
  if (value.stop !== undefined) result.stop = parseControl(value.stop, `${field}.sessionControls.stop`);
  return result;
}

function isTaskExecutionProjectBinding(value: unknown, receiptHostId: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.pathResolution)) return false;
  const binding = value;
  const paths = binding.pathResolution as Record<string, unknown>;
  const bindingKeys = ['contract', 'projectId', 'projectRoot', 'rootIdentity', 'policyRevision', 'observedAtMs',
    'runtimeInstanceId', 'hostId', 'harness', 'harnessVersion', 'model', 'requiredTools', 'availableTools',
    'availableModels', 'resourceReady', 'cwd', 'pathResolution'];
  const pathKeys = ['requestedCwd', 'canonicalCwd', 'rootPath', 'contained', 'identityMatches'];
  if (Object.keys(binding).some(key => !bindingKeys.includes(key))
      || Object.keys(paths).some(key => !pathKeys.includes(key))
      || Object.keys(binding).length !== bindingKeys.length || Object.keys(paths).length !== pathKeys.length) return false;
  const strings = ['projectId', 'projectRoot', 'rootIdentity', 'policyRevision', 'runtimeInstanceId',
    'hostId', 'harnessVersion', 'model', 'cwd'] as const;
  if (binding.contract !== 'integrator-host-readiness-v1' || strings.some(key => typeof binding[key] !== 'string' || !(binding[key] as string).trim())
      || binding.hostId !== receiptHostId || binding.harness !== 'codex' || binding.model !== 'gpt-6-luna'
      || binding.resourceReady !== true || !Number.isSafeInteger(binding.observedAtMs) || (binding.observedAtMs as number) <= 0
      || !Array.isArray(binding.requiredTools) || !binding.requiredTools.length
      || binding.requiredTools.some(item => typeof item !== 'string' || !item.trim())
      || !Array.isArray(binding.availableTools) || binding.availableTools.some(item => typeof item !== 'string' || !item.trim())
      || !Array.isArray(binding.availableModels) || binding.availableModels.some(item => typeof item !== 'string' || !item.trim())
      || !binding.requiredTools.every(item => (binding.availableTools as string[]).includes(item as string))
      || !(binding.availableModels as string[]).includes('gpt-6-luna')) return false;
  if (typeof paths.requestedCwd !== 'string' || typeof paths.canonicalCwd !== 'string'
      || typeof paths.rootPath !== 'string' || paths.contained !== true || paths.identityMatches !== true
      || paths.rootPath !== binding.projectRoot || paths.canonicalCwd !== binding.cwd) return false;
  const pathApi = path.posix;
  return pathApi.isAbsolute(binding.projectRoot as string) && pathApi.isAbsolute(binding.cwd as string)
    && pathApi.isAbsolute(paths.rootPath) && pathApi.isAbsolute(paths.requestedCwd);
}

function normalizeTaskExecutionProjectBinding(value: unknown): NonNullable<TaskExecutionReceipt['projectBinding']> {
  if (!isRecord(value) || !isRecord(value.pathResolution)) throw invalidPlanningField('task_execution_history.projectBinding', 'invalid project binding');
  const paths = value.pathResolution;
  return {
    contract: value.contract as 'integrator-host-readiness-v1',
    projectId: value.projectId as string,
    projectRoot: value.projectRoot as string,
    rootIdentity: value.rootIdentity as string,
    policyRevision: value.policyRevision as string,
    observedAtMs: value.observedAtMs as number,
    runtimeInstanceId: value.runtimeInstanceId as string,
    hostId: value.hostId as string,
    harness: value.harness as 'codex',
    harnessVersion: value.harnessVersion as string,
    model: value.model as 'gpt-6-luna',
    requiredTools: [...value.requiredTools as string[]],
    availableTools: [...value.availableTools as string[]],
    availableModels: [...value.availableModels as string[]],
    resourceReady: true,
    cwd: value.cwd as string,
    pathResolution: {
      requestedCwd: paths.requestedCwd as string,
      canonicalCwd: paths.canonicalCwd as string,
      rootPath: paths.rootPath as string,
      contained: true,
      identityMatches: true,
    },
  };
}

function taskExecutionContinuationsField(entry: unknown, field: string): TaskExecutionContinuation[] | undefined {
  if (!isRecord(entry) || entry.continuations === undefined) return undefined;
  const value = entry.continuations;
  if (!Array.isArray(value) || value.length > 1) throw invalidPlanningField(`${field}.continuations`, 'expected at most one child turn');
  const ids = new Set<string>();
  const inputs = new Set<string>();
  return value.map((item, index) => {
    const childField = `${field}.continuations[${index}]`;
    if (!isRecord(item)
      || Object.keys(item).some(key => !['id', 'kind', 'instruction', 'inputId', 'requestHash', 'requestedBy', 'phase', 'nativeTurnId', 'summary', 'evidenceRefs', 'createdAt', 'updatedAt'].includes(key))
      || typeof item.id !== 'string' || !/^[a-f0-9]{64}$/.test(item.id) || ids.has(item.id)
      || typeof item.inputId !== 'string' || !/^[a-f0-9]{64}$/.test(item.inputId) || inputs.has(item.inputId)
      || typeof item.requestHash !== 'string' || !/^[a-f0-9]{64}$/.test(item.requestHash)
      || item.requestedBy !== undefined && (typeof item.requestedBy !== 'string' || !item.requestedBy.trim() || item.requestedBy.length > 256)
      || item.kind !== 'task-follow-up-v1'
      || typeof item.instruction !== 'string' || !item.instruction.trim() || item.instruction.length > 4000
      || !['intent', 'unknown', 'running', 'result'].includes(String(item.phase))
      || item.nativeTurnId !== undefined && (typeof item.nativeTurnId !== 'string' || !item.nativeTurnId.trim() || item.nativeTurnId.length > 512)
      || item.summary !== undefined && (typeof item.summary !== 'string' || !item.summary.trim() || item.summary.length > 40_000)
      || item.evidenceRefs !== undefined && (!Array.isArray(item.evidenceRefs) || item.evidenceRefs.length > 50
        || item.evidenceRefs.some(ref => typeof ref !== 'string' || ref.length > 2048))
      || typeof item.createdAt !== 'string' || Number.isNaN(Date.parse(item.createdAt))
      || typeof item.updatedAt !== 'string' || Number.isNaN(Date.parse(item.updatedAt))
      || ['running', 'result'].includes(String(item.phase)) && !item.nativeTurnId
      || item.phase === 'result' && !item.summary) {
      throw invalidPlanningField(childField, 'invalid task continuation receipt');
    }
    ids.add(item.id);
    inputs.add(item.inputId);
    return {
      id: item.id,
      kind: item.kind,
      instruction: item.instruction,
      inputId: item.inputId,
      requestHash: item.requestHash,
      ...(typeof item.requestedBy === 'string' ? { requestedBy: item.requestedBy } : {}),
      phase: item.phase as TaskExecutionContinuation['phase'],
      ...(typeof item.nativeTurnId === 'string' ? { nativeTurnId: item.nativeTurnId } : {}),
      ...(typeof item.summary === 'string' ? { summary: item.summary } : {}),
      ...(Array.isArray(item.evidenceRefs) ? { evidenceRefs: item.evidenceRefs as string[] } : {}),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  });
}

function evidenceArrayField(data: Record<string, unknown>, field: string): PlanningEvidence[] {
  const value = data[field];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(item => !isRecord(item))) {
    throw invalidPlanningField(field, 'expected an array of objects');
  }
  return value as PlanningEvidence[];
}

function resultHistoryField(data: Record<string, unknown>): TaskResult[] {
  const value = data.result_history;
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw invalidPlanningField('result_history', 'expected an array of results');
  return value.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.summary !== 'string' || !entry.summary.trim()
      || typeof entry.submittedBy !== 'string' || !entry.submittedBy.trim()
      || typeof entry.submittedAt !== 'string' || Number.isNaN(Date.parse(entry.submittedAt))
      || !Array.isArray(entry.evidenceRefs)
      || entry.evidenceRefs.some(ref => typeof ref !== 'string' || !ref.trim())) {
      throw invalidPlanningField(`result_history[${index}]`, 'expected summary, references, actor and timestamp');
    }
    return {
      summary: entry.summary,
      evidenceRefs: [...entry.evidenceRefs] as string[],
      ...(typeof entry.nextAction === 'string' ? { nextAction: entry.nextAction } : {}),
      ...(typeof entry.runRef === 'string' ? { runRef: entry.runRef } : {}),
      submittedBy: entry.submittedBy,
      submittedAt: entry.submittedAt,
    };
  });
}

function reviewHistoryField(data: Record<string, unknown>): TaskReviewRecord[] {
  const value = data.review_history;
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw invalidPlanningField('review_history', 'expected an array of decisions');
  return value.map((entry, index) => {
    if (!isRecord(entry) || !['accepted', 'rework'].includes(String(entry.decision))
      || typeof entry.actor !== 'string' || !entry.actor.trim()
      || typeof entry.decidedAt !== 'string' || Number.isNaN(Date.parse(entry.decidedAt))) {
      throw invalidPlanningField(`review_history[${index}]`, 'expected decision, actor and timestamp');
    }
    return {
      decision: entry.decision as TaskReviewRecord['decision'],
      actor: entry.actor,
      decidedAt: entry.decidedAt,
      ...(typeof entry.note === 'string' ? { note: entry.note } : {}),
    };
  });
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
    resultHistory: resultHistoryField(data),
    reviewHistory: reviewHistoryField(data),
    nextAction: optionalString(data, 'next_action'),
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
    result_history: card.resultHistory,
    review_history: card.reviewHistory,
    next_action: card.nextAction,
  });
}
