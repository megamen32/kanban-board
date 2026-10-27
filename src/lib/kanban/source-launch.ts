import type { BoardScope } from '../auth/scopes';
import { tasksDirForScope } from '../auth/data-scope';
import { findCardById } from './file-store';
import { listPendingSourceIntents } from './source-operation';

/**
 * B04b: the server-side entry that launches ONE pending source intent.
 *
 * The execution route accepts exactly one service identity today: the access
 * token of the board owner. The server tick has no browser cookie and no
 * native assertion, so it presents the dedicated owner access token of the
 * launch path.
 *
 * The token is presented only for a card that already passed source
 * admission: the pending-intent view is the only source of card ids here, and
 * a card without a pending launch intent is refused before the route is
 * called at all. No other card may reach the route with this identity.
 */

export type SourceLaunchStatus = 'idle' | 'launched' | 'replayed' | 'unknown' | 'skipped' | 'refused';

export interface SourceLaunchOutcome {
  status: SourceLaunchStatus;
  scope: BoardScope;
  cardId?: string;
  reason?: string;
}

/** The dedicated owner access token of the source-intent launch path. */
export function sourceLaunchAccessToken(): string | null {
  return process.env.KANBAN_SOURCE_LAUNCH_ACCESS_TOKEN?.trim() || null;
}

/**
 * Launch one pending source intent of this scope, if the journal still owns
 * one. The execution route stays the only launch path: this entry owns the
 * identity and the admission gate, never the launch itself.
 */
export async function consumeSourceIntentLaunchOnce(
  scope: BoardScope,
  options: { tasksDir?: string; cardId?: string } = {},
): Promise<SourceLaunchOutcome> {
  const tasksDir = options.tasksDir ?? tasksDirForScope(scope);
  const findCard = (id: string) => findCardById(id, tasksDir);
  // Only a source-admitted card with a pending launch intent may be launched.
  const pending = listPendingSourceIntents(tasksDir, findCard);
  if (options.cardId && !pending.some(entry => entry.cardId === options.cardId)) {
    return { status: 'refused', scope, cardId: options.cardId, reason: 'card has no pending source intent' };
  }
  const accessToken = sourceLaunchAccessToken();
  if (!accessToken) {
    return { status: 'refused', scope, reason: 'source launch access token is not configured' };
  }
  // The consumer lives next to the execution route it calls; the import stays
  // dynamic so the background tick never pulls the route into its own module graph.
  const { consumeNextSourceIntentLaunch } = await import('../../app/api/kanban/cards/[id]/execution/source-intent');
  const result = await consumeNextSourceIntentLaunch({
    tasksDir,
    findCard,
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (result.status === 'idle') return { status: 'idle', scope };
  if (result.status === 'refused') return { status: 'refused', scope, cardId: result.cardId, reason: result.reason };
  return { status: result.status, scope, cardId: result.cardId };
}
