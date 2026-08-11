import type { BoardScope } from '@/lib/auth/scopes';

export interface PushSubscriptionPayload {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface StoredPushSubscription extends PushSubscriptionPayload {
  scope: BoardScope;
  owner: string;
  deviceId: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationPayload {
  title: string;
  body: string;
  tag?: string;
  url?: string;
}

export interface NotificationDispatchResult {
  sent: number;
  failed: number;
  removed: number;
  skipped: boolean;
  disabled?: boolean;
}
