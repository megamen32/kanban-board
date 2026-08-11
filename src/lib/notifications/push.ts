import webPush from 'web-push';
import type { BoardScope } from '@/lib/auth/scopes';
import { getNotificationConfig, subscriptionsFilePath, isNotificationConfigured } from './config';
import { claimSubscriptionEvent, isSubscriptionEventClaimed, listSubscriptions, removeSubscription } from './store';
import type { KanbanCard } from '@/lib/kanban/types';
import type { NotificationDispatchResult, NotificationPayload } from './types';

let configuredFingerprint: string | null = null;
const inFlightDeliveries = new Set<string>();

function deliveryLeaseKey(storePath: string, eventKey: string, endpoint: string): string {
  return `${storePath}\u0000${eventKey}\u0000${endpoint}`;
}

function configuredClient(): typeof webPush | null {
  const config = getNotificationConfig();
  if (!config.publicKey || !config.privateKey || !config.subject) return null;
  const fingerprint = `${config.subject}:${config.publicKey}:${config.privateKey}`;
  if (configuredFingerprint !== fingerprint) {
    webPush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
    configuredFingerprint = fingerprint;
  }
  return webPush;
}

function statusCode(error: unknown): number | null {
  if (typeof error === 'object' && error !== null && 'statusCode' in error && typeof error.statusCode === 'number') {
    return error.statusCode;
  }
  return null;
}

export async function dispatchNotification(input: {
  scope: BoardScope;
  eventKey: string;
  payload: NotificationPayload;
  storePath?: string;
  owner?: string;
  deviceId?: string;
}): Promise<NotificationDispatchResult> {
  const client = configuredClient();
  if (!client || !isNotificationConfigured()) {
    return { sent: 0, failed: 0, removed: 0, skipped: false, disabled: true };
  }

  const storePath = input.storePath || subscriptionsFilePath();
  const subscriptions = listSubscriptions(input.scope, storePath).filter(subscription =>
    (!input.owner || subscription.owner === input.owner)
    && (!input.deviceId || subscription.deviceId === input.deviceId),
  );
  const pendingSubscriptions = subscriptions.filter(subscription =>
    !isSubscriptionEventClaimed(input.eventKey, subscription.endpoint, storePath),
  );
  if (subscriptions.length > 0 && pendingSubscriptions.length === 0) {
    return { sent: 0, failed: 0, removed: 0, skipped: true };
  }
  let sent = 0;
  let failed = 0;
  let removed = 0;
  for (const subscription of pendingSubscriptions) {
    const leaseKey = deliveryLeaseKey(storePath, input.eventKey, subscription.endpoint);
    if (inFlightDeliveries.has(leaseKey)) continue;
    inFlightDeliveries.add(leaseKey);
    try {
      await client.sendNotification(
        { endpoint: subscription.endpoint, keys: subscription.keys, expirationTime: subscription.expirationTime },
        JSON.stringify(input.payload),
        { TTL: 300 },
      );
      sent += 1;
      claimSubscriptionEvent(input.eventKey, subscription.endpoint, storePath);
    } catch (error) {
      failed += 1;
      if (statusCode(error) === 404 || statusCode(error) === 410) {
        removed += removeSubscription(subscription.scope, subscription.owner, subscription.deviceId, subscription.endpoint, storePath);
      }
    } finally {
      inFlightDeliveries.delete(leaseKey);
    }
  }
  return { sent, failed, removed, skipped: subscriptions.length > 0 && sent === 0 && failed === 0 };
}

export function cardNotificationPayload(kind: 'created' | 'updated' | 'moved' | 'reordered' | 'deleted', card: KanbanCard): NotificationPayload {
  const labels = {
    created: 'Новая карточка',
    updated: 'Карточка обновлена',
    moved: 'Карточка перемещена',
    reordered: 'Порядок карточек изменён',
    deleted: 'Карточка удалена',
  } as const;
  return {
    title: labels[kind],
    body: card.title,
    tag: `card-${card.id}-${kind}`,
    url: `/?card=${encodeURIComponent(card.id)}`,
  };
}

export async function dispatchCardEvent(
  scope: BoardScope,
  kind: 'created' | 'updated' | 'moved' | 'reordered' | 'deleted',
  card: KanbanCard,
  storePath = subscriptionsFilePath(),
): Promise<NotificationDispatchResult> {
  return dispatchNotification({
    scope,
    eventKey: `${scope}:${card.id}:v${card.version}:${kind}`,
    payload: cardNotificationPayload(kind, card),
    storePath,
  });
}

export async function dispatchDueReminder(
  scope: BoardScope,
  card: KanbanCard,
  storePath = subscriptionsFilePath(),
): Promise<NotificationDispatchResult> {
  return dispatchNotification({
    scope,
    eventKey: `${scope}:${card.id}:due:${card.dueAt}`,
    payload: {
      title: 'Срок задачи',
      body: card.title,
      tag: `due-${card.id}`,
      url: `/?card=${encodeURIComponent(card.id)}`,
    },
    storePath,
  });
}

export async function dispatchTestNotification(
  scope: BoardScope,
  owner: string,
  deviceId: string,
  storePath = subscriptionsFilePath(),
): Promise<NotificationDispatchResult> {
  return dispatchNotification({
    scope,
    owner,
    deviceId,
    eventKey: `${scope}:${owner}:${deviceId}:test:${Date.now()}`,
    payload: {
      title: 'Уведомления включены',
      body: 'Kanban может присылать изменения и сроки.',
      tag: 'kanban-test',
      url: '/',
    },
    storePath,
  });
}
