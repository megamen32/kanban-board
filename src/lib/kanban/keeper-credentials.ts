import fs from 'node:fs';
import path from 'node:path';
import type { KeeperCredential } from './keeper-calendar';

/**
 * Server-only per-user Keeper credential lookup from the protected auth root
 * (KANBAN_AUTH_DIR — the same protected mount as the AuthStore; never the
 * shared card storage, never the browser, never Markdown).
 *
 * Operator-managed file (there is deliberately no web UI for tokens): after
 * the owner creates a personal API token in Keeper (Settings → API Tokens)
 * the operator adds one entry per user:
 *
 *   { "version": 1, "credentials": { "<username>": { "bearer": "kpr_…", "calendarId": "…" } } }
 *
 * The file must have mode 0600; a group/other-readable file fails closed.
 * Missing file or unknown user → null (the bridge answers
 * keeper_not_connected). A corrupt or malformed file fails closed. Bearer
 * values are resolved per request, used only inside the outgoing upstream
 * request, and never logged, cached into cards, or returned by any API.
 */

export class KeeperCredentialStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeeperCredentialStoreError';
  }
}

interface CredentialsFile {
  version: 1;
  credentials: Record<string, { bearer: string; calendarId: string }>;
}

function validSecret(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength && !/[\u0000-\u001f\u007f]/.test(value);
}

export function authRootDir(): string {
  return process.env.KANBAN_AUTH_DIR ?? path.join(process.cwd(), 'data', 'auth');
}

function credentialsPath(): string {
  return path.join(authRootDir(), 'keeper-credentials.json');
}

function loadCredentialsFile(): CredentialsFile | null {
  const filePath = credentialsPath();
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (error) {
    // Absent file simply means nobody connected a calendar yet.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new KeeperCredentialStoreError('keeper credentials file is unreadable');
  }
  // Fail closed on an insecure file instead of serving secrets from it.
  const mode = fs.statSync(filePath).mode & 0o777;
  if (mode & 0o077) throw new KeeperCredentialStoreError('keeper credentials file must be mode 0600');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new KeeperCredentialStoreError('keeper credentials file is corrupt');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new KeeperCredentialStoreError('keeper credentials file is corrupt');
  const file = parsed as { version?: unknown; credentials?: unknown };
  if (file.version !== 1 || !file.credentials || typeof file.credentials !== 'object' || Array.isArray(file.credentials)) {
    throw new KeeperCredentialStoreError('keeper credentials file is corrupt');
  }
  const credentials: Record<string, { bearer: string; calendarId: string }> = {};
  for (const [user, entry] of Object.entries(file.credentials)) {
    if (!validSecret(user, 64) || !entry || typeof entry !== 'object'
      || !validSecret((entry as { bearer?: unknown }).bearer, 512)
      || !validSecret((entry as { calendarId?: unknown }).calendarId, 256)) {
      throw new KeeperCredentialStoreError('keeper credentials file has an invalid entry');
    }
    credentials[user] = { bearer: (entry as { bearer: string }).bearer, calendarId: (entry as { calendarId: string }).calendarId };
  }
  return { version: 1, credentials };
}

/**
 * Resolve the per-user credential for one request. Null = not connected.
 * Throws KeeperCredentialStoreError when the protected store itself is
 * unusable — callers must fail closed instead of proceeding without a
 * credential.
 */
export async function keeperCredentialForUser(username: string): Promise<KeeperCredential | null> {
  const file = loadCredentialsFile();
  if (!file) return null;
  const entry = file.credentials[username];
  return entry ? { ...entry } : null;
}
