import { findCatalogTaskLink, persistCatalogTaskLink, readCatalogTaskLinkForReplay } from './file-store';
import { parseCatalogTaskLink, type CatalogTaskLink } from './types';

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface CatalogTaskLinkRequest {
  taskId: string;
  expectedBoardVersion: number;
  sourceRef: string;
  sourceRevision: string;
  projectId: string;
  planIds: string[];
  gateIds: string[];
  contactIds: string[];
  catalogRevision: string;
  operationRef: string;
}

export interface CatalogLinkEntity {
  id: string;
  projectId: string;
  originRefs: string[];
}

export interface CatalogLinkOwnerContext {
  task: { id: string; version: number; projectId: string };
  source: { ref: string; revision: string; state: string; projectId: string };
  catalog: {
    revision: string;
    project: { id: string; originRefs: string[] };
    plans: CatalogLinkEntity[];
    gates: CatalogLinkEntity[];
    contacts: CatalogLinkEntity[];
  };
}

export interface CatalogLinkOwnerReceipt {
  operationRef: string;
  link: CatalogTaskLink;
}

/** Injected only by a trusted server adapter; never accept it or its result from a request body. */
export interface CatalogLinkOwnerReader {
  /**
   * Must hold an owner-backed serializable lease against source revocation and
   * catalog revision changes through commit and readback. Snapshot reads or
   * boolean checks are not an implementation of this contract.
   */
  withLinkCommitGuard(
    request: CatalogTaskLinkRequest,
    commit: (current: CatalogLinkOwnerContext) => Promise<CatalogTaskLink>,
  ): Promise<CatalogLinkOwnerReceipt>;
}

export type CatalogTaskLinkResult = { status: 'created' | 'reused'; link: CatalogTaskLink };

export async function linkTaskToCatalog(
  request: CatalogTaskLinkRequest,
  options: { owner?: CatalogLinkOwnerReader; tasksDir?: string },
): Promise<CatalogTaskLinkResult> {
  if (!options?.owner || typeof options.owner.withLinkCommitGuard !== 'function') {
    throw new Error('trusted canonical owner readback is unavailable');
  }
  const normalized = normalizeRequest(request);
  const requestedLink = linkFromRequest(normalized);

  let status: CatalogTaskLinkResult['status'] = 'created';
  const receipt = await options.owner.withLinkCommitGuard(normalized, async context => {
    const existing = findCatalogTaskLink(normalized.taskId, options.tasksDir);
    if (existing) {
      if (!sameCatalogTaskLink(existing, requestedLink)) throw new Error('conflicting immutable catalog link');
      verifyOwnerContext(context, normalized, null);
      // The link commit itself increments the Board version exactly once. An
      // exact replay may observe that +1; any later card edit advances it again
      // and makes replay stale. This branch never authorizes a new write.
      const replay = readCatalogTaskLinkForReplay(normalized.taskId, normalized.expectedBoardVersion, requestedLink, options.tasksDir);
      if (replay.status === 'conflict') throw new Error('conflicting immutable catalog link');
      if (replay.status !== 'reused') throw new Error('stale board version for historical replay');
      status = 'reused';
      return replay.link;
    }
    verifyOwnerContext(context, normalized, normalized.expectedBoardVersion);
    const result = persistCatalogTaskLink(normalized.taskId, normalized.expectedBoardVersion, requestedLink, options.tasksDir);
    if (result.status === 'stale') {
      const replay = readCatalogTaskLinkForReplay(normalized.taskId, normalized.expectedBoardVersion, requestedLink, options.tasksDir);
      if (replay.status === 'conflict') throw new Error('conflicting immutable catalog link');
      if (replay.status !== 'reused') throw new Error('stale board version');
      status = 'reused';
      return replay.link;
    }
    if (result.status === 'conflict') throw new Error('conflicting immutable catalog link');
    if (!('link' in result)) throw new Error('unexpected canonical catalog write result');
    status = result.status;
    const readback = findCatalogTaskLink(normalized.taskId, options.tasksDir);
    if (!readback || !sameCatalogTaskLink(readback, result.link)) throw new Error('canonical Board readback mismatch');
    return readback;
  });
  if (!receipt || receipt.operationRef !== normalized.operationRef || !receipt.link
      || !sameCatalogTaskLink(receipt.link, requestedLink)) {
    throw new Error('trusted owner guard receipt is not bound to the requested link');
  }
  return { status, link: receipt.link };
}

