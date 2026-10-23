import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { KanbanCard, SourceAdmissionBinding } from './types';

export type SourceClassification = 'explicit-task' | 'idea' | 'ambiguous';

export interface SourceOperationIdentity {
  tenant: string;
  sourceOwner: string;
  sourceEvent: string;
  primaryItem: 'primary';
}

export interface SourceAdmissionRequest extends SourceOperationIdentity {
  sourceRevision: string;
  project: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  assignees: string[];
  dueAt?: string;
  classification: SourceClassification;
  evidenceRefs: string[];
}

export interface SourceOperationRecord {
  operationKey: string;
  requestHash: string;
  provenanceHash: string;
  cardId: string;
  /** Old version-1 records without classification/intent fields are explicit tasks. */
  classification?: SourceClassification;
  intentId?: string;
  intentState: 'WAITING_FOR_COMMIT' | 'PENDING' | 'CONSUMED' | 'CANCELLED' | 'NOT_APPLICABLE';
  state: 'PREPARED' | 'COMMITTED' | 'CANCELLED';
  publication: 'NOT_STARTED' | 'ATTEMPTED';
  updatedAt: string;
}

interface Journal {
  version: 1;
  operations: Record<string, SourceOperationRecord>;
}

export type SourceAdmissionResult =
  | { status: 'committed' | 'replayed'; cardId: string; classification: SourceClassification; intentId?: string; requestHash: string }
  | { status: 'pending'; reason: 'publication_outcome_unknown' | 'committed_card_missing' | 'card_binding_mismatch'; cardId: string; classification: SourceClassification; intentId?: string; requestHash: string }
  | { status: 'cancelled'; cardId: string; classification: SourceClassification; intentId?: string; requestHash: string }
  | { status: 'conflict'; reason: 'same_identity_different_request' | 'card_id_collision'; cardId: string; intentId?: string; requestHash: string };

const JOURNAL_NAME = 'source-operations.json';
const LOCK_NAME = '.source-operations.writer.lock';

function journalPath(tasksDir: string): string {
  return path.join(tasksDir, '.source-operations', JOURNAL_NAME);
}

