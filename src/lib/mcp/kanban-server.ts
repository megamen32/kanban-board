import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ensureProject, listProjects, projectInput } from '../kanban/project-store';
import { createAdmittedCard, createCard, deleteCard, findCardById, getAllCards, updateCard } from '../kanban/file-store';
import { taskExecutionSnapshot } from '../kanban/task-execution';
import { admitSourceTask } from '../kanban/source-operation';
import { commitVerifiedCatalogTaskLink } from '../kanban/catalog-link';
import { catalogResultDigest, type CatalogLinkClaims, type SignedCatalogLinkEnvelope } from './catalog-link-resolver';
import type { SourceAdmissionRequest } from '../kanban/source-operation';
import type { SignedSourceAdmissionEnvelope } from './source-resolver';
import type { SignedTodoMcpReadScope, TodoMcpProjectEnsureClaims, TodoMcpReadScopeClaims, TodoMcpWriteScopeClaims } from './todo-caller-scope';
import { normalizeDueAt } from '../kanban/due-at';
import { NIKITA_ACTOR, validateTransition } from '../kanban/transition-policy';
import { tasksDirForScope } from '../auth/data-scope';
import type { BoardScope } from '../auth/scopes';
import { ROLE_IDS } from '../kanban/types';
import type { ExecutorResultInput, KanbanCard, KanbanCardUpdates, KanbanColumn, PlanningEvidence, Priority } from '../kanban/types';

const COLUMNS = ['inbox', 'todo', 'in-progress', 'review', 'blocked', 'done', 'someday', 'archived'] as const;
const PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
const PLANNING_TYPES = ['outcome', 'action'] as const;
const ISO_WEEK = /^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/;
const RFC3339_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const cardInput = {
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  project: z.string().min(1).optional(),
  column: z.enum(COLUMNS).optional(),
  priority: z.enum(PRIORITIES).optional(),
  tags: z.array(z.string()).max(20).optional(),
  assignees: z.array(z.string()).max(20).optional(),
  dueAt: z.string().nullable().optional(),
  type: z.enum(PLANNING_TYPES).optional(),
  role: z.string().optional(),
  accountable: z.string().optional(),
  assignee: z.string().optional(),
  important: z.boolean().optional(),
  urgent: z.boolean().optional(),
  week: z.string().optional(),
  bigRock: z.boolean().optional(),
  parent: z.string().optional(),
  scheduledAt: z.string().optional(),
  todayRank: z.number().int().min(1).max(3).optional(),
  source: z.string().optional(),
  needsReview: z.boolean().optional(),
  suggestedAssignee: z.string().optional(),
  waitingFor: z.array(z.string()).max(20).optional(),
  requiresApprovalFrom: z.array(z.string()).max(20).optional(),
  completedBy: z.string().optional(),
  completedAt: z.string().optional(),
  completionEvidence: z.array(z.record(z.string(), z.unknown())).max(20).optional(),
  approvalEvidence: z.array(z.record(z.string(), z.unknown())).max(20).optional(),
  executorResult: z.object({
    summary: z.string().trim().min(1).max(20000),
    evidenceRefs: z.array(z.string().trim().min(1).max(2000)).max(20),
    nextAction: z.string().trim().max(4000).optional(),
  }).optional(),
};

type ChangeInput = {
  title?: string;
  description?: string;
  project?: string;
  column?: KanbanColumn;
  priority?: Priority;
  tags?: string[];
  assignees?: string[];
  dueAt?: string | null;
  type?: 'outcome' | 'action';
  role?: string;
  accountable?: string;
  assignee?: string;
  important?: boolean;
  urgent?: boolean;
  week?: string;
  bigRock?: boolean;
  parent?: string;
  scheduledAt?: string;
  todayRank?: number;
  source?: string;
  needsReview?: boolean;
  suggestedAssignee?: string;
  waitingFor?: string[];
  requiresApprovalFrom?: string[];
  completedBy?: string;
  completedAt?: string;
  completionEvidence?: PlanningEvidence[];
  approvalEvidence?: PlanningEvidence[];
  executorResult?: ExecutorResultInput;
};

