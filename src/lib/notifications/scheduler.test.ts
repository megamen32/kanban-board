import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { runDueReminderTick } from './scheduler';
import { upsertSubscription } from './store';

const sendNotification = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const setVapidDetails = vi.hoisted(() => vi.fn());

vi.mock('web-push', () => ({
  default: { sendNotification, setVapidDetails },
}));

const roots: string[] = [];

afterEach(() => {
  sendNotification.mockClear();
  setVapidDetails.mockClear();
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('due reminder scheduler', () => {
  test('dispatches an overdue card once and deduplicates the next tick', async () => {
    process.env.VAPID_PUBLIC_KEY = 'public';
    process.env.VAPID_PRIVATE_KEY = 'private';
    process.env.VAPID_SUBJECT = 'mailto:owner@example.test';
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-due-scheduler-'));
    const storePath = path.join(root, 'subscriptions.json');
    const tasksDir = path.join(root, 'tasks');
    roots.push(root);
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.writeFileSync(path.join(tasksDir, 'due.md'), `---\nid: due-1\ntitle: Due soon\ncolumn: todo\nproject: alpha\ndueAt: "2030-01-02T03:04:05.000Z"\n---\nBody`);
    upsertSubscription({
      endpoint: 'https://push.example.test/send/due',
      keys: { p256dh: 'BAbcdefghijklmnopqrstuvwxyz0123456789-_', auth: 'YWJjZGVmZ2hpamtsbW5vcA' },
      scope: 'work',
      owner: 'anonymous',
      deviceId: 'device-1',
    }, storePath);

    const now = new Date('2030-01-02T03:05:00.000Z');
    expect(await runDueReminderTick(now, { scopes: ['work'], tasksDir: () => tasksDir, storePath })).toBe(1);
    expect(await runDueReminderTick(now, { scopes: ['work'], tasksDir: () => tasksDir, storePath })).toBe(0);
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });
});