function fsyncDirectory(dir: string): void {
  const fd = fs.openSync(dir, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function durableJson(filePath: string, value: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(value)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, filePath);
  fsyncDirectory(dir);
}

function readJournal(tasksDir: string): Journal {
  const file = journalPath(tasksDir);
  if (!fs.existsSync(file)) return { version: 1, operations: {} };
  const value = JSON.parse(fs.readFileSync(file, 'utf8')) as Journal;
  if (value.version !== 1 || !value.operations || typeof value.operations !== 'object') {
    throw new Error('source operation journal is invalid; admission is unavailable');
  }
  return value;
}

function writeJournal(tasksDir: string, journal: Journal): void {
  durableJson(journalPath(tasksDir), journal);
}

/**
 * Kernel advisory lock held through the parent's open-file description. The
 * helper exits after flock acquisition; this process retains the inherited
 * descriptor until finally closes it, and process death releases it in-kernel.
 */
export function withSourceOperationLock<T>(tasksDir: string, fn: () => T): T {
  fs.mkdirSync(tasksDir, { recursive: true });
  const lockPath = path.join(tasksDir, LOCK_NAME);
  const fd = fs.openSync(lockPath, 'a', 0o600);
  try {
    const acquired = spawnSync('/usr/bin/flock', ['-x', '-w', '15', '3'], {
      stdio: ['ignore', 'ignore', 'pipe', fd],
      timeout: 16_000,
    });
    if (acquired.error) throw acquired.error;
    if (acquired.status !== 0) throw new Error(`kernel source operation lock failed with status ${acquired.status}`);
    // flock's descriptor 3 shares this open-file description. Its exit does
    // not release the lock while the parent descriptor remains open.
    return fn();
  } finally {
    fs.closeSync(fd);
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function operationKey(identity: SourceOperationIdentity): string {
  const stableIdentity: SourceOperationIdentity = {
    tenant: identity.tenant,
    sourceOwner: identity.sourceOwner,
    sourceEvent: identity.sourceEvent,
    primaryItem: identity.primaryItem,
  };
  return crypto.createHash('sha256').update(canonical(stableIdentity)).digest('hex');
}

function requestHash(request: SourceAdmissionRequest): string {
  // Source revision and project are frozen request inputs, not uniqueness keys.
  return crypto.createHash('sha256').update(canonical(request)).digest('hex');
}

function provenanceFields(value: SourceAdmissionRequest | SourceAdmissionBinding) {
  if ('tenant' in value) {
    return {
      tenantId: value.tenant,
      sourceOwnerId: value.sourceOwner,
      sourceEventId: value.sourceEvent,
      primaryItem: value.primaryItem,
      sourceRevision: value.sourceRevision,
      requestedProject: value.project,
      classification: value.classification,
      evidenceRefs: [...value.evidenceRefs],
    };
  }
  return {
    tenantId: value.tenantId,
    sourceOwnerId: value.sourceOwnerId,
    sourceEventId: value.sourceEventId,
    primaryItem: value.primaryItem,
    sourceRevision: value.sourceRevision,
    requestedProject: value.requestedProject,
    classification: value.classification,
    evidenceRefs: [...value.evidenceRefs],
  };
}

function provenanceHash(request: SourceAdmissionRequest): string {
  return crypto.createHash('sha256').update(canonical(provenanceFields(request))).digest('hex');
}

export function validateSourceAdmissionRequest(request: SourceAdmissionRequest): void {
  const allowed = new Set(['tenant', 'sourceOwner', 'sourceEvent', 'primaryItem', 'sourceRevision', 'project', 'title', 'description', 'priority', 'assignees', 'dueAt', 'classification', 'evidenceRefs']);
  if (Object.keys(request).some(key => !allowed.has(key))) throw new Error('unknown source admission field');
  if (request.primaryItem !== 'primary') throw new Error('only the fixed primary source item is supported');
  if (!['low', 'medium', 'high', 'critical'].includes(request.priority)) throw new Error('invalid source admission priority');
  if (!['explicit-task', 'idea', 'ambiguous'].includes(request.classification)) throw new Error('invalid source admission classification');
  for (const key of ['tenant', 'sourceOwner', 'sourceEvent', 'sourceRevision', 'project', 'title'] as const) {
    if (typeof request[key] !== 'string' || !request[key].trim()) throw new Error(`invalid source admission ${key}`);
  }
  for (const key of ['tenant', 'sourceOwner', 'sourceEvent', 'sourceRevision'] as const) {
    if (request[key].length > 512 || /\s/.test(request[key])) throw new Error(`source admission ${key} must be an ID`);
  }
  if (typeof request.description !== 'string') throw new Error('invalid source admission description');
  if (request.dueAt !== undefined && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(request.dueAt)
      || Number.isNaN(Date.parse(request.dueAt)))) throw new Error('invalid source admission dueAt');
  if (!Array.isArray(request.evidenceRefs) || request.evidenceRefs.length === 0) throw new Error('canonical source evidence is required');
  if (request.evidenceRefs.some(ref => ref.length > 512 || /\s/.test(ref))) throw new Error('source evidence references must be IDs');
  for (const [key, value] of Object.entries(request)) {
    if (key === 'assignees' || key === 'evidenceRefs') {
      if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) throw new Error(`invalid source admission ${key}`);
    } else if (key === 'dueAt' && value === undefined) {
      continue;
    } else if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`invalid source admission ${key}`);
    }
  }
}

export function sourceAdmissionBinding(record: Pick<SourceOperationRecord, 'requestHash' | 'provenanceHash' | 'intentId' | 'operationKey'>, request: SourceAdmissionRequest): SourceAdmissionBinding {
  return {
    operationKey: record.operationKey,
    requestHash: record.requestHash,
    provenanceHash: record.provenanceHash,
    ...(record.intentId ? { intentId: record.intentId } : {}),
    ...provenanceFields(request),
  };
}

export function sourceAdmissionMatches(card: KanbanCard | null, record: SourceOperationRecord, request?: SourceAdmissionRequest): boolean {
  const binding = card?.sourceAdmission;
  if (!card || card.id !== record.cardId || !binding || typeof binding !== 'object'
      || typeof binding.operationKey !== 'string' || typeof binding.requestHash !== 'string'
      || typeof binding.provenanceHash !== 'string'
      || typeof binding.tenantId !== 'string' || typeof binding.sourceOwnerId !== 'string'
      || typeof binding.sourceEventId !== 'string' || binding.primaryItem !== 'primary'
      || typeof binding.sourceRevision !== 'string' || typeof binding.requestedProject !== 'string'
      || !['explicit-task', 'idea', 'ambiguous'].includes(binding.classification) || !Array.isArray(binding.evidenceRefs)
      || binding.evidenceRefs.some(ref => typeof ref !== 'string')) return false;
  const classification = record.classification ?? 'explicit-task';
  const intentMatches = classification === 'explicit-task'
    ? typeof binding.intentId === 'string' && typeof record.intentId === 'string' && binding.intentId === record.intentId
    : binding.intentId === undefined && record.intentId === undefined;
  if (!(binding
    && binding.operationKey === record.operationKey
    && binding.requestHash === record.requestHash
    && binding.provenanceHash === record.provenanceHash
    && binding.classification === classification
    && intentMatches
    && crypto.createHash('sha256').update(canonical(provenanceFields(binding))).digest('hex') === record.provenanceHash)) return false;
  return !request || canonical(provenanceFields(binding)) === canonical(provenanceFields(request));
}

