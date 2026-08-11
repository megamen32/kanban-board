import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { claimEvent, hasSubscription, removeSubscription, upsertSubscription } from './store';

const files: string[] = [];
const subscription = {
  endpoint: 'https://push.example.test/send/abc',
  keys: { p256dh: 'BAbcdefghijklmnopqrstuvwxyz0123456789-_', auth: 'YWJjZGVmZ2hpamtsbW5vcA' },
  scope: 'work' as const,
  owner: 'anonymous',
  deviceId: 'device-1',
};

function tempStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-push-store-'));
  const file = path.join(directory, 'subscriptions.json');
  files.push(directory);
  return file;
}

afterEach(() => {
  while (files.length) fs.rmSync(files.pop()!, { recursive: true, force: true });
});

describe('durable push subscription store', () => {
  test('upserts idempotently, survives a fresh read, and removes only the device subscription', () => {
    const file = tempStore();
    upsertSubscription(subscription, file);
    upsertSubscription(subscription, file);

    expect(hasSubscription('work', 'anonymous', 'device-1', file)).toBe(true);
    expect(removeSubscription('work', 'anonymous', 'other-device', subscription.endpoint, file)).toBe(0);
    expect(removeSubscription('work', 'anonymous', 'device-1', subscription.endpoint, file)).toBe(1);
    expect(hasSubscription('work', 'anonymous', 'device-1', file)).toBe(false);
  });

  test('deduplicates an event key across retries', () => {
    const file = tempStore();
    expect(claimEvent('work:card-1:v2:updated', file)).toBe(true);
    expect(claimEvent('work:card-1:v2:updated', file)).toBe(false);
  });
});