/** Validate planning metadata before a new card can be written to Markdown. */
function validatePlanningInput(input: ChangeInput): void {
  const planning = z.object({
    type: z.enum(PLANNING_TYPES),
    role: z.enum(ROLE_IDS),
    accountable: z.string().min(1),
    assignee: z.string().min(1),
    week: z.string().regex(ISO_WEEK),
    parent: z.string().min(1),
    scheduledAt: z.string().regex(RFC3339_WITH_OFFSET),
    source: z.string().min(1),
    suggestedAssignee: z.string().min(1),
    waitingFor: z.array(z.string().min(1)).max(20),
    requiresApprovalFrom: z.array(z.string().min(1)).max(20),
    completedBy: z.string().min(1),
    completedAt: z.string().regex(RFC3339_WITH_OFFSET),
    completionEvidence: z.array(z.record(z.string(), z.unknown())).max(20),
    approvalEvidence: z.array(z.record(z.string(), z.unknown())).max(20),
    todayRank: z.number().int().min(1).max(3),
  }).partial().safeParse(input);
  if (!planning.success) {
    throw new Error(`Invalid planning metadata: ${planning.error.issues[0]?.path.join('.') || 'unknown field'}`);
  }
}

function requestedUpdates(input: ChangeInput): KanbanCardUpdates {
  const { dueAt, ...rest } = input;
  const defined = Object.fromEntries(
    Object.entries(rest).filter(([, value]) => value !== undefined),
  ) as KanbanCardUpdates;
  return {
    ...defined,
    ...(dueAt !== undefined ? { dueAt: normalizeDueAt(dueAt, true) } : {}),
  };
}

