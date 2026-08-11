import { randomUUID } from 'node:crypto';
import type { NextRequest, NextResponse } from 'next/server';
import { boardIdentityFromRequest } from '@/lib/auth/request';

export const DEVICE_COOKIE = 'kanban_device_id';

export function notificationRequestContext(request: NextRequest): {
  scope: ReturnType<typeof boardIdentityFromRequest>['scope'];
  owner: string;
  deviceId: string;
  needsCookie: boolean;
} {
  const identity = boardIdentityFromRequest(request);
  const cookieValue = request.cookies.get(DEVICE_COOKIE)?.value?.trim();
  const deviceId = cookieValue || randomUUID();
  return { scope: identity.scope, owner: identity.username, deviceId, needsCookie: !cookieValue };
}

export function setDeviceCookie(response: NextResponse, deviceId: string): void {
  response.cookies.set({
    name: DEVICE_COOKIE,
    value: deviceId,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 365,
    path: '/',
  });
}
