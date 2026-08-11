import { NextResponse } from 'next/server';
import { getNotificationConfig } from '@/lib/notifications/config';

export const runtime = 'nodejs';

export async function GET() {
  const { publicKey, privateKey, subject } = getNotificationConfig();
  if (!publicKey || !privateKey || !subject) {
    return NextResponse.json({ enabled: false, error: 'push notifications are not configured' }, { status: 503 });
  }
  return NextResponse.json({ enabled: true, publicKey });
}