function creationBaseline(): KanbanCard {
  const now = new Date().toISOString();
  return {
    id: 'mcp-new-card',
    title: '',
    description: '',
    column: 'inbox',
    priority: 'medium',
    tags: [],
    order: 0,
    created: now,
    updated: now,
    fileName: 'mcp-new-card.md',
    version: 0,
    project: '',
    assignees: [],
    planningVersion: 1,
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

function textResult(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
  };
}

function filterCards(cards: KanbanCard[], filters: {
  project?: string;
  column?: KanbanColumn;
  tag?: string;
  dueWithinHours?: number;
  limit?: number;
}) {
  let result = cards;
  if (filters.project) result = result.filter((card) => card.project === filters.project);
  if (filters.column) result = result.filter((card) => card.column === filters.column);
  if (filters.tag) result = result.filter((card) => card.tags.includes(filters.tag!));
  if (filters.dueWithinHours !== undefined) {
    const now = Date.now();
    result = result.filter((card) => {
      if (!card.dueAt) return false;
      const diffHours = (Date.parse(card.dueAt) - now) / 3_600_000;
      return filters.dueWithinHours! >= 0
        ? -filters.dueWithinHours! <= diffHours && diffHours <= filters.dueWithinHours!
        : diffHours <= filters.dueWithinHours!;
    });
  }
  return filters.limit ? result.slice(0, filters.limit) : result;
}

export interface KanbanMcpOptions {
  allowConfirmedOwnerCommands?: boolean;
  allowInternalTeamCommands?: boolean;
  /** Verifies an ExManager server-signed source request; never trust service bearer input alone. */
  verifySourceAdmission?: (envelope: SignedSourceAdmissionEnvelope) => SourceAdmissionRequest;
  /** Verifies the server-only canonical owner receipt bound to one current Board result. */
  verifyCatalogLink?: (envelope: SignedCatalogLinkEnvelope) => CatalogLinkClaims;
  /** Requires per-call current ExManager user/project authority on the shared service MCP. */
  requireExManagerReadScope?: boolean;
  verifyExManagerReadScope?: (
    envelope: SignedTodoMcpReadScope,
    tool: TodoMcpReadScopeClaims['tool'],
    args: Record<string, unknown>,
  ) => TodoMcpReadScopeClaims;
  /** Requires a purpose-separated, exact-argument current writer capability. */
  requireExManagerWriteScope?: boolean;
  verifyExManagerWriteScope?: (
    envelope: SignedTodoMcpReadScope,
    args: Record<string, unknown>,
  ) => TodoMcpWriteScopeClaims;
  requireExManagerProjectEnsureScope?: boolean;
  verifyExManagerProjectEnsureScope?: (
    envelope: SignedTodoMcpReadScope,
    args: Record<string, unknown>,
  ) => TodoMcpProjectEnsureClaims;
  /**
   * Restricts this principal to the board's read-only tools. The mutating
   * tools are not registered at all, so the advertised tool list and every
   * attempted mutation are read-only for this identity.
   */
  readOnlyApp?: boolean;
}

function verifyReadScope(
  options: KanbanMcpOptions,
  envelope: SignedTodoMcpReadScope | undefined,
  tool: TodoMcpReadScopeClaims['tool'],
  args: Record<string, unknown>,
) {
  if (!options.requireExManagerReadScope) return undefined;
  if (!envelope || !options.verifyExManagerReadScope) throw new Error('current ExManager caller scope required');
  return options.verifyExManagerReadScope(envelope, tool, args);
}

function verifyWriteScope(
  options: KanbanMcpOptions,
  envelope: SignedTodoMcpReadScope | undefined,
  args: Record<string, unknown>,
) {
  if (!options.requireExManagerWriteScope) return undefined;
  if (!envelope || !options.verifyExManagerWriteScope) throw new Error('current ExManager writer scope required');
  return options.verifyExManagerWriteScope(envelope, args);
}

function verifyProjectEnsureScope(
  options: KanbanMcpOptions,
  envelope: SignedTodoMcpReadScope | undefined,
  args: Record<string, unknown>,
) {
  if (!options.requireExManagerProjectEnsureScope) return undefined;
  if (!envelope || !options.verifyExManagerProjectEnsureScope) throw new Error('current ExManager project-admin scope required');
  return options.verifyExManagerProjectEnsureScope(envelope, args);
}

export function createKanbanMcpServer(scope: BoardScope, options: KanbanMcpOptions = {}): McpServer {
  const tasksDir = tasksDirForScope(scope);
  const readOnlyApp = options.readOnlyApp === true;
  const server = new McpServer(
    { name: `excode-kanban-${scope}`, version: '1.0.0' },
    {
      instructions: `This MCP server is permanently scoped to the ${scope} Kanban board. Never infer or request access to the other board. Use kanban.list before editing and preserve expectedVersion when available.`,
    },
  );

  server.registerTool('kanban.list', {
    title: 'List Kanban cards',
    description: 'List cards from the authorized board with optional filters.',
    inputSchema: {
      project: z.string().optional(),
      column: z.enum(COLUMNS).optional(),
      tag: z.string().optional(),
      dueWithinHours: z.number().optional(),
      limit: z.number().int().min(1).max(1000).optional(),
      exmanagerScope: z.object({ payload: z.string().min(1).max(24_000), signature: z.string().min(1).max(128) }).strict().optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ project, column, tag, dueWithinHours, limit, exmanagerScope }) => {
    const args = Object.fromEntries(Object.entries({ project, column, tag, dueWithinHours, limit }).filter(([, value]) => value !== undefined));
    const callerScope = verifyReadScope(options, exmanagerScope, 'kanban.list', args);
    if (callerScope && project && !callerScope.owner && !callerScope.projects.includes(project)) {
      throw new Error('Todo project is outside the caller scope');
    }
    const allCards = getAllCards(tasksDir);
    const authorizedCards = callerScope && !callerScope.owner
      ? allCards.filter(card => callerScope.projects.includes(card.project))
      : allCards;
    const cards = filterCards(authorizedCards, { project, column, tag, dueWithinHours, limit });
    return textResult({ cards, count: cards.length, scope });
  });

  server.registerTool('kanban.read', {
    title: 'Read a Kanban card',
    description: 'Read one card from the authorized board by id.',
    inputSchema: {
      cardId: z.string().min(1),
      exmanagerScope: z.object({ payload: z.string().min(1).max(24_000), signature: z.string().min(1).max(128) }).strict().optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ cardId, exmanagerScope }) => {
    const callerScope = verifyReadScope(options, exmanagerScope, 'kanban.read', { cardId });
    const card = findCardById(cardId, tasksDir);
    if (!card) throw new Error(`Card ${cardId} not found`);
    if (callerScope && !callerScope.owner && !callerScope.projects.includes(card.project)) {
      throw new Error(`Card ${cardId} not found`);
    }
    return textResult({ card, execution: taskExecutionSnapshot(card), scope });
  });

  if (!readOnlyApp) {
    server.registerTool('kanban.capture_inbox', {
      title: 'Capture raw transcript to Inbox',
      description: 'Store one raw voice transcription or note in Inbox. Do not classify it, assign a role, invent a deadline, or move any existing card.',
      inputSchema: { transcript: z.string().min(1), owner: z.string().min(1).optional() },
      annotations: { openWorldHint: false },
    }, async ({ transcript, owner }) => {
      if (options.requireExManagerReadScope) throw new Error('raw shared service Inbox capture is disabled');
      const clean = transcript.trim();
      const basic = createCard(clean.replace(/\s+/g, ' ').slice(0, 96), clean, 'inbox', 'medium', ['inbox-capture'], 'Inbox', [], tasksDir);
      const result = updateCard(basic.id, {
        owner: owner ?? 'nikita', source: 'hermes:transcript', needsReview: true,
      }, undefined, tasksDir);
      if ('conflict' in result) throw new Error(`Version conflict for ${basic.id}`);
      return textResult({ card: result, scope, transition: 'captured_to_inbox' });
    });
  }

  if (!readOnlyApp) {
    server.registerTool('kanban.change', {
      title: 'Create or update a Kanban card',
      description: 'Create a card or update an existing card in the authorized board.',
      inputSchema: {
        mode: z.enum(['new', 'edit']),
        cardId: z.string().min(1).optional(),
        expectedVersion: z.number().int().optional(),
        ownerCommandConfirmed: z.boolean().optional(),
        ownerCompletionConfirmed: z.boolean().optional(),
        exmanagerScope: z.object({ payload: z.string().min(1).max(24_000), signature: z.string().min(1).max(128) }).strict().optional(),
        ...cardInput,
      },
      annotations: { openWorldHint: false },
    }, async (input) => {
      const {
        mode,
        cardId,
        expectedVersion,
        ownerCommandConfirmed,
        ownerCompletionConfirmed,
        exmanagerScope,
        title,
        description,
        project,
        column,
        priority,
        tags,
        assignees,
        dueAt,
        ...planningInput
      } = input as typeof input & ChangeInput;
      const scopeArgs = Object.fromEntries(Object.entries(input).filter(([key, value]) => key !== 'exmanagerScope' && value !== undefined));
      const callerScope = verifyWriteScope(options, exmanagerScope, scopeArgs);
      const internalTeamAuthorization = options.allowInternalTeamCommands && (!options.requireExManagerWriteScope || callerScope)
        ? { actor: 'exmanager-service', evidence: { type: 'authenticated_internal_team_command', service: 'exmanager-airlock-service' } }
        : undefined;
      if (internalTeamAuthorization && mode === 'edit' && (!Number.isSafeInteger(expectedVersion) || expectedVersion! < 1)) {
        throw new Error('expectedVersion is required for internal team edits');
      }
      // Trust comes from the authenticated service principal, never the payload.
      const ownerAuthorization = options.allowConfirmedOwnerCommands && ownerCommandConfirmed === true
        && (!options.requireExManagerWriteScope || callerScope?.owner === true)
        ? { actor: NIKITA_ACTOR, evidence: { type: 'airlock_confirmed_command', service: 'exmanager-airlock-service' } }
        : undefined;
      const requested = requestedUpdates({
        title,
        description,
        project,
        column,
        priority,
        tags,
        assignees,
        dueAt,
        ...planningInput,
      });

      // Completion is a distinct direct-owner delegation. Ordinary automation
      // and caller-supplied completion evidence still cannot finish a card.
      if (ownerCompletionConfirmed === true && (!ownerAuthorization || mode !== 'edit'
        || column !== 'done' || !Number.isSafeInteger(expectedVersion) || expectedVersion! < 1
        || Object.keys(requested).some(key => key !== 'column'))) {
        throw new Error('owner completion requires trusted service authority and an exact status-only edit');
      }
      const ownerCompletionAuthorization = ownerCompletionConfirmed === true ? ownerAuthorization : undefined;

      if (mode === 'new') {
        if (!title) throw new Error('title is required for mode=new');
        if (!project) throw new Error('project is required for mode=new');
        if (callerScope && !callerScope.owner && !callerScope.projects.includes(project)) {
          throw new Error('Todo destination project is outside the caller write scope');
        }
        validatePlanningInput({ ...planningInput, column, title, project });
        const decision = validateTransition(creationBaseline(), requested, {
          origin: 'mcp',
          actor: 'mcp',
          isCreation: true,
          ownerAuthorization,
          internalTeamAuthorization,
        });
        if (decision.kind === 'rejected') throw new Error(decision.reason);

        const basicCard = createCard(
          title,
          description || '',
          decision.patch.column ?? column,
          priority,
          tags,
          project,
          decision.patch.assignees ?? [],
          tasksDir,
          decision.patch.dueAt === undefined || decision.patch.dueAt === null
            ? undefined
            : decision.patch.dueAt,
          {
            ...(typeof decision.patch.parent === 'string' ? { parent: decision.patch.parent } : {}),
            ...(typeof decision.patch.owner === 'string' ? { owner: decision.patch.owner } : {}),
          },
        );
        const persisted = Object.fromEntries(
          Object.entries(decision.patch).filter(([key]) => !['title', 'description', 'project', 'column', 'priority', 'tags', 'assignees', 'dueAt'].includes(key)
            && !(key === 'parent' && typeof decision.patch.parent === 'string')),
        ) as KanbanCardUpdates;
        const card = Object.keys(persisted).length > 0
          ? updateCard(basicCard.id, persisted, undefined, tasksDir) as KanbanCard
          : basicCard;
        return textResult({ card, scope, transition: decision });
      }

      if (!cardId) throw new Error('cardId is required for mode=edit');
      const before = findCardById(cardId, tasksDir);
      if (!before) throw new Error(`Card ${cardId} not found`);
      if (callerScope && !callerScope.owner
          && (!callerScope.projects.includes(before.project) || (project && !callerScope.projects.includes(project)))) {
        throw new Error(`Card ${cardId} not found`);
      }
      if (ownerCompletionAuthorization && (before.owner !== NIKITA_ACTOR
        || (before.requiresApprovalFrom ?? []).some(actor => actor !== NIKITA_ACTOR))) {
        throw new Error('owner completion is outside the exact owner review scope');
      }
      const decision = validateTransition(before, requested, { origin: 'mcp', actor: 'mcp', ownerAuthorization, ownerCompletionAuthorization, internalTeamAuthorization });
      if (decision.kind === 'rejected') throw new Error(decision.reason);
      const result = updateCard(cardId, decision.patch, expectedVersion, tasksDir);
      if ('conflict' in result) throw new Error(`Version conflict for card ${cardId}`);
      return textResult({ card: result, scope, transition: decision });
    });
  }

  if (options.verifySourceAdmission) {
    server.registerTool('kanban.source.admit', {
      title: 'Admit a classified source outcome',
      description: 'Verify the signed ExManager source envelope and persist its explicit task, backlog idea, or review-needed Inbox outcome under one immutable source identity. Only explicit tasks create an automatic execution intent. A service bearer without a valid signature cannot assert source identity, task text, or grants.',
      inputSchema: {
        envelope: z.object({
          payload: z.string().min(1).max(90_000),
          purpose: z.literal('source-admission'),
          issuedAtMs: z.number().int().safe(),
          expiresAtMs: z.number().int().safe(),
          signature: z.string().min(1).max(128),
        }).strict(),
      },
      annotations: { idempotentHint: true, openWorldHint: false },
    }, async ({ envelope }) => {
      const request = options.verifySourceAdmission!(envelope);
      const result = admitSourceTask(
        request,
        tasksDir,
        id => findCardById(id, tasksDir),
        card => createAdmittedCard(card, tasksDir),
      );
      return textResult({ ...result, scope });
    });
  }

  if (options.verifyCatalogLink) {
    server.registerTool('kanban.catalog.link', {
      title: 'Link a verified integrator result to the canonical partner catalog',
      description: 'Persist only canonical Airlockplan IDs for one exact admitted source, result revision, and integrator subject. Caller-supplied IDs or unsigned requests are never accepted.',
      inputSchema: {
        envelope: z.object({
          payload: z.string().min(1).max(90_000), purpose: z.literal('catalog-link'),
          issuedAtMs: z.number().int().safe(), expiresAtMs: z.number().int().safe(),
          signature: z.string().min(1).max(128),
        }).strict(),
      },
      annotations: { idempotentHint: true, openWorldHint: false },
    }, async ({ envelope }) => {
      const claims = options.verifyCatalogLink!(envelope);
      const card = findCardById(claims.taskId, tasksDir);
      const latestResult = card?.resultHistory?.at(-1);
      if (!card || card.version !== claims.expectedBoardVersion || card.project !== claims.boardProject
          || card.sourceAdmission?.classification !== 'explicit-task'
          || card.sourceAdmission.sourceEventId !== claims.sourceRef
          || card.sourceAdmission.sourceRevision !== claims.sourceRevision
          || card.sourceAdmission.requestedProject !== claims.boardProject
          || !latestResult?.evidenceRefs.includes(claims.subjectEvidenceRef)
          || catalogResultDigest(latestResult) !== claims.resultDigest) {
        throw new Error('current admitted source, Board version, or result digest does not match the signed catalog link');
      }
      const { actorId: _verifiedActorId, subjectEvidenceRef: _verifiedEvidenceRef, ...linkRequest } = claims;
      // These canonical fields came from the fixed Go→Airlockplan MCP receipt,
      // authenticated by the per-call Ed25519 envelope. Recheck exact local
      // Board facts above and let the existing store perform the version CAS.
      const result = commitVerifiedCatalogTaskLink(linkRequest, { tasksDir });
      return textResult(result);
    });
  }

  if (!readOnlyApp) {
    server.registerTool('kanban.project.ensure', {
      title: 'Ensure a persistent Kanban project',
      description: 'Create an empty project or return the same immutable project for the external key. A different name for an existing key conflicts.',
      inputSchema: {
        ...projectInput,
        exmanagerScope: z.object({ payload: z.string().min(1).max(24_000), signature: z.string().min(1).max(128) }).strict().optional(),
      },
      annotations: { idempotentHint: true, destructiveHint: false, openWorldHint: false },
    }, async ({ externalKey, name, exmanagerScope }) => {
      verifyProjectEnsureScope(options, exmanagerScope, { externalKey, name });
      return textResult(ensureProject(tasksDir, { externalKey, name }));
    });
  }

  server.registerTool('kanban.project.list', {
    title: 'List persistent Kanban projects',
    description: 'List registered projects including projects with zero cards.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => {
    if (options.requireExManagerReadScope) throw new Error('raw shared service project listing is disabled');
    return textResult({ projects: listProjects(tasksDir) });
  });

  if (!readOnlyApp) {
    server.registerTool('kanban.delete', {
      title: 'Delete a Kanban card',
      description: 'Delete one card from the authorized board by id.',
      inputSchema: { cardId: z.string().min(1) },
      annotations: { openWorldHint: false },
    }, async ({ cardId }) => {
      if (options.requireExManagerWriteScope) throw new Error('raw shared service deletion is disabled');
      const deleted = deleteCard(cardId, tasksDir);
      if (!deleted) throw new Error(`Card ${cardId} not found`);
      return textResult({ cardId, deleted: true, scope });
    });
  }

  return server;
}
