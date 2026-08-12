import { z } from 'zod';
import { createCard, updateCard } from './file-store';
import { getRoles } from './roles-store';
import type { KanbanCard, KanbanColumn, Priority } from './types';

const DEFAULT_URL = 'http://192.168.2.5:4000/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';

const itemSchema = z.object({
  title: z.string().trim().min(3).max(180),
  description: z.string().trim().max(4_000).default(''),
  project: z.string().trim().min(1).max(80).default('Inbox'),
  role: z.string().trim().min(1).max(120).optional(),
  assignee: z.string().trim().min(1).max(80).optional(),
  dueAt: z.string().datetime({ offset: true }).optional(),
  important: z.boolean().default(false),
  urgent: z.boolean().default(false),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  confidence: z.number().min(0).max(1).default(0),
});

const responseSchema = z.object({ tasks: z.array(itemSchema).max(12) });

type SecretaryItem = z.infer<typeof itemSchema>;

export class SecretaryUnavailableError extends Error {}

function jsonObjectFromModel(content: string): unknown {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Kanban secretary returned an invalid task list');
  try { return JSON.parse(trimmed.slice(start, end + 1)); }
  catch { throw new Error('Kanban secretary returned an invalid task list'); }
}

function modelConfig() {
  const apiKey = process.env.KANBAN_LITELLM_API_KEY?.trim();
  if (!apiKey) throw new SecretaryUnavailableError('Kanban secretary is waiting for its LiteLLM key');
  return {
    apiKey,
    url: (process.env.KANBAN_LITELLM_URL || DEFAULT_URL).replace(/\/$/, ''),
    model: process.env.KANBAN_LITELLM_MODEL || DEFAULT_MODEL,
  };
}

function systemPrompt(owner: string, roles: string[]): string {
  return `Kanban secretary for ${owner}. Return JSON only, no markdown.\nSchema: {"tasks":[{"title":"verb + result","description":"string","project":"string","role":"optional; one of ${roles.join(', ') || 'none'}","assignee":"optional only if named","dueAt":"optional RFC3339 only if explicit","important":true,"urgent":false,"priority":"low|medium|high|critical","confidence":0.0}]}\nSplit independent requests. Never invent assignee, deadline, completion, weekly plan, or big rock. Current time: ${new Date().toISOString()}.\nExample: {"tasks":[{"title":"Подготовить тестовый отчёт","description":"","project":"EE Frontier","assignee":"marina","important":true,"urgent":false,"priority":"medium","confidence":0.9}]}`;
}

export async function extractSecretaryTasks(text: string, owner: string): Promise<SecretaryItem[]> {
  const config = modelConfig();
  const roles = getRoles(owner).map(role => role.label);
  const response = await fetch(`${config.url}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.1,
      messages: [
        { role: 'system', content: systemPrompt(owner, roles) },
        { role: 'user', content: text },
      ],
    }),
  });
  if (!response.ok) throw new Error('Kanban secretary could not reach the model');
  const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('Kanban secretary returned no structured answer');
  const parsed = responseSchema.safeParse(jsonObjectFromModel(content));
  if (!parsed.success) throw new Error('Kanban secretary returned an invalid task list');
  return parsed.data.tasks;
}

/** Persist classified tasks while retaining the raw transcript in every card. */
export function persistSecretaryTasks(items: SecretaryItem[], text: string, owner: string, tasksDir: string): KanbanCard[] {
  return items.map(item => {
    const trusted = item.confidence >= 0.8;
    const column: KanbanColumn = trusted ? 'todo' : 'inbox';
    const card = createCard(item.title, `${item.description}\n\n---\nИсточник: ${text}`, column, item.priority as Priority, ['secretary'], item.project, item.assignee ? [item.assignee] : [], tasksDir, item.dueAt);
    return updateCard(card.id, {
      owner,
      source: 'transcript:secretary',
      type: 'action',
      role: item.role,
      assignee: item.assignee,
      important: item.important,
      urgent: item.urgent,
      needsReview: !trusted,
      ...(trusted ? {} : { suggestedAssignee: item.assignee }),
    }, undefined, tasksDir) as KanbanCard;
  });
}
