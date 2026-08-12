import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createCard, deleteCard, findCardById, getAllCards, updateCard } from '../kanban/file-store';
import { normalizeDueAt } from '../kanban/due-at';
import { validateTransition } from '../kanban/transition-policy';
import { tasksDirForScope } from '../auth/data-scope';
import type { BoardScope } from '../auth/scopes';
import { ROLE_IDS } from '../kanban/types';
import type { KanbanCard, KanbanCardUpdates, KanbanColumn, PlanningEvidence, Priority } from '../kanban/types';

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

export function createKanbanMcpServer(scope: BoardScope): McpServer {
  const tasksDir = tasksDirForScope(scope);
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
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ project, column, tag, dueWithinHours, limit }) => {
    const cards = filterCards(getAllCards(tasksDir), { project, column, tag, dueWithinHours, limit });
    return textResult({ cards, count: cards.length, scope });
  });

  server.registerTool('kanban.read', {
    title: 'Read a Kanban card',
    description: 'Read one card from the authorized board by id.',
    inputSchema: { cardId: z.string().min(1) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ cardId }) => {
    const card = findCardById(cardId, tasksDir);
    if (!card) throw new Error(`Card ${cardId} not found`);
    return textResult({ card, scope });
  });

  server.registerTool('kanban.capture_inbox', {
    title: 'Capture raw transcript to Inbox',
    description: 'Store one raw voice transcription or note in Inbox. Do not classify it, assign a role, invent a deadline, or move any existing card.',
    inputSchema: { transcript: z.string().min(1), owner: z.string().min(1).optional() },
    annotations: { openWorldHint: false },
  }, async ({ transcript, owner }) => {
    const clean = transcript.trim();
    const basic = createCard(clean.replace(/\s+/g, ' ').slice(0, 96), clean, 'inbox', 'medium', ['inbox-capture'], 'Inbox', [], tasksDir);
    const result = updateCard(basic.id, {
      owner: owner ?? 'nikita', source: 'hermes:transcript', needsReview: true,
    }, undefined, tasksDir);
    if ('conflict' in result) throw new Error(`Version conflict for ${basic.id}`);
    return textResult({ card: result, scope, transition: 'captured_to_inbox' });
  });

  server.registerTool('kanban.change', {
    title: 'Create or update a Kanban card',
    description: 'Create a card or update an existing card in the authorized board.',
    inputSchema: {
      mode: z.enum(['new', 'edit']),
      cardId: z.string().min(1).optional(),
      expectedVersion: z.number().int().optional(),
      ...cardInput,
    },
    annotations: { openWorldHint: false },
  }, async (input) => {
    const {
      mode,
      cardId,
      expectedVersion,
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

    if (mode === 'new') {
      if (!title) throw new Error('title is required for mode=new');
      if (!project) throw new Error('project is required for mode=new');
      validatePlanningInput({ ...planningInput, column, title, project });
      const decision = validateTransition(creationBaseline(), requested, {
        origin: 'mcp',
        actor: 'mcp',
        isCreation: true,
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
      );
      const persisted = Object.fromEntries(
        Object.entries(decision.patch).filter(([key]) => !['title', 'description', 'project', 'column', 'priority', 'tags', 'assignees', 'dueAt'].includes(key)),
      ) as KanbanCardUpdates;
      const card = Object.keys(persisted).length > 0
        ? updateCard(basicCard.id, persisted, undefined, tasksDir) as KanbanCard
        : basicCard;
      return textResult({ card, scope, transition: decision });
    }

    if (!cardId) throw new Error('cardId is required for mode=edit');
    const before = findCardById(cardId, tasksDir);
    if (!before) throw new Error(`Card ${cardId} not found`);
    const decision = validateTransition(before, requested, { origin: 'mcp', actor: 'mcp' });
    if (decision.kind === 'rejected') throw new Error(decision.reason);
    const result = updateCard(cardId, decision.patch, expectedVersion, tasksDir);
    if ('conflict' in result) throw new Error(`Version conflict for card ${cardId}`);
    return textResult({ card: result, scope, transition: decision });
  });

  server.registerTool('kanban.delete', {
    title: 'Delete a Kanban card',
    description: 'Delete one card from the authorized board by id.',
    inputSchema: { cardId: z.string().min(1) },
    annotations: { openWorldHint: false },
  }, async ({ cardId }) => {
    const deleted = deleteCard(cardId, tasksDir);
    if (!deleted) throw new Error(`Card ${cardId} not found`);
    return textResult({ cardId, deleted: true, scope });
  });

  return server;
}