function normalizeRequest(request: CatalogTaskLinkRequest): CatalogTaskLinkRequest {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('invalid canonical catalog link request');
  const allowed = new Set(['taskId', 'expectedBoardVersion', 'sourceRef', 'sourceRevision', 'projectId', 'planIds', 'gateIds', 'contactIds', 'catalogRevision', 'operationRef']);
  if (Object.keys(request).some(key => !allowed.has(key))) throw new Error('unknown canonical catalog link field');
  for (const name of ['taskId', 'sourceRef', 'sourceRevision', 'projectId', 'catalogRevision', 'operationRef'] as const) {
    const value = request[name];
    if (typeof value !== 'string' || !value || value.length > 512 || /\s/.test(value)) throw new Error(`invalid ${name}`);
  }
  if (!CANONICAL_UUID.test(request.taskId) || !CANONICAL_UUID.test(request.sourceRef)) throw new Error('task and source references must be UUIDs');
  if (!Number.isSafeInteger(request.expectedBoardVersion) || request.expectedBoardVersion < 1) throw new Error('invalid expected board version');
  return {
    ...request,
    planIds: normalizeIds(request.planIds, 'plan IDs'),
    gateIds: normalizeIds(request.gateIds, 'gate IDs'),
    contactIds: normalizeIds(request.contactIds, 'contact IDs'),
  };
}

function normalizeIds(ids: unknown, label: string): string[] {
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !id || id.length > 512 || /\s/.test(id))) {
    throw new Error(`invalid ${label}`);
  }
  const values = [...ids] as string[];
  if (new Set(values).size !== values.length) throw new Error(`ambiguous ${label}`);
  return values.sort();
}

function linkFromRequest(request: CatalogTaskLinkRequest): CatalogTaskLink {
  return parseCatalogTaskLink({
    version: 1,
    taskId: request.taskId,
    operationRef: request.operationRef,
    boardVersion: request.expectedBoardVersion,
    sourceRef: request.sourceRef,
    sourceRevision: request.sourceRevision,
    projectId: request.projectId,
    planIds: request.planIds,
    gateIds: request.gateIds,
    contactIds: request.contactIds,
    catalogRevision: request.catalogRevision,
  });
}

function verifyOwnerContext(context: CatalogLinkOwnerContext | null, request: CatalogTaskLinkRequest, expectedVersion: number | null): void {
  if (!context) throw new Error('current canonical owner scope is denied');
  if (context.task.id !== request.taskId || (expectedVersion !== null && context.task.version !== expectedVersion)) throw new Error('stale board task version');
  if (context.task.projectId !== request.projectId || context.source.projectId !== request.projectId) throw new Error('board task project mismatch');
  if (context.source.ref !== request.sourceRef || context.source.revision !== request.sourceRevision || context.source.state !== 'DECIDED') {
    throw new Error('source origin or causal revision mismatch');
  }
  if (context.catalog.revision !== request.catalogRevision || context.catalog.project.id !== request.projectId) {
    throw new Error('canonical catalog project or revision mismatch');
  }
  assertUniqueOrigin(context.catalog.project.originRefs, request.sourceRef, 'project');
  assertEntities(context.catalog.plans, request.planIds, request.projectId, request.sourceRef, 'plan');
  assertEntities(context.catalog.gates, request.gateIds, request.projectId, request.sourceRef, 'gate');
  assertEntities(context.catalog.contacts, request.contactIds, request.projectId, request.sourceRef, 'contact');
}

function assertEntities(entities: CatalogLinkEntity[], requestedIds: string[], projectId: string, sourceRef: string, kind: string): void {
  const byId = new Map<string, CatalogLinkEntity>();
  for (const entity of entities) {
    if (!entity.id || byId.has(entity.id)) throw new Error(`ambiguous canonical ${kind} ID`);
    byId.set(entity.id, entity);
  }
  for (const id of requestedIds) {
    const entity = byId.get(id);
    if (!entity) throw new Error(`missing canonical ${kind} ID`);
    if (entity.projectId !== projectId) throw new Error(`${kind} belongs to a different project`);
    assertUniqueOrigin(entity.originRefs, sourceRef, kind);
  }
}

function assertUniqueOrigin(origins: string[], sourceRef: string, kind: string): void {
  if (!Array.isArray(origins) || origins.filter(origin => origin === sourceRef).length !== 1) {
    throw new Error(`${kind} source origin is missing or ambiguous`);
  }
}

function sameCatalogTaskLink(a: CatalogTaskLink, b: CatalogTaskLink): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
