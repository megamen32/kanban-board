export interface KanbanCard {
  id: string;
  title: string;
  description: string;
  column: KanbanColumn;
  priority: Priority;
  tags: string[];
  order: number;
  created: string;
  updated: string;
  dueAt?: string;
  fileName: string;
  version: number;
  project: string;
  assignees: string[];
  /** Person whose personal planning space owns this card. Old cards belong to Nikita. */
  owner?: string;
  /** Short, durable explanation of what is currently blocking this task. */
  blockerReason?: string;
  /** Shared cards appear in the common-projects view for every selected person. */
  shared?: boolean;
  /** Planning metadata is optional in the TypeScript surface for legacy callers. */
  planningVersion?: 1;
  type?: PlanningType;
  role?: RoleId;
  accountable?: string;
  assignee?: string;
  important?: boolean;
  urgent?: boolean;
  week?: string;
  bigRock?: boolean;
  parent?: string;
  scheduledAt?: string;
  todayRank?: 1 | 2 | 3;
  source?: string;
  needsReview?: boolean;
  suggestedAssignee?: string;
  waitingFor?: string[];
  requiresApprovalFrom?: string[];
  completedBy?: string;
  completedAt?: string;
  completionEvidence?: PlanningEvidence[];
  approvalEvidence?: PlanningEvidence[];
  resultHistory?: TaskResult[];
  reviewHistory?: TaskReviewRecord[];
  /** Durable native-session launch/dispatch receipts stored on this Markdown card. */
  taskExecutionHistory?: TaskExecutionReceipt[];
  nextAction?: string;
  /** Immutable source admission identity; the board operation journal owns lifecycle state. */
  sourceAdmission?: SourceAdmissionBinding;
  /** Immutable canonical catalog references; IDs and causal revisions only. */
  catalogLink?: CatalogTaskLink;
  /** Subject-keyed links for multiple integrators researched under one task. */
  catalogLinks?: readonly CatalogTaskLink[];
  /** Unknown frontmatter is retained internally so unrelated edits are lossless. */
  rawFrontmatter?: Record<string, unknown>;
}

export interface SourceAdmissionBinding {
  readonly operationKey: string;
  readonly requestHash: string;
  readonly provenanceHash: string;
  /** Present only for explicit tasks that may enter the execution queue. */
  readonly intentId?: string;
  readonly tenantId: string;
  readonly sourceOwnerId: string;
  readonly sourceEventId: string;
  readonly primaryItem: 'primary';
  readonly sourceRevision: string;
  readonly requestedProject: string;
  readonly classification: 'explicit-task' | 'idea' | 'ambiguous';
  readonly evidenceRefs: readonly string[];
}

/**
 * Reference-only task-to-catalog binding. The catalog owner remains the source
 * of truth; this record stores no names, task text, or copied catalog payload.
 */
export interface CatalogTaskLink {
  readonly version: 1;
  readonly subjectKey?: string;
  readonly taskId: string;
  readonly operationRef: string;
  readonly boardVersion: number;
  readonly sourceRef: string;
  readonly sourceRevision: string;
  /** SHA-256 of the exact current resultHistory entry bound at commit. */
  readonly resultDigest?: string;
  readonly projectId: string;
  readonly planIds: readonly string[];
  readonly gateIds: readonly string[];
  readonly contactIds: readonly string[];
  readonly catalogRevision: string;
}

