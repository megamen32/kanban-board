import {
  AIRLOCK_TODO_NATIVE_IDENTITY_HEADER,
  isSupportedNativeProjectRoute,
  nativeProjectHintFromRequest,
  verifyAirlockTodoNativeIdentity,
} from '../auth/airlock-native-identity';
import type { KeyObject } from 'node:crypto';

export interface NativeProjectAccess {
  project: string;
  team: string;
  readAllowed: true;
  writeAllowed: boolean;
}

export interface NativeProjectAccessOptions {
  /** Fixed server configuration; never derive this URL from request fields. */
  endpoint: string;
  publicKey: string | KeyObject;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

export interface NativeProjectAccessContext {
  userId: string;
  forProject(project: string): Promise<NativeProjectAccess>;
}

/**
 * Creates one request-scoped resolver. Absent identity returns null for legacy
 * callers; a present invalid assertion throws and cannot use that fallback.
 */
export async function nativeProjectAccessForRequest(
  request: Request,
  options: NativeProjectAccessOptions,
): Promise<NativeProjectAccessContext | null> {
  const identity = await verifyAirlockTodoNativeIdentity(request, options.publicKey);
  if (!identity) return null;
  const hint = await nativeProjectHintFromRequest(request);
  if (identity.project !== hint) throw new Error('native_project_hint_invalid');
  const endpoint = validateEndpoint(options.endpoint);
  const timeoutMs = options.timeoutMs ?? 3_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5_000) throw new Error('native_project_access_unconfigured');
  const fetcher = options.fetcher ?? fetch;
  const cache = new Map<string, Promise<NativeProjectAccess>>();

  return {
    userId: identity.userId,
    forProject(project: string): Promise<NativeProjectAccess> {
      const canonicalProject = project.trim();
      if (!canonicalProject || canonicalProject !== project || canonicalProject.length > 512
        || (hint && hint !== canonicalProject) || (identity.project && identity.project !== canonicalProject)
        || (!identity.project && !isSupportedNativeProjectRoute(identity.method, new URL(request.url).pathname))) {
        return Promise.reject(new Error('native_project_access_denied'));
      }
      const existing = cache.get(canonicalProject);
      if (existing) return existing;
      const pending = loadProjectAccess({ assertion: request.headers.get(AIRLOCK_TODO_NATIVE_IDENTITY_HEADER)!, project: canonicalProject,
        endpoint, fetcher, timeoutMs });
      cache.set(canonicalProject, pending);
      return pending;
    },
  };
}

async function loadProjectAccess(input: {
  assertion: string;
  project: string;
  endpoint: URL;
  fetcher: typeof fetch;
  timeoutMs: number;
}): Promise<NativeProjectAccess> {
  const body = JSON.stringify({ project: input.project });
  let response: Response;
  try {
    response = await input.fetcher(input.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [AIRLOCK_TODO_NATIVE_IDENTITY_HEADER]: input.assertion },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(input.timeoutMs),
    });
  } catch {
    throw new Error('native_project_access_unavailable');
  }
  if (response.status === 403) throw new Error('native_project_access_denied');
  if (!response.ok) throw new Error('native_project_access_unavailable');
  const bytes = await readBoundedResponse(response, 8 * 1024);
  let decoded: unknown;
  try { decoded = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('native_project_access_invalid'); }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error('native_project_access_invalid');
  const value = decoded as Record<string, unknown>;
  if (Object.keys(value).sort().join(',') !== ['project', 'team', 'readAllowed', 'writeAllowed'].sort().join(',')
    || value.project !== input.project || typeof value.team !== 'string' || !value.team.trim()
    || value.readAllowed !== true || typeof value.writeAllowed !== 'boolean') {
    throw new Error('native_project_access_invalid');
  }
  return { project: input.project, team: value.team, readAllowed: true, writeAllowed: value.writeAllowed };
}

function validateEndpoint(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('native_project_access_unconfigured'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || url.pathname !== '/internal/todo/project-scope') throw new Error('native_project_access_unconfigured');
  return url;
}

async function readBoundedResponse(response: Response, maxBytes: number): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) throw new Error('native_project_access_response_limit');
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, length);
}
