import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { extractSecretaryTasks, persistSecretaryTasks, SecretaryUnavailableError } from './secretary';

describe('Kanban secretary', () => {
  const saved = process.env.KANBAN_LITELLM_API_KEY;
  beforeEach(() => { process.env.KANBAN_LITELLM_API_KEY = 'test-key'; });
  afterEach(() => { if (saved) process.env.KANBAN_LITELLM_API_KEY = saved; else delete process.env.KANBAN_LITELLM_API_KEY; vi.restoreAllMocks(); });

  test('accepts a concise structured task list from the model', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ tasks: [{ title: 'Send Marina the brief', project: 'EE Frontier', assignee: 'marina', confidence: 0.95 }] }) } }] }), { status: 200 })));
    await expect(extractSecretaryTasks('Марине отправить бриф', 'nikita')).resolves.toMatchObject([{ assignee: 'marina', confidence: 0.95 }]);
  });

  test('accepts JSON wrapped in a local-model code block', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '```json\n{"tasks":[]}\n```' } }] }), { status: 200 })));
    await expect(extractSecretaryTasks('Разобрать заметку', 'nikita')).resolves.toEqual([]);
  });

  test('is explicitly unavailable until the runtime key exists', async () => {
    delete process.env.KANBAN_LITELLM_API_KEY;
    await expect(extractSecretaryTasks('Разобрать заметку', 'nikita')).rejects.toBeInstanceOf(SecretaryUnavailableError);
  });

  test('writes a confident classified task and retains its source transcript', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-secretary-'));
    try {
      const [card] = persistSecretaryTasks([{
        title: 'Send Marina the brief', description: 'Final positioning', project: 'EE Frontier',
        role: 'Руководитель команды', assignee: 'marina', important: true, urgent: false,
        priority: 'high', confidence: 0.95,
      }], 'Марине отправить финальное позиционирование', 'nikita', root);
      expect(card).toMatchObject({ column: 'todo', role: 'Руководитель команды', assignee: 'marina', needsReview: false });
      expect(fs.readFileSync(path.join(root, card.fileName), 'utf8')).toContain('Марине отправить финальное позиционирование');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