/** Verify the initial projection while the source-operation writer lock is held. */
function sourceOutcomePlacementMatches(card: KanbanCard, classification: SourceClassification): boolean {
  if (classification === 'idea') return card.column === 'someday' && card.needsReview !== true;
  if (classification === 'ambiguous') return card.column === 'inbox' && card.needsReview === true;
  return true;
}

export interface AdmissionHooks {
  afterReserve?: () => void;
  beforePublish?: () => void;
  afterPublish?: () => void;
  afterCommit?: () => void;
}

function outcomeFields(record: SourceOperationRecord) {
  return {
    classification: record.classification ?? 'explicit-task' as const,
    ...(record.intentId ? { intentId: record.intentId } : {}),
  };
}

/**
 * Board-owned one-primary-item admission. Call only after a trusted adapter has
 * resolved source owner/event identity and authenticated the human principal.
 */
export function admitSourceTask(
  request: SourceAdmissionRequest,
  tasksDir: string,
  findCard: (id: string) => KanbanCard | null,
  publishCard: (input: SourceAdmissionRequest & { id: string; sourceAdmission: SourceAdmissionBinding }) => KanbanCard,
  hooks: AdmissionHooks = {},
): SourceAdmissionResult {
  validateSourceAdmissionRequest(request);
  return withSourceOperationLock(tasksDir, () => {
    const key = operationKey(request);
    const hash = requestHash(request);
    const frozenProvenanceHash = provenanceHash(request);
    const journal = readJournal(tasksDir);
    let record = journal.operations[key];
    if (record && record.requestHash !== hash) {
      return { status: 'conflict', reason: 'same_identity_different_request', cardId: record.cardId, intentId: record.intentId, requestHash: record.requestHash };
    }
    if (record?.state === 'CANCELLED') return { status: 'cancelled', cardId: record.cardId, ...outcomeFields(record), requestHash: record.requestHash };
    if (record?.state === 'COMMITTED') {
      const card = findCard(record.cardId);
      return sourceAdmissionMatches(card, record, request)
        ? { status: 'replayed', cardId: record.cardId, ...outcomeFields(record), requestHash: record.requestHash }
        : { status: 'pending', reason: 'committed_card_missing', cardId: record.cardId, ...outcomeFields(record), requestHash: record.requestHash };
    }
    if (!record) {
      record = {
        operationKey: key,
        requestHash: hash,
        provenanceHash: frozenProvenanceHash,
        cardId: crypto.randomUUID(),
        ...(request.classification !== 'explicit-task' ? { classification: request.classification } : {}),
        ...(request.classification === 'explicit-task' ? { intentId: crypto.randomUUID() } : {}),
        intentState: request.classification === 'explicit-task' ? 'WAITING_FOR_COMMIT' : 'NOT_APPLICABLE',
        state: 'PREPARED',
        publication: 'NOT_STARTED',
        updatedAt: new Date().toISOString(),
      };
      journal.operations[key] = record;
      writeJournal(tasksDir, journal);
      hooks.afterReserve?.();
    }

    const card = findCard(record.cardId);
    if (card) {
      if (!sourceAdmissionMatches(card, record, request)) {
        return { status: 'pending', reason: 'card_binding_mismatch', cardId: record.cardId, ...outcomeFields(record), requestHash: record.requestHash };
      }
      record.state = 'COMMITTED';
      if (record.intentId) record.intentState = 'PENDING';
      record.updatedAt = new Date().toISOString();
      writeJournal(tasksDir, journal);
      return { status: 'replayed', cardId: record.cardId, ...outcomeFields(record), requestHash: record.requestHash };
    }
    if (record.publication === 'ATTEMPTED') {
      return { status: 'pending', reason: 'publication_outcome_unknown', cardId: record.cardId, ...outcomeFields(record), requestHash: record.requestHash };
    }

    // ATTEMPTED is durable before the Markdown publication. If a crash leaves
    // no card, identical retry remains UNKNOWN; payload presence proves nothing.
    record.publication = 'ATTEMPTED';
    record.updatedAt = new Date().toISOString();
    writeJournal(tasksDir, journal);
    hooks.beforePublish?.();
    const created = publishCard({ ...request, id: record.cardId, sourceAdmission: sourceAdmissionBinding(record, request) });
    if (!sourceAdmissionMatches(created, record, request)
        || !sourceOutcomePlacementMatches(created, request.classification)) {
      throw new Error('published card did not retain its reserved source outcome');
    }
    hooks.afterPublish?.();
    const verified = findCard(record.cardId);
    if (!verified || !sourceAdmissionMatches(verified, record, request)
        || !sourceOutcomePlacementMatches(verified, request.classification)) {
      throw new Error('published source card readback failed; operation remains pending');
    }
    record.state = 'COMMITTED';
    if (record.intentId) record.intentState = 'PENDING';
    record.updatedAt = new Date().toISOString();
    writeJournal(tasksDir, journal);
    hooks.afterCommit?.();
    return { status: 'committed', cardId: record.cardId, ...outcomeFields(record), requestHash: record.requestHash };
  });
}
/** Persist terminal cancellation before any bound card is physically removed. Caller holds the writer lock. */
export function cancelSourceOperationForCardLocked(card: KanbanCard, tasksDir: string): void {
  if (!card.sourceAdmission) return;
  const journal = readJournal(tasksDir);
  const record = journal.operations[card.sourceAdmission.operationKey];
  if (!record || record.cardId !== card.id || !sourceAdmissionMatches(card, record)) {
    throw new Error('source admission journal mismatch; refusing card deletion');
  }
  if (record.state !== 'CANCELLED') {
    record.state = 'CANCELLED';
    if (record.intentId) record.intentState = 'CANCELLED';
    record.updatedAt = new Date().toISOString();
    writeJournal(tasksDir, journal);
  }
}

