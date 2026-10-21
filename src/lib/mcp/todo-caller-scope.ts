import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';

export interface SignedTodoMcpReadScope {
  payload: string;
  signature: string;
}

export interface TodoMcpReadScopeClaims {
  v: 1;
  purpose: 'todo-board-mcp-read';
  userId: string;
  tool: 'kanban.list' | 'kanban.read';
  argsSha256: string;
  projects: string[];
  owner: boolean;
  issuedAtMs: number;
  expiresAtMs: number;
}

export interface TodoMcpWriteScopeClaims extends Omit<TodoMcpReadScopeClaims, 'purpose' | 'tool'> {
  purpose: 'todo-board-mcp-write';
  tool: 'kanban.change';
}

export interface TodoMcpProjectEnsureClaims {
  v: 1;
  purpose: 'todo-board-mcp-project-ensure';
  userId: string;
  tool: 'kanban.project.ensure';
  argsSha256: string;
  issuedAtMs: number;
  expiresAtMs: number;
}

const DOMAIN = Buffer.from('exmanager-todo-board-mcp-read-v1\n', 'utf8');
const MAX_TTL_MS = 120_000;
const FUTURE_SKEW_MS = 30_000;
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const CLAIM_KEYS = ['argsSha256', 'expiresAtMs', 'issuedAtMs', 'owner', 'projects', 'purpose', 'tool', 'userId', 'v'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function decodeBase64Url(value: unknown, maxBytes: number): Buffer {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid Todo MCP scope');
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length === 0 || decoded.length > maxBytes || decoded.toString('base64url') !== value) {
    throw new Error('invalid Todo MCP scope');
  }
  return decoded;
}

function parsePublicKey(value: string | undefined): KeyObject | undefined {
  if (!value?.trim()) return undefined;
  try {
    const raw = decodeBase64Url(value.trim(), 32);
    if (raw.length !== 32) return undefined;
    return createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
  } catch {
    return undefined;
  }
}

