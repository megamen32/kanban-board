import path from 'node:path';

export interface NotificationConfig {
  publicKey: string | null;
  privateKey: string | null;
  subject: string | null;
}

function env(name: string): string | null {
  const value = process.env[name]?.trim();
  return value || null;
}

export function getNotificationConfig(): NotificationConfig {
  return {
    publicKey: env('VAPID_PUBLIC_KEY'),
    privateKey: env('VAPID_PRIVATE_KEY'),
    subject: env('VAPID_SUBJECT'),
  };
}

export function isNotificationConfigured(): boolean {
  const config = getNotificationConfig();
  return Boolean(config.publicKey && config.privateKey && config.subject);
}

export function subscriptionsFilePath(): string {
  const configured = env('PUSH_SUBSCRIPTIONS_FILE');
  if (configured) return configured;

  const authDir = env('KANBAN_AUTH_DIR');
  if (authDir) return path.join(authDir, 'push-subscriptions.json');

  const tasksDir = env('TASKS_DIR') || path.join(process.cwd(), 'data', 'tasks');
  return path.join(tasksDir, '.kanban', 'push-subscriptions.json');
}

export function reminderIntervalMs(): number {
  const value = Number(process.env.PUSH_REMINDER_INTERVAL_MS || 60_000);
  return Number.isFinite(value) && value >= 10_000 ? value : 60_000;
}

export function reminderLookbackHours(): number {
  const value = Number(process.env.PUSH_REMINDER_LOOKBACK_HOURS || 24);
  return Number.isFinite(value) && value > 0 ? value : 24;
}