export function parseCatalogTaskLink(value: unknown): CatalogTaskLink {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid canonical catalog link');
  const raw = value as Record<string, unknown>;
  const allowed = new Set(['version', 'subjectKey', 'taskId', 'operationRef', 'boardVersion', 'sourceRef', 'sourceRevision', 'resultDigest', 'projectId', 'planIds', 'gateIds', 'contactIds', 'catalogRevision']);
  if (Object.keys(raw).some(key => !allowed.has(key)) || raw.version !== 1
      || !Number.isSafeInteger(raw.boardVersion) || (raw.boardVersion as number) < 1
      || (raw.resultDigest !== undefined && (typeof raw.resultDigest !== 'string' || !/^[a-f0-9]{64}$/.test(raw.resultDigest)))) {
    throw new Error('invalid canonical catalog link');
  }
  const id = (candidate: unknown): candidate is string => typeof candidate === 'string'
    && candidate.length > 0 && candidate.length <= 512 && !/\s/.test(candidate);
  if ((raw.subjectKey !== undefined && !id(raw.subjectKey)) || !id(raw.taskId) || !id(raw.operationRef) || !id(raw.sourceRef) || !id(raw.sourceRevision)
      || !id(raw.projectId) || !id(raw.catalogRevision)) throw new Error('invalid canonical catalog link IDs');
  const ids = (candidate: unknown): string[] => {
    if (!Array.isArray(candidate) || candidate.some(item => !id(item)) || new Set(candidate).size !== candidate.length) {
      throw new Error('invalid canonical catalog link IDs');
    }
    return [...candidate] as string[];
  };
  return Object.freeze({
    version: 1 as const,
    ...(raw.subjectKey !== undefined ? { subjectKey: raw.subjectKey } : {}),
    taskId: raw.taskId,
    operationRef: raw.operationRef,
    boardVersion: raw.boardVersion as number,
    sourceRef: raw.sourceRef,
    sourceRevision: raw.sourceRevision,
    ...(raw.resultDigest !== undefined ? { resultDigest: raw.resultDigest } : {}),
    projectId: raw.projectId,
    planIds: Object.freeze(ids(raw.planIds)),
    gateIds: Object.freeze(ids(raw.gateIds)),
    contactIds: Object.freeze(ids(raw.contactIds)),
    catalogRevision: raw.catalogRevision,
  });
}

export type PlanningType = 'outcome' | 'action';
export const ROLE_IDS = [
  'product-builder',
  'client-integrator',
  'team-lead',
  'author-public',
  'personal-relationships',
  'sharpening-the-saw',
] as const;
/** A role is personal data, not a globally fixed project category. */
export type RoleId = string;
export interface RoleDefinition {
  id: string;
  label: string;
  order: number;
}
export type PlanningEvidence = Record<string, unknown>;
/** Reference-only executor output; evidence bodies stay in their source system. */
export interface TaskResult {
  summary: string;
  evidenceRefs: string[];
  nextAction?: string;
  runRef?: string;
  submittedBy: string;
  submittedAt: string;
}
export interface TaskReviewRecord {
  decision: 'accepted' | 'rework';
  actor: string;
  decidedAt: string;
  note?: string;
}
export type TaskExecutionPhase = 'intent' | 'create-unknown' | 'created' | 'dispatch-unknown' | 'running' | 'waiting' | 'stopped' | 'result';
export type TaskExecutionContinuationPhase = 'intent' | 'unknown' | 'running' | 'result';
/** A task-bound follow-up turn in the same already-created native session. */
export interface TaskExecutionContinuation {
  readonly id: string;
  readonly kind: 'task-follow-up-v1';
  readonly instruction: string;
  readonly inputId: string;
  readonly requestHash: string;
  /** Signed native actor that created this child intent; absent on legacy continuations. */
  readonly requestedBy?: string;
  readonly phase: TaskExecutionContinuationPhase;
  readonly nativeTurnId?: string;
  readonly summary?: string;
  readonly evidenceRefs?: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}
