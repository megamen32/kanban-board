import { NextRequest, NextResponse } from 'next/server';
import { dispatchTestNotification } from '@/lib/notifications/push';
import { notificationRequestContext, setDeviceCookie } from '@/lib/notifications/request';
import { startDueReminderScheduler } from '@/lib/notifications/scheduler';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  startDueReminderScheduler();
  const context = notificationRequestContext(request);
  const result = await dispatchTestNotification(context.scope, context.owner, context.deviceId).catch(() => ({ sent: 0, failed: 1, removed: 0, skipped: false, disabled: false }));
  const response = NextResponse.json({ ok: result.sent > 0, ...result }, { status: result.disabled ? 503 : 200 });
  if (context.needsCookie) setDeviceCookie(response, context.deviceId);
  return response;
}
