import path from 'node:path';
import type { KanbanCard, TaskExecutionReceipt } from './types';

export type SessionLiveState = 'running' | 'waiting' | 'idle' | 'stopped' | 'error' | 'unknown';
export interface SessionStatusRead {
  cardId: string;
  cardVersion: number;
  operationId: string;
  sessionId: string | null;
  state: SessionLiveState;
  source: 'agent-herder:agent_info' | null;
  /** Set only after an exact, successful provider observation. */
  checkedAt: string | null;
  /** Provider timestamp only; receipt age never establishes a stalled session. */
  lastActivityAt: string | null;
  reason: string | null;
}

interface NativeSessionTarget {
  hostId: string;
  harness: 'codex' | 'zcode' | 'opencode';
  sessionId: string;
  cwd: string;
  model: string;
}
interface ReadDependencies {
  readSession: (args: Pick<NativeSessionTarget, 'hostId' | 'harness' | 'sessionId'>, timeoutMs: number) => Promise<unknown>;
  readCard: () => KanbanCard | undefined;
  legacyCwd?: string;
  now?: () => Date;
}
export interface SessionStatusReadResult { status: number; body: SessionStatusRead }

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const boundedText = (value: unknown): value is string => typeof value === 'string'
  && value.length > 0 && value.length <= 512 && value === value.trim() && !/[\x00-\x1f\x7f]/.test(value);
const absoluteCwd = (value: unknown): value is string => typeof value === 'string'
  && value.length > 0 && value.length <= 4096 && !/[\x00-\x1f\x7f]/.test(value) && path.isAbsolute(value);

/** The request selects a stored operation only, never a host, session, model or path. */
export function sessionStatusOperation(params: URLSearchParams): string | null {
  if (params.getAll('session').length !== 1 || params.get('session') !== 'status'
    || params.getAll('operationId').length !== 1
    || [...params.keys()].some(key => key !== 'session' && key !== 'operationId')) return null;
  const operationId = params.get('operationId');
  return operationId && /^[A-Za-z0-9_-]{16,128}$/.test(operationId) ? operationId : null;
}

/** Match the native execution route's recorded binding and explicit legacy contract. */
function targetFor(card: KanbanCard, receipt: TaskExecutionReceipt, legacyCwd?: string): NativeSessionTarget | null {
  if (!['codex', 'zcode', 'opencode'].includes(receipt.harness)
    || !boundedText(receipt.hostId) || !boundedText(receipt.nativeSessionId)) return null;
  const binding = receipt.projectBinding;
  if (binding) {
    if (binding.contract !== 'integrator-host-readiness-v1' || binding.projectId !== card.project
      || binding.hostId !== receipt.hostId || binding.harness !== receipt.harness
      || !absoluteCwd(binding.cwd) || !boundedText(binding.model)) return null;
    return { hostId: receipt.hostId, harness: binding.harness, sessionId: receipt.nativeSessionId,
      cwd: binding.cwd, model: binding.model };
  }
  let cwd: string | undefined;
  if (receipt.createReceiptText) {
    try {
      const created: unknown = JSON.parse(receipt.createReceiptText);
      if (isRecord(created) && absoluteCwd(created.cwd)) cwd = created.cwd;
    } catch { /* Older text receipts use the same configured legacy path as execution. */ }
  }
  if (!cwd && absoluteCwd(legacyCwd?.trim())) cwd = path.resolve(legacyCwd!.trim());
  // This is the existing legacy launch model, not a fallback for a broken scoped binding.
  return cwd ? { hostId: receipt.hostId, harness: receipt.harness as NativeSessionTarget['harness'],
    sessionId: receipt.nativeSessionId, cwd, model: 'gpt-6-luna' } : null;
}

function providerTime(value: unknown): string | null {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value)) ? value : null;
}

/** Only this documented provider field establishes the observed session state. */
function stateOf(status: unknown): SessionLiveState {
  switch (status) {
    case 'running': return 'running';
    case 'needs_input': return 'waiting';
    case 'idle': return 'idle';
    case 'stopped': return 'stopped';
    case 'error': return 'error';
    default: return 'unknown';
  }
}

function unchanged(card: KanbanCard, current: KanbanCard | undefined, receipt: TaskExecutionReceipt): boolean {
  if (!current || current.id !== card.id || current.version !== card.version || current.project !== card.project
    || current.owner !== card.owner || current.assignee !== card.assignee
    || JSON.stringify(current.assignees) !== JSON.stringify(card.assignees)) return false;
  const matches = (current.taskExecutionHistory ?? []).filter(item => item.operationId === receipt.operationId);
  return matches.length === 1 && JSON.stringify(matches[0]) === JSON.stringify(receipt);
}

/**
 * Observe one already-bound session. No card write, result sync, question sweep,
 * dispatch, source-intent consumption or executor control is reachable here.
 * Authorize the card through the existing execution read policy before calling.
 */
export async function readBoundSessionStatus(card: KanbanCard, operationId: string,
  dependencies: ReadDependencies): Promise<SessionStatusReadResult> {
  const matches = (card.taskExecutionHistory ?? []).filter(item => item.operationId === operationId);
  const receipt = matches.length === 1 ? matches[0] : undefined;
  const initial: SessionStatusRead = {
    cardId: card.id, cardVersion: card.version, operationId,
    sessionId: receipt && boundedText(receipt.nativeSessionId) ? receipt.nativeSessionId : null,
    state: 'unknown', source: null, checkedAt: null, lastActivityAt: null, reason: null,
  };
  const unknown = (reason: string, status = 200): SessionStatusReadResult => ({ status, body: { ...initial, reason } });
  if (!matches.length) return unknown('operation_not_found', 404);
  if (!receipt) return unknown('operation_ambiguous', 409);
  if (receipt.provider === 'dot' || receipt.harness === 'dot') return unknown('provider_not_supported');
  if (!receipt.nativeSessionId) return unknown('session_not_recorded');
  const target = targetFor(card, receipt, dependencies.legacyCwd);
  if (!target) return unknown('session_binding_unavailable', 409);

  let result: unknown;
  try {
    result = await dependencies.readSession({ hostId: target.hostId, harness: target.harness, sessionId: target.sessionId }, 8_000);
  } catch (failure) {
    return unknown(failure instanceof Error && failure.message === 'task_execution_transport_unconfigured'
      ? 'transport_unconfigured' : 'transport_unavailable', 503);
  }
  let current: KanbanCard | undefined;
  try { current = dependencies.readCard(); } catch { return unknown('card_read_unavailable', 503); }
  if (!unchanged(card, current, receipt)) return unknown('card_changed', 409);
  if (!isRecord(result) || result.isError === true) return unknown('provider_response_unavailable', 502);
  const structured = isRecord(result.structuredContent) ? result.structuredContent : null;
  const session = structured && isRecord(structured.session) ? structured.session : null;
  if (!session || structured?.error || session.id !== target.sessionId || session.hostId !== target.hostId
    || session.harness !== target.harness || session.cwd !== target.cwd || session.model !== target.model) {
    return unknown('session_identity_unverified', 502);
  }
  const state = stateOf(session.status);
  return { status: 200, body: {
    ...initial, state, source: 'agent-herder:agent_info',
    checkedAt: (dependencies.now?.() ?? new Date()).toISOString(),
    lastActivityAt: providerTime(session.lastActivity),
    reason: state === 'unknown' ? 'status_unknown' : null,
  } };
}