function canonical(value: unknown): string {
  if (typeof value === 'string') {
    return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, character => ({
      '<': '\\u003c', '>': '\\u003e', '&': '\\u0026', '\u2028': '\\u2028', '\u2029': '\\u2029',
    })[character]!);
  }
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map(key => `${canonical(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  throw new Error('invalid Todo MCP arguments');
}

function parseClaims(payload: Buffer): TodoMcpReadScopeClaims {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(payload);
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('invalid Todo MCP scope'); }
  const projects = isRecord(value) ? value.projects : undefined;
  if (!isRecord(value) || Object.keys(value).sort().join(',') !== CLAIM_KEYS.join(',')
      || value.v !== 1 || value.purpose !== 'todo-board-mcp-read'
      || (value.tool !== 'kanban.list' && value.tool !== 'kanban.read')
      || typeof value.userId !== 'string' || !value.userId.trim() || value.userId.length > 256
      || typeof value.argsSha256 !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.argsSha256)
      || !Array.isArray(projects) || projects.some(project => typeof project !== 'string' || !project.trim())
      || new Set(projects).size !== projects.length
      || projects.some((project, index) => index > 0 && projects[index - 1] >= project)
      || typeof value.owner !== 'boolean'
      || !Number.isSafeInteger(value.issuedAtMs) || !Number.isSafeInteger(value.expiresAtMs)) {
    throw new Error('invalid Todo MCP scope');
  }
  const claims: TodoMcpReadScopeClaims = {
    v: 1,
    purpose: 'todo-board-mcp-read',
    userId: value.userId,
    tool: value.tool,
    argsSha256: value.argsSha256,
    projects: projects as string[],
    owner: value.owner,
    issuedAtMs: value.issuedAtMs as number,
    expiresAtMs: value.expiresAtMs as number,
  };
  const canonicalPayload = JSON.stringify(claims);
  if (canonicalPayload !== text) throw new Error('noncanonical Todo MCP scope');
  return claims;
}

export function createTodoMcpReadScopeVerifier(
  publicKey: string | undefined,
  options: { now?: () => number } = {},
) {
  const key = parsePublicKey(publicKey);
  if (!key) return undefined;

  return (envelope: SignedTodoMcpReadScope, tool: TodoMcpReadScopeClaims['tool'], args: Record<string, unknown>) => {
    if (!isRecord(envelope) || Object.keys(envelope).sort().join(',') !== 'payload,signature') {
      throw new Error('Todo MCP caller scope required');
    }
    const payload = decodeBase64Url(envelope.payload, 16 * 1024);
    const signature = decodeBase64Url(envelope.signature, 64);
    if (signature.length !== 64 || !verify(null, Buffer.concat([DOMAIN, payload]), key, signature)) {
      throw new Error('invalid Todo MCP caller scope');
    }
    const claims = parseClaims(payload);
    const now = (options.now ?? Date.now)();
    if (claims.issuedAtMs > now + FUTURE_SKEW_MS || claims.expiresAtMs <= now
        || claims.expiresAtMs <= claims.issuedAtMs || claims.expiresAtMs - claims.issuedAtMs > MAX_TTL_MS) {
      throw new Error('Todo MCP caller scope expired');
    }
    if (claims.tool !== tool) throw new Error('Todo MCP caller scope is for another tool');
    const argsHash = createHash('sha256').update(canonical(args)).digest('base64url');
    if (claims.argsSha256 !== argsHash) throw new Error('Todo MCP caller scope is for different arguments');
    return claims;
  };
}

export function configuredTodoMcpReadScopeVerifier(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  return createTodoMcpReadScopeVerifier(env.EXMANAGER_SOURCE_ADMISSION_PUBLIC_KEY);
}

function parseWriteClaims(payload: Buffer): TodoMcpWriteScopeClaims {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(payload);
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('invalid Todo MCP write scope'); }
  const projects = isRecord(value) ? value.projects : undefined;
  if (!isRecord(value) || Object.keys(value).sort().join(',') !== CLAIM_KEYS.join(',')
      || value.v !== 1 || value.purpose !== 'todo-board-mcp-write' || value.tool !== 'kanban.change'
      || typeof value.userId !== 'string' || !value.userId.trim() || value.userId.length > 256
      || typeof value.argsSha256 !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.argsSha256)
      || !Array.isArray(projects) || projects.some(project => typeof project !== 'string' || !project.trim())
      || new Set(projects).size !== projects.length
      || projects.some((project, index) => index > 0 && projects[index - 1] >= project)
      || typeof value.owner !== 'boolean'
      || !Number.isSafeInteger(value.issuedAtMs) || !Number.isSafeInteger(value.expiresAtMs)) {
    throw new Error('invalid Todo MCP write scope');
  }
  const claims: TodoMcpWriteScopeClaims = {
    v: 1, purpose: 'todo-board-mcp-write', userId: value.userId, tool: 'kanban.change',
    argsSha256: value.argsSha256, projects: projects as string[], owner: value.owner,
    issuedAtMs: value.issuedAtMs as number, expiresAtMs: value.expiresAtMs as number,
  };
  if (JSON.stringify(claims) !== text) throw new Error('noncanonical Todo MCP write scope');
  return claims;
}

export function createTodoMcpWriteScopeVerifier(
  publicKey: string | undefined,
  options: { now?: () => number } = {},
) {
  const key = parsePublicKey(publicKey);
  if (!key) return undefined;
  const domain = Buffer.from('exmanager-todo-board-mcp-write-v1\n', 'utf8');
  return (envelope: SignedTodoMcpReadScope, args: Record<string, unknown>) => {
    if (!isRecord(envelope) || Object.keys(envelope).sort().join(',') !== 'payload,signature') {
      throw new Error('Todo MCP writer scope required');
    }
    const payload = decodeBase64Url(envelope.payload, 16 * 1024);
    const signature = decodeBase64Url(envelope.signature, 64);
    if (signature.length !== 64 || !verify(null, Buffer.concat([domain, payload]), key, signature)) {
      throw new Error('invalid Todo MCP writer scope');
    }
    const claims = parseWriteClaims(payload);
    const now = (options.now ?? Date.now)();
    if (claims.issuedAtMs > now + FUTURE_SKEW_MS || claims.expiresAtMs <= now
        || claims.expiresAtMs <= claims.issuedAtMs || claims.expiresAtMs - claims.issuedAtMs > MAX_TTL_MS) {
      throw new Error('Todo MCP writer scope expired');
    }
    const argsHash = createHash('sha256').update(canonical(args)).digest('base64url');
    if (claims.argsSha256 !== argsHash) throw new Error('Todo MCP writer scope is for different arguments');
    return claims;
  };
}

export function configuredTodoMcpWriteScopeVerifier(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  return createTodoMcpWriteScopeVerifier(env.EXMANAGER_SOURCE_ADMISSION_PUBLIC_KEY);
}

export function createTodoMcpProjectEnsureVerifier(
  publicKey: string | undefined,
  options: { now?: () => number } = {},
) {
  const key = parsePublicKey(publicKey);
  if (!key) return undefined;
  const domain = Buffer.from('exmanager-todo-board-mcp-project-ensure-v1\n', 'utf8');
  const expectedKeys = ['argsSha256', 'expiresAtMs', 'issuedAtMs', 'purpose', 'tool', 'userId', 'v'];
  return (envelope: SignedTodoMcpReadScope, args: Record<string, unknown>) => {
    if (!isRecord(envelope) || Object.keys(envelope).sort().join(',') !== 'payload,signature') {
      throw new Error('Todo project ensure scope required');
    }
    const payload = decodeBase64Url(envelope.payload, 16 * 1024);
    const signature = decodeBase64Url(envelope.signature, 64);
    if (signature.length !== 64 || !verify(null, Buffer.concat([domain, payload]), key, signature)) {
      throw new Error('invalid Todo project ensure scope');
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(payload);
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw new Error('invalid Todo project ensure scope'); }
    if (!isRecord(value) || Object.keys(value).sort().join(',') !== expectedKeys.join(',')
        || value.v !== 1 || value.purpose !== 'todo-board-mcp-project-ensure' || value.tool !== 'kanban.project.ensure'
        || typeof value.userId !== 'string' || !value.userId.trim() || value.userId.length > 256
        || typeof value.argsSha256 !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.argsSha256)
        || !Number.isSafeInteger(value.issuedAtMs) || !Number.isSafeInteger(value.expiresAtMs)) {
      throw new Error('invalid Todo project ensure scope');
    }
    const claims: TodoMcpProjectEnsureClaims = {
      v: 1, purpose: 'todo-board-mcp-project-ensure', userId: value.userId,
      tool: 'kanban.project.ensure', argsSha256: value.argsSha256,
      issuedAtMs: value.issuedAtMs as number, expiresAtMs: value.expiresAtMs as number,
    };
    if (JSON.stringify(claims) !== text) throw new Error('noncanonical Todo project ensure scope');
    const now = (options.now ?? Date.now)();
    if (claims.issuedAtMs > now + FUTURE_SKEW_MS || claims.expiresAtMs <= now
        || claims.expiresAtMs <= claims.issuedAtMs || claims.expiresAtMs - claims.issuedAtMs > MAX_TTL_MS) {
      throw new Error('Todo project ensure scope expired');
    }
    if (claims.argsSha256 !== createHash('sha256').update(canonical(args)).digest('base64url')) {
      throw new Error('Todo project ensure scope is for different arguments');
    }
    return claims;
  };
}

export function configuredTodoMcpProjectEnsureVerifier(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  return createTodoMcpProjectEnsureVerifier(env.EXMANAGER_SOURCE_ADMISSION_PUBLIC_KEY);
}
