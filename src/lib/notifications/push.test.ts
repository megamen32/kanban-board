import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { dispatchNotification } from './push';
import { upsertSubscription } from './store';

const { sendNotification, setVapidDetails } = vi.hoisted(() => ({
  sendNotification: vi.fn().mockResolvedValue({}),
  setVapidDetails: vi.fn(),
}));

vi.mock('web-push', () => ({
  default: { sendNotification, setVapidDetails },
}));

const files: string[] = [];

function tempStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-push-dispatch-'));
  const file = path.join(directory, 'subscriptions.json');
  files.push(directory);
  return file;
}

afterEach(() => {
  sendNotification.mockClear();
  setVapidDetails.mockClear();
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
  while (files.length) fs.rmSync(files.pop()!, { recursive: true, force: true });
});

describe('web push dispatch', () => {
  test('sends one JSON payload to a stored subscription and claims the event once', async () => {
    process.env.VAPID_PUBLIC_KEY = 'public';
    process.env.VAPID_PRIVATE_KEY = 'private';
    process.env.VAPID_SUBJECT = 'mailto:owner@example.test';
    const file = tempStore();
    upsertSubscription({
      endpoint: 'https://push.example.test/send/abc',
      keys: { p256dh: 'BAbcdefghijklmnopqrstuvwxyz0123456789-_', auth: 'YWJjZGVmZ2hpamtsbW5vcA' },
      scope: 'work',
      owner: 'anonymous',
      deviceId: 'device-1',
    }, file);

    await expect(dispatchNotification({
      scope: 'work',
      eventKey: 'work:card-1:v2:updated',
      payload: { title: 'Карточка обновлена', body: 'Проверьте задачу', tag: 'card-1' },
      storePath: file,
    })).resolves.toMatchObject({ sent: 1, skipped: false });
    await expect(dispatchNotification({
      scope: 'work',
      eventKey: 'work:card-1:v2:updated',
      payload: { title: 'Карточка обновлена', body: 'Проверьте задачу', tag: 'card-1' },
      storePath: file,
    })).resolves.toMatchObject({ sent: 0, skipped: true });

    expect(setVapidDetails).toHaveBeenCalledWith('mailto:owner@example.test', 'public', 'private');
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sendNotification.mock.calls[0][1])).toMatchObject({ title: 'Карточка обновлена' });
  });

  test('retries an event after a transient delivery failure', async () => {
    process.env.VAPID_PUBLIC_KEY = 'public';
    process.env.VAPID_PRIVATE_KEY = 'private';
    process.env.VAPID_SUBJECT = 'mailto:owner@example.test';
    const file = tempStore();
    upsertSubscription({
      endpoint: 'https://push.example.test/send/retry',
      keys: { p256dh: 'BAbcdefghijklmnopqrstuvwxyz0123456789-_', auth: 'YWJjZGVmZ2hpamtsbW5vcA' },
      scope: 'work',
      owner: 'anonymous',
      deviceId: 'device-retry',
    }, file);
    sendNotification.mockRejectedValueOnce(new Error('temporary push failure')).mockResolvedValueOnce({});
    const input = {
      scope: 'work' as const,
      eventKey: 'work:card-retry:v1:updated',
      payload: { title: 'Карточка обновлена', body: 'Повторите отправку', tag: 'card-retry' },
      storePath: file,
    };

    await expect(dispatchNotification(input)).resolves.toMatchObject({ sent: 0, failed: 1, skipped: false });
    await expect(dispatchNotification(input)).resolves.toMatchObject({ sent: 1, failed: 0, skipped: false });

    expect(sendNotification).toHaveBeenCalledTimes(2);
  });

  test('retries only the device that transiently failed an event', async () => {
    process.env.VAPID_PUBLIC_KEY = 'public';
    process.env.VAPID_PRIVATE_KEY = 'private';
    process.env.VAPID_SUBJECT = 'mailto:owner@example.test';
    const file = tempStore();
    const firstEndpoint = 'https://push.example.test/send/first';
    const retryEndpoint = 'https://push.example.test/send/retry-only';
    for (const [endpoint, deviceId] of [[firstEndpoint, 'device-first'], [retryEndpoint, 'device-retry']] as const) {
      upsertSubscription({
        endpoint,
        keys: { p256dh: 'BAbcdefghijklmnopqrstuvwxyz0123456789-_', auth: 'YWJjZGVmZ2hpamtsbW5vcA' },
        scope: 'work',
        owner: 'anonymous',
        deviceId,
      }, file);
    }
    sendNotification.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('temporary push failure')).mockResolvedValueOnce({});
    const input = {
      scope: 'work' as const,
      eventKey: 'work:card-partial:v1:updated',
      payload: { title: 'Карточка обновлена', body: 'Повторите отправку только на сбойном устройстве', tag: 'card-partial' },
      storePath: file,
    };

    await expect(dispatchNotification(input)).resolves.toMatchObject({ sent: 1, failed: 1, skipped: false });
    await expect(dispatchNotification(input)).resolves.toMatchObject({ sent: 1, failed: 0, skipped: false });
    await expect(dispatchNotification(input)).resolves.toMatchObject({ sent: 0, failed: 0, skipped: true });

    expect(sendNotification.mock.calls.map(([subscription]) => subscription.endpoint)).toEqual([
      firstEndpoint,
      retryEndpoint,
      retryEndpoint,
    ]);
  });

  test('leases an in-flight event delivery to one concurrent dispatch', async () => {
    process.env.VAPID_PUBLIC_KEY = 'public';
    process.env.VAPID_PRIVATE_KEY = 'private';
    process.env.VAPID_SUBJECT = 'mailto:owner@example.test';
    const file = tempStore();
    upsertSubscription({
      endpoint: 'https://push.example.test/send/concurrent',
      keys: { p256dh: 'BAbcdefghijklmnopqrstuvwxyz0123456789-_', auth: 'YWJjZGVmZ2hpamtsbW5vcA' },
      scope: 'work',
      owner: 'anonymous',
      deviceId: 'device-concurrent',
    }, file);
    let releaseSend!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    const delayedSend = new Promise<void>(resolve => { releaseSend = resolve; });
    sendNotification.mockImplementationOnce(async () => {
      markStarted();
      await delayedSend;
    });
    const input = {
      scope: 'work' as const,
      eventKey: 'work:card-concurrent:v1:updated',
      payload: { title: 'Карточка обновлена', body: 'Не дублируйте доставку', tag: 'card-concurrent' },
      storePath: file,
    };

    const first = dispatchNotification(input);
    await started;
    const concurrent = dispatchNotification(input);
    await Promise.resolve();

    try {
      expect(sendNotification).toHaveBeenCalledTimes(1);
    } finally {
      releaseSend();
      const [firstResult, concurrentResult] = await Promise.all([first, concurrent]);
      expect(firstResult).toMatchObject({ sent: 1, skipped: false });
      expect(concurrentResult).toMatchObject({ sent: 0, skipped: true });
    }
  });
});