export type TaskExecutionSessionControlPhase = 'intent' | 'accepted' | 'unknown';
/** One fail-closed, user-issued control action bound to an exact OpenCode receipt. */
export interface TaskExecutionSessionControl {
  requestHash: string;
  phase: TaskExecutionSessionControlPhase;
  updatedAt: string;
}
export interface TaskExecutionSessionControls {
  direct?: readonly TaskExecutionSessionControl[];
  stop?: TaskExecutionSessionControl;
}
/** Opaque Notice request identity attached to the exact execution operation. */
export interface TaskDecisionRequestReference {
  requestId: string;
  requestHash: string;
  purpose: string;
  version: number;
}
/** Server-observed H33 binding for newly scoped execution receipts; legacy receipts omit it. */
export interface TaskExecutionProjectBinding {
  contract: 'integrator-host-readiness-v1';
  projectId: string;
  projectRoot: string;
  rootIdentity: string;
  policyRevision: string;
  observedAtMs: number;
  runtimeInstanceId: string;
  hostId: string;
  harness: 'codex' | 'zcode' | 'opencode';
  harnessVersion: string;
  model: string;
  requiredTools: string[];
  availableTools: string[];
  availableModels: string[];
  resourceReady: true;
  cwd: string;
  pathResolution: {
    requestedCwd: string;
    canonicalCwd: string;
    rootPath: string;
    contained: true;
    identityMatches: true;
  };
}
export interface TaskExecutionReceipt {
  operationId: string;
  requestHash: string;
  /** Exact Board version after the latest execution-owned Markdown CAS write. */
  lastBoardVersion: number;
  createInputId: string;
  messageInputId: string;
  phase: TaskExecutionPhase;
  hostId: string;
  harness: 'codex' | 'zcode' | 'opencode';
  /** New scoped launches persist their exact H33 project/root/CWD binding; older receipts remain legacy. */
  projectBinding?: TaskExecutionProjectBinding;
  nativeSessionId?: string;
  nativeTurnId?: string;
  /** Signed native actor that created this parent intent; absent on legacy receipts. */
  requestedBy?: string;
  /** Immutable Notice request link; the question body remains in Notice. */
  taskDecisionRequest?: TaskDecisionRequestReference;
  createReceiptText?: string;
  dispatchReceiptText?: string;
  lastProgress?: string;
  lastProgressAt?: string;
  /** Append-only task-scoped follow-up turns; never replaces the initial receipt. */
  continuations?: readonly TaskExecutionContinuation[];
  /** At most one direct and one stop per exact execution receipt; UNKNOWN is terminal. */
  sessionControls?: TaskExecutionSessionControls;
  startedBy: string;
  createdAt: string;
  updatedAt: string;
}
/** Untrusted result fields accepted only by the authenticated executor MCP path. */
export interface ExecutorResultInput {
  summary: string;
  evidenceRefs: string[];
  nextAction?: string;
}
export const PLANNING_VERSION = 1 as const;

export type KanbanCardUpdates = Partial<Pick<KanbanCard, 'title' | 'description' | 'column' | 'priority' | 'tags' | 'order' | 'project' | 'assignees' | 'owner' | 'shared' | 'planningVersion' | 'type' | 'role' | 'accountable' | 'assignee' | 'important' | 'urgent' | 'week' | 'bigRock' | 'parent' | 'scheduledAt' | 'todayRank' | 'source' | 'needsReview' | 'suggestedAssignee' | 'waitingFor' | 'requiresApprovalFrom' | 'completedBy' | 'completedAt' | 'completionEvidence' | 'approvalEvidence' | 'resultHistory' | 'reviewHistory' | 'taskExecutionHistory'>> & {
  blockerReason?: string | null;
  dueAt?: string | null;
  nextAction?: string | null;
  executorResult?: ExecutorResultInput;
};

export type KanbanColumn = 'inbox' | 'todo' | 'in-progress' | 'review' | 'blocked' | 'done' | 'someday' | 'archived';
export type Priority = 'low' | 'medium' | 'high' | 'critical';

export const DEFAULT_COLUMNS: { id: KanbanColumn; title: string; color: string }[] = [
  { id: 'inbox', title: 'Входящие', color: 'bg-slate-500' },
  { id: 'todo', title: 'К выполнению', color: 'bg-zinc-500' },
  { id: 'in-progress', title: 'В работе', color: 'bg-amber-500' },
  { id: 'review', title: 'На проверке', color: 'bg-violet-500' },
  { id: 'blocked', title: 'Заблокировано', color: 'bg-red-500' },
  { id: 'done', title: 'Готово', color: 'bg-emerald-500' },
  { id: 'someday', title: 'Бэклог', color: 'bg-slate-400' },
  { id: 'archived', title: 'Не планируется', color: 'bg-stone-400' },
];

export const PRIORITY_COLORS: Record<Priority, string> = {
  low:      'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
  medium:   'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  high:     'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  critical: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
};

export interface SyncEvent {
  type: 'created' | 'updated' | 'deleted' | 'moved' | 'reordered';
  card: KanbanCard;
  timestamp: string;
}

export interface ConflictInfo {
  cardId: string;
  serverVersion: number;
  clientVersion: number;
  serverCard: KanbanCard;
  clientCard: KanbanCard;
}
