import { describe, expect, it, vi } from 'vitest';
import { sendTaskAiStart } from './task-ai-launch';

describe('task AI launch', () => {
  const card = { id: 'fixture', version: 3 };
  const target = { previewId: 'a'.repeat(64), cardVersion: 3, hostId: 'server-100', harness: 'codex', model: 'model', runtimeInstanceId: 'r', selectable: true };
  it('stores the idempotency key before sending exactly one version-bound request', async () => {
    const events: string[] = [];
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn(() => { events.push('stored'); }) };
    const send = vi.fn(async (_url: string, init: RequestInit) => {
      events.push('sent');
      expect(JSON.parse(String(init.body))).toEqual({ expectedVersion: 3, operationId: 'test-operation-key-123', targetPreviewId: target.previewId });
      return { ok: true } as Response;
    });
    expect(await sendTaskAiStart(card, target, storage, send, () => 'test-operation-key-123')).toBe('accepted');
    expect(events).toEqual(['stored', 'sent', 'stored']);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('never sends if an operation is already recorded or storage fails', async () => {
    const send = vi.fn();
    expect(await sendTaskAiStart(card, target, { getItem: () => 'pending', setItem: () => {} }, send, () => 'test-operation-key-123')).toBe('existing');
    expect(await sendTaskAiStart(card, target, { getItem: () => null, setItem: () => { throw Error('storage'); } }, send, () => 'test-operation-key-123')).toBe('not-sent');
    expect(send).not.toHaveBeenCalled();
  });
});