/**
 * ID-only outbox view for the later designated dispatcher; it never launches work.
 * Terminal intents (CANCELLED, CONSUMED) are never issued again.
 */
export function listPendingSourceIntents(tasksDir: string, findCard: (id: string) => KanbanCard | null): Array<Pick<SourceOperationRecord, 'operationKey' | 'requestHash' | 'cardId' | 'intentId'>> {
  return withSourceOperationLock(tasksDir, () => {
    const journal = readJournal(tasksDir);
    return Object.values(journal.operations)
      .filter(record => (record.classification ?? 'explicit-task') === 'explicit-task'
        && typeof record.intentId === 'string' && record.state === 'COMMITTED'
        && record.intentState === 'PENDING' && sourceAdmissionMatches(findCard(record.cardId), record))
      .map(({ operationKey, requestHash, cardId, intentId }) => ({ operationKey, requestHash, cardId, intentId }));
  });
}

export type SourceIntentConsumptionResult =
  | { status: 'consumed'; operationKey: string; cardId: string; intentId: string }
  | { status: 'already-consumed'; operationKey: string; cardId: string; intentId: string }
  | { status: 'not-consumable'; reason: 'not-a-launch-intent' | 'intent-not-pending' | 'operation-not-committed'; operationKey: string; cardId: string; intentId?: string };

/**
 * Terminal transition of a launch intent: the designated launch path already
 * committed its receipt, so the intent is spent and must never be issued again.
 * The caller owns the launch and the receipt proof; this function owns only the
 * journal state, so it never starts work and never touches the card.
 *
 * Idempotent: a repeated call reports `already-consumed` and leaves the journal
 * byte-identical. Call it without holding the writer lock.
 */
export function markSourceIntentConsumed(
  tasksDir: string,
  consumption: { operationKey: string; intentId: string },
): SourceIntentConsumptionResult {
  return withSourceOperationLock(tasksDir, () => {
    const journal = readJournal(tasksDir);
    const record = journal.operations[consumption.operationKey];
    if (!record) throw new Error('unknown source operation; refusing intent consumption');
    const intentId = record.intentId;
    if (typeof intentId !== 'string') {
      return { status: 'not-consumable', reason: 'not-a-launch-intent', operationKey: record.operationKey, cardId: record.cardId };
    }
    if (intentId !== consumption.intentId) {
      throw new Error('source intent id mismatch; refusing intent consumption');
    }
    if (record.intentState === 'CONSUMED') {
      return { status: 'already-consumed', operationKey: record.operationKey, cardId: record.cardId, intentId };
    }
    if (record.state === 'CANCELLED' || record.intentState === 'CANCELLED') {
      return { status: 'not-consumable', reason: 'intent-not-pending', operationKey: record.operationKey, cardId: record.cardId, intentId };
    }
    if (record.state !== 'COMMITTED') {
      return { status: 'not-consumable', reason: 'operation-not-committed', operationKey: record.operationKey, cardId: record.cardId, intentId };
    }
    if (record.intentState !== 'PENDING') {
      return { status: 'not-consumable', reason: 'intent-not-pending', operationKey: record.operationKey, cardId: record.cardId, intentId };
    }
    record.intentState = 'CONSUMED';
    record.updatedAt = new Date().toISOString();
    writeJournal(tasksDir, journal);
    return { status: 'consumed', operationKey: record.operationKey, cardId: record.cardId, intentId };
  });
}
