import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { BoardScope } from '@/lib/auth/scopes';
import { subscriptionsFilePath } from './config';
import type { PushSubscriptionPayload, StoredPushSubscription } from './types';

interface NotificationStoreFile {
  version: 1;
  subscriptions: StoredPushSubscription[];
  deliveredEvents: Array<{ key: string; endpoint?: string; claimedAt: string }>;
}

function emptyStore(): NotificationStoreFile {
  return { version: 1, subscriptions: [], deliveredEvents: [] };
}

function readStore(filePath = subscriptionsFilePath()): NotificationStoreFile {
  if (!fs.existsSync(filePath)) return emptyStore();
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<NotificationStoreFile>;
  if (parsed.version !== 1 || !Array.isArray(parsed.subscriptions) || !Array.isArray(parsed.deliveredEvents)) {
    throw new Error('push subscription store format is invalid');
  }
  return {
    version: 1,
    subscriptions: parsed.subscriptions,
    deliveredEvents: parsed.deliveredEvents,
  };
}

function writeStore(store: NotificationStoreFile, filePath = subscriptionsFilePath()): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(store, null, 2), { mode: 0o600 });
  fs.chmodSync(temporaryPath, 0o600);
  fs.renameSync(temporaryPath, filePath);
}

export function listSubscriptions(scope?: BoardScope, filePath = subscriptionsFilePath()): StoredPushSubscription[] {
  const subscriptions = readStore(filePath).subscriptions;
  return scope ? subscriptions.filter(subscription => subscription.scope === scope) : subscriptions;
}

export function upsertSubscription(
  input: PushSubscriptionPayload & Pick<StoredPushSubscription, 'scope' | 'owner' | 'deviceId'>,
  filePath = subscriptionsFilePath(),
): StoredPushSubscription {
  const store = readStore(filePath);
  const now = new Date().toISOString();
  const existing = store.subscriptions.find(subscription => subscription.endpoint === input.endpoint);
  const record: StoredPushSubscription = {
    ...input,
    ...(input.expirationTime === undefined ? {} : { expirationTime: input.expirationTime }),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  store.subscriptions = existing
    ? store.subscriptions.map(subscription => subscription.endpoint === input.endpoint ? record : subscription)
    : [...store.subscriptions, record];
  writeStore(store, filePath);
  return record;
}

export function hasSubscription(scope: BoardScope, owner: string, deviceId: string, filePath = subscriptionsFilePath()): boolean {
  return readStore(filePath).subscriptions.some(subscription =>
    subscription.scope === scope && subscription.owner === owner && subscription.deviceId === deviceId,
  );
}

export function removeSubscription(
  scope: BoardScope,
  owner: string,
  deviceId: string,
  endpoint?: string,
  filePath = subscriptionsFilePath(),
): number {
  const store = readStore(filePath);
  const retained = store.subscriptions.filter(subscription => !(
    subscription.scope === scope
    && subscription.owner === owner
    && subscription.deviceId === deviceId
    && (!endpoint || subscription.endpoint === endpoint)
  ));
  const removed = store.subscriptions.length - retained.length;
  if (removed > 0) {
    store.subscriptions = retained;
    writeStore(store, filePath);
  }
  return removed;
}

export function claimEvent(eventKey: string, filePath = subscriptionsFilePath()): boolean {
  const store = readStore(filePath);
  const now = Date.now();
  const retainedEvents = store.deliveredEvents.filter(event => now - new Date(event.claimedAt).getTime() < 7 * 24 * 60 * 60 * 1000);
  if (retainedEvents.some(event => event.key === eventKey)) return false;
  retainedEvents.push({ key: eventKey, claimedAt: new Date(now).toISOString() });
  store.deliveredEvents = retainedEvents.slice(-1000);
  writeStore(store, filePath);
  return true;
}

export function isEventClaimed(eventKey: string, filePath = subscriptionsFilePath()): boolean {
  const now = Date.now();
  return readStore(filePath).deliveredEvents.some(event =>
    event.key === eventKey && now - new Date(event.claimedAt).getTime() < 7 * 24 * 60 * 60 * 1000,
  );
}

export function isSubscriptionEventClaimed(eventKey: string, endpoint: string, filePath = subscriptionsFilePath()): boolean {
  const now = Date.now();
  return readStore(filePath).deliveredEvents.some(event =>
    event.key === eventKey
    && (!event.endpoint || event.endpoint === endpoint)
    && now - new Date(event.claimedAt).getTime() < 7 * 24 * 60 * 60 * 1000,
  );
}

export function claimSubscriptionEvent(eventKey: string, endpoint: string, filePath = subscriptionsFilePath()): boolean {
  const store = readStore(filePath);
  const now = Date.now();
  const retainedEvents = store.deliveredEvents.filter(event => now - new Date(event.claimedAt).getTime() < 7 * 24 * 60 * 60 * 1000);
  if (retainedEvents.some(event => event.key === eventKey && (!event.endpoint || event.endpoint === endpoint))) return false;
  retainedEvents.push({ key: eventKey, endpoint, claimedAt: new Date(now).toISOString() });
  store.deliveredEvents = retainedEvents.slice(-1000);
  writeStore(store, filePath);
  return true;
}
