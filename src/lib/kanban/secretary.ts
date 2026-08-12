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
  return `You are the Kanban secretary for ${owner}. Convert one Russian or English voice-note transcript into actionable cards. Return JSON only: {"tasks":[...]}.\n\nRules:\n- Split independent requests into 1-12 concise tasks: verb + observable result.\n- Use project and one role only when the transcript supports it. Valid personal roles: ${roles.join(', ') || 'none configured'}.\n- assignee may be filled only when the transcript explicitly names who should do it.\n- dueAt may be filled only for an explicit deadline. Convert relative dates using current time ${new Date().toISOString()}.\n- Never create a deadline, assignee, completion, big rock, or weekly plan from a guess.\n- important/urgent are your best classification; confidence measures the whole task extraction.\n- For uncertainty use confidence below 0.8 and omit unsupported fields.`;
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
