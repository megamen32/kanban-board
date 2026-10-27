import { NextResponse } from 'next/server';
import { airlockRelayConfig } from '../../../../../lib/auth/airlock-relay';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Exposes only whether this host can start the configured Airlock relay. */
export async function GET() {
  return airlockRelayConfig().enabled
    ? new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
    : NextResponse.json({ enabled: false }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
}
