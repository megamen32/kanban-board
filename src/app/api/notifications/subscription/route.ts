import { NextRequest, NextResponse } from 'next/server';
import { getNotificationConfig } from '@/lib/notifications/config';
import { hasSubscription, removeSubscription, upsertSubscription } from '@/lib/notifications/store';
import { notificationRequestContext, setDeviceCookie } from '@/lib/notifications/request';
import { validatePushSubscription } from '@/lib/notifications/validation';
import { startDueReminderScheduler } from '@/lib/notifications/scheduler';

export const runtime = 'nodejs';

function configured(): boolean {
  const config = getNotificationConfig();
  return Boolean(config.publicKey && config.privateKey && config.subject);
}

export async function GET(request: NextRequest) {
  startDueReminderScheduler();
  const context = notificationRequestContext(request);
  const response = NextResponse.json({
    enabled: configured(),
    subscribed: hasSubscription(context.scope, context.owner, context.deviceId),
  });
  if (context.needsCookie) setDeviceCookie(response, context.deviceId);
  return response;
}

export async function POST(request: NextRequest) {
  startDueReminderScheduler();
  if (!configured()) return NextResponse.json({ error: 'push notifications are not configured' }, { status: 503 });
  const context = notificationRequestContext(request);
  try {
    const body = await request.json();
    const subscription = validatePushSubscription(body.subscription || body);
    upsertSubscription({ ...subscription, scope: context.scope, owner: context.owner, deviceId: context.deviceId });
    const response = NextResponse.json({ enabled: true, subscribed: true }, { status: 201 });
    if (context.needsCookie) setDeviceCookie(response, context.deviceId);
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'invalid subscription' }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  startDueReminderScheduler();
  const context = notificationRequestContext(request);
  let endpoint: string | undefined;
  try {
    const body = await request.json();
    if (typeof body.endpoint === 'string') endpoint = body.endpoint;
  } catch {
    // DELETE without a body removes all subscriptions for this device.
  }
  const removed = removeSubscription(context.scope, context.owner, context.deviceId, endpoint);
  const response = NextResponse.json({ enabled: configured(), subscribed: false, removed });
  if (context.needsCookie) setDeviceCookie(response, context.deviceId);
  return response;
}
