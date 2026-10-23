import { NextRequest, NextResponse } from 'next/server';
import { nativeProjectAccessContextFromRequest } from '../../../../../lib/auth/request';
import { tasksDirForScope } from '../../../../../lib/auth/data-scope';
import { findCardById } from '../../../../../lib/kanban/file-store';
import { withNativeProjectContext } from '../../../../../lib/kanban/native-request-context';
import { consumeNextSourceIntentLaunch } from '../../cards/[id]/execution/source-intent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The one native-authenticated entry that dispatches a pending source intent.
 *
 * The caller proves its identity with the signed native assertion the board
 * already trusts, the very same seam the card execution route uses. With that
 * identity the entry consumes exactly ONE pending source intent and hands the
 * card to the existing execution route, so the launch, its durable receipt and
 * the terminal intent transition (B04c/B04d) stay in one place. Without a
 * verified native identity there is no launch at all.
 */
export async function POST(request: NextRequest) {
  let nativeContext;
  try {
    nativeContext = await nativeProjectAccessContextFromRequest(request);
  } catch (error) {
    const reason = error instanceof Error ? error.message : '';
    return NextResponse.json({ error: 'native execution identity could not be verified' }, {
      status: reason === 'native_identity_unconfigured' ? 503 : 403,
    });
  }
  if (!nativeContext) {
    return NextResponse.json({ error: 'native execution identity required' }, { status: 401 });
  }
  const tasksDir = tasksDirForScope('work');
  const findCard = (id: string) => findCardById(id, tasksDir);
  const result = await withNativeProjectContext(nativeContext, () =>
    consumeNextSourceIntentLaunch({ tasksDir, findCard }));
  return NextResponse.json(result);
}
