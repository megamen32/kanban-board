import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { listPendingSourceIntents } from '../../../../../../lib/kanban/source-operation';
import type { KanbanCard, TaskExecutionReceipt } from '../../../../../../lib/kanban/types';
import { POST as executionRoutePost } from './route';

/**
 * B04a: the one consumer of the ID-only source-intent outbox.
 *
 * The journal keeps one launch intent per admitted explicit task. This consumer
 * reads exactly ONE pending intent, takes the card that intent belongs to, and
 * hands that card to the existing execution route under the operation identity
 * the intent already owns. It never starts work by itself and never writes the
 * journal: the terminal intent transition belongs to the execution route
 * (B04c/B04d), so a repeated call can only reuse the receipt already stored.
 */

/** The execution route derives its receipt identity from sha256(`${cardId}\0${rawOperationId}`). */
export function sourceIntentOperationId(cardId: string, operationKey: string): string {
  return createHash('sha256').update(`${cardId}\0${operationKey}`).digest('hex');
}

export interface SourceIntentLaunchRequest {
  cardId: string;
  /** Stable identity of the source operation; the launch never invents a new id. */
  operationKey: string;
  intentId: string;
  /** Operation identity the execution route will store in the receipt. */
  operationId: string;
  /** Board version the launch expects; the route refuses a stale card. */
  expectedVersion: number;
  card: KanbanCard;
}

export type SourceIntentLaunchOutcome =
  | { status: 'launched' | 'replayed' | 'unknown'; operationId: string; receipt?: TaskExecutionReceipt }
  | { status: 'refused'; operationId: string; reason: string };

export type SourceIntentConsumerResult =
  | { status: 'launched' | 'replayed' | 'unknown'; cardId: string; operationKey: string; intentId: string; operationId: string; receipt?: TaskExecutionReceipt }
  | { status: 'idle' }
  | { status: 'skipped'; reason: 'card-missing'; cardId: string; operationKey: string; intentId: string }
  | { status: 'refused'; reason: string; cardId: string; operationKey: string; intentId: string; operationId: string };

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Read exactly one pending intent and hand its card to the existing launch path. */
export async function consumeOnePendingSourceIntent(input: {
  tasksDir: string;
  findCard: (id: string) => KanbanCard | null;
  launch: (request: SourceIntentLaunchRequest) => Promise<SourceIntentLaunchOutcome>;
}): Promise<SourceIntentConsumerResult> {
  const [pending] = listPendingSourceIntents(input.tasksDir, input.findCard);
  if (!pending) return { status: 'idle' };
  const intentId = pending.intentId;
  // The pending view only lists launch intents, so this guard is unreachable in practice.
  if (typeof intentId !== 'string' || !intentId.trim()) return { status: 'idle' };
  const card = input.findCard(pending.cardId);
  if (!card) {
    return { status: 'skipped', reason: 'card-missing', cardId: pending.cardId, operationKey: pending.operationKey, intentId };
  }
  const request: SourceIntentLaunchRequest = {
    cardId: pending.cardId,
    operationKey: pending.operationKey,
    intentId,
    operationId: sourceIntentOperationId(pending.cardId, pending.operationKey),
    expectedVersion: card.version,
    card,
  };
  const outcome = await input.launch(request);
  if (outcome.status === 'refused') {
    return {
      status: 'refused', reason: outcome.reason,
      cardId: pending.cardId, operationKey: pending.operationKey, intentId, operationId: request.operationId,
    };
  }
  return {
    status: outcome.status,
    cardId: pending.cardId, operationKey: pending.operationKey, intentId, operationId: request.operationId,
    ...(outcome.receipt ? { receipt: outcome.receipt } : {}),
  };
}

/** Hand the card to the existing execution route; no second launch path exists here. */
export async function launchSourceIntentThroughExecutionRoute(
  request: SourceIntentLaunchRequest,
  headers: Record<string, string> = {},
  findCard?: (id: string) => KanbanCard | null,
): Promise<SourceIntentLaunchOutcome> {
  const url = `http://localhost/api/kanban/cards/${encodeURIComponent(request.cardId)}/execution`;
  const response = await executionRoutePost(new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ expectedVersion: request.expectedVersion, operationId: request.operationKey }),
  }), { params: Promise.resolve({ id: request.cardId }) });
  const payload = await response.json().catch(() => null) as unknown;
  const receipt = findCard ? receiptOf(findCard(request.cardId), request.operationId) : undefined;
  if (response.status === 201) return { status: 'launched', operationId: request.operationId, ...(receipt ? { receipt } : {}) };
  if (response.status === 200) return { status: 'replayed', operationId: request.operationId, ...(receipt ? { receipt } : {}) };
  if (response.status === 202) return { status: 'unknown', operationId: request.operationId, ...(receipt ? { receipt } : {}) };
  return { status: 'refused', operationId: request.operationId, reason: refusalReason(payload, response.status) };
}

/** One pending intent -> the existing execution route, under the caller's own credentials. */
export async function consumeNextSourceIntentLaunch(input: {
  tasksDir: string;
  findCard: (id: string) => KanbanCard | null;
  headers?: Record<string, string>;
}): Promise<SourceIntentConsumerResult> {
  return consumeOnePendingSourceIntent({
    tasksDir: input.tasksDir,
    findCard: input.findCard,
    launch: request => launchSourceIntentThroughExecutionRoute(request, input.headers, input.findCard),
  });
}

function receiptOf(card: KanbanCard | null, operationId: string): TaskExecutionReceipt | undefined {
  const history = card?.taskExecutionHistory ?? [];
  const receipt = history.find(entry => isRecord(entry) && entry.operationId === operationId);
  return receipt ? receipt as unknown as TaskExecutionReceipt : undefined;
}

function refusalReason(payload: unknown, status: number): string {
  if (isRecord(payload) && typeof payload.error === 'string' && payload.error.trim()) return payload.error.trim();
  if (isRecord(payload) && typeof payload.reason === 'string' && payload.reason.trim()) return payload.reason.trim();
  return `execution route refused the launch with status ${status}`;
}
