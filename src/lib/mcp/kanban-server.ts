import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createCard, deleteCard, findCardById, getAllCards, updateCard } from '../kanban/file-store';
import { normalizeDueAt } from '../kanban/due-at';
import { tasksDirForScope } from '../auth/data-scope';
import type { BoardScope } from '../auth/scopes';
import type { KanbanCard, KanbanColumn, Priority } from '../kanban/types';

const COLUMNS = ['inbox', 'todo', 'in-progress', 'review', 'done', 'archived'] as const;
const PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;

const cardInput = {
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  project: z.string().min(1).optional(),
  column: z.enum(COLUMNS).optional(),
  priority: z.enum(PRIORITIES).optional(),
  tags: z.array(z.string()).max(20).optional(),
  assignees: z.array(z.string()).max(20).optional(),
  dueAt: z.string().optional(),
};

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
  }, async ({ mode, cardId, expectedVersion, title, description, project, column, priority, tags, assignees, dueAt }) => {
    if (mode === 'new') {
      if (!title) throw new Error('title is required for mode=new');
      if (!project) throw new Error('project is required for mode=new');
      const normalizedDueAt = normalizeDueAt(dueAt) || undefined;
      const card = createCard(title, description || '', column, priority, tags, project, assignees, tasksDir, normalizedDueAt);
      return textResult({ card, scope });
    }

    if (!cardId) throw new Error('cardId is required for mode=edit');
    const normalizedDueAt = dueAt === undefined ? undefined : normalizeDueAt(dueAt, true);
    const result = updateCard(cardId, {
      ...(title !== undefined ? { title } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(project !== undefined ? { project } : {}),
      ...(column !== undefined ? { column } : {}),
      ...(priority !== undefined ? { priority } : {}),
      ...(tags !== undefined ? { tags } : {}),
      ...(assignees !== undefined ? { assignees } : {}),
      ...(normalizedDueAt !== undefined ? { dueAt: normalizedDueAt } : {}),
    }, expectedVersion, tasksDir);
    if ('conflict' in result) throw new Error(`Version conflict for card ${cardId}`);
    return textResult({ card: result, scope });
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
