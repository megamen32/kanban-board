import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

/**
 * Per-user calendar sync records, stored ONLY in the protected auth root
 * (KANBAN_AUTH_DIR, the same directory as the Kanban AuthStore). They never
 * enter the shared card Markdown: user B can never see or act on user A's
 * event id, and one shared card may carry one event per connected user
 * without leaking cross-account identity.
 *
 * Storage layout: ONE FILE PER (username, cardId) — the sha256 of the JSON
 * key — so concurrent syncs of different users/cards never read-modify-write
 * a shared document and cannot lose each other's records. Every write is a
 * temp-file + rename + fsync atomic replacement.
 *
 * Cross-process safety: record files alone still allow two processes to run
 * the create flow for the SAME key concurrently. acquireCalendarSyncLock
 * closes that with an atomic mkdir lock that refuses (fail closed) while the
 * holder is provably alive and takes over only a provably dead one; the
 * pending marker inside the record store survives any crash until explicit
 * recovery.
 */

export interface CalendarEventBinding {
  /** Opaque Keeper event id from POST /api/v1/events. */
  eventId: string;
  startTime: string;
  endTime: string;
  /** sha256 of the synced card title; a changed title re-patches the event. */
  titleHash?: string;
  /** Board project at sync time; a changed project needs manual rebind. */
  project?: string;
  /** The calendar the event actually lives in (this user's own). */
  calendarId?: string;
  syncedAt: string;
}

export interface PendingCalendarSync {
  state: 'pending';
  /** Which upstream call was in flight when the outcome became unknown. */
  phase: 'create' | 'patch';
  /** Event id a pending patch would have touched (recovery deletes it). */
  eventId?: string;
  startedAt: string;
}

export type CalendarSyncRecord =
  | ({ state: 'bound' } & CalendarEventBinding)
  | PendingCalendarSync;

export function calendarSyncKey(username: string, cardId: string): string {
  // JSON encoding cannot collide: usernames and card ids never contain it.
  return JSON.stringify([username, cardId]);
}

function keyHash(username: string, cardId: string): string {
  return createHash('sha256').update(calendarSyncKey(username, cardId)).digest('hex');
}

function validIso(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64 && Number.isFinite(new Date(value).getTime());
}

function validSecretText(value: string, maxLength: number): boolean {
  return value.trim().length > 0 && value.length <= maxLength && !/[\u0000-\u001f\u007f]/.test(value);
}

function validRecord(value: unknown): CalendarSyncRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.state === 'pending') {
    if ((record.phase !== 'create' && record.phase !== 'patch')
      || (record.eventId !== undefined && (typeof record.eventId !== 'string' || !record.eventId.trim() || record.eventId.length > 512))
      || !validIso(record.startedAt)) return null;
    return {
      state: 'pending',
      phase: record.phase,
      ...(typeof record.eventId === 'string' ? { eventId: record.eventId } : {}),
      startedAt: new Date(record.startedAt).toISOString(),
    };
  }
  if (record.state !== 'bound') return null;
  if (typeof record.eventId !== 'string' || !record.eventId.trim() || record.eventId.length > 512
    || !validIso(record.startTime) || !validIso(record.endTime) || !validIso(record.syncedAt)
    || record.titleHash !== undefined && (typeof record.titleHash !== 'string' || !/^[a-f0-9]{64}$/.test(record.titleHash))
    || record.project !== undefined && (typeof record.project !== 'string' || !validSecretText(record.project, 200))
    || record.calendarId !== undefined && (typeof record.calendarId !== 'string' || !validSecretText(record.calendarId, 256))) {
    return null;
  }
  return {
    state: 'bound',
    eventId: record.eventId,
    startTime: new Date(record.startTime).toISOString(),
    endTime: new Date(record.endTime).toISOString(),
    ...(typeof record.titleHash === 'string' && /^[a-f0-9]{64}$/.test(record.titleHash) ? { titleHash: record.titleHash } : {}),
    ...(typeof record.project === 'string' && validSecretText(record.project, 200) ? { project: record.project } : {}),
    ...(typeof record.calendarId === 'string' && validSecretText(record.calendarId, 256) ? { calendarId: record.calendarId } : {}),
    syncedAt: new Date(record.syncedAt).toISOString(),
  };
}

function fsyncDirectory(dir: string): void {
  const fd = fs.openSync(dir, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

export class KeeperBindingStore {
  /** Resolved per call so tests can point KANBAN_AUTH_DIR at a temp dir. */
  private authRoot(): string {
    return process.env.KANBAN_AUTH_DIR ?? path.join(process.cwd(), 'data', 'auth');
  }

  private recordsDir(): string {
    return path.join(this.authRoot(), 'calendar-bindings');
  }

  private recordPath(username: string, cardId: string): string {
    return path.join(this.recordsDir(), `${keyHash(username, cardId)}.json`);
  }

  get(username: string, cardId: string): CalendarSyncRecord | null {
    let raw: string;
    try {
      raw = fs.readFileSync(this.recordPath(username, cardId), 'utf-8');
    } catch (error) {
      // Only a missing file means "no record"; anything else fails closed so a
      // receipt can never be silently lost.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('calendar binding record is corrupt');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('calendar binding record is corrupt');
    const source = parsed as { version?: unknown; record?: unknown };
    if (source.version !== 1) throw new Error('calendar binding record is corrupt');
    const record = validRecord(source.record);
    if (!record) throw new Error('calendar binding record is corrupt');
    return record;
  }

  set(username: string, cardId: string, record: CalendarSyncRecord): void {
    const dir = this.recordsDir();
    fs.mkdirSync(dir, { recursive: true });
    const filePath = this.recordPath(username, cardId);
    const payload = JSON.stringify({ version: 1, record }, null, 2);
    const tmp = path.join(dir, `.keeper-binding-${randomUUID()}.tmp`);
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try {
      try {
        fs.writeFileSync(fd, payload);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(tmp, filePath);
    } finally {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
    fsyncDirectory(dir);
  }

  clear(username: string, cardId: string): boolean {
    try {
      fs.unlinkSync(this.recordPath(username, cardId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
    fsyncDirectory(this.recordsDir());
    return true;
  }
}

export const keeperBindingStore = new KeeperBindingStore();

const syncLocks = new Map<string, Promise<unknown>>();

/** Test/debug helper: the on-disk lock directory for one sync key. */
export function calendarSyncLockPath(username: string, cardId: string): string {
  const root = process.env.KANBAN_AUTH_DIR ?? path.join(process.cwd(), 'data', 'auth');
  return path.join(root, 'calendar-sync-locks', `${keyHash(username, cardId)}.lock`);
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export type CalendarSyncProcessLock =
  | { acquired: true; release: () => void }
  | { acquired: false; reason: 'held' };

/**
 * Inter-process lock for one (username, cardId) sync: mkdir is atomic across
 * processes (and across PID namespaces — no pid heuristics). A busy lock
 * REFUSES the operation fail-closed: the caller answers 423 and the user or
 * an operator resolves the holder after verifying no sync is truly running.
 * No auto-takeover and no blind cleanup: heuristic lock stealing could let
 * two creates run concurrently, which is exactly what this lock prevents.
 * Records and pending markers are never touched here.
 */
export function acquireCalendarSyncLock(username: string, cardId: string): CalendarSyncProcessLock {
  const root = process.env.KANBAN_AUTH_DIR ?? path.join(process.cwd(), 'data', 'auth');
  const dir = path.join(root, 'calendar-sync-locks');
  fs.mkdirSync(dir, { recursive: true });
  const lockPath = calendarSyncLockPath(username, cardId);
  let fd: number;
  try {
    fs.mkdirSync(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    return { acquired: false, reason: 'held' };
  }
  try {
    fd = fs.openSync(path.join(lockPath, 'lock.json'), 'wx', 0o600);
  } catch (error) {
    // Lock dir exists without usable metadata (crash between mkdir and meta
    // write): still fail closed — only the operator clears it.
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    return { acquired: false, reason: 'held' };
  }
  try {
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, username, cardId, startedAt: new Date().toISOString() }));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return {
    acquired: true,
    release: () => {
      try {
        fs.rmSync(lockPath, { recursive: true, force: true });
      } catch {
        // An unlink race leaves a lock dir the operator can inspect; every
        // later acquirer still fails closed instead of stealing it.
      }
    },
  };
}

/**
 * Serialize calendar sync per user+card inside this process (cheap, ordered),
 * so two concurrent POSTs for the same card cannot even race for the
 * inter-process lock.
 */
export async function withCalendarSyncLock<T>(username: string, cardId: string, operation: () => Promise<T>): Promise<T> {
  const key = calendarSyncKey(username, cardId);
  const previous = syncLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const chained = previous.then(() => gate);
  syncLocks.set(key, chained);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (syncLocks.get(key) === chained) syncLocks.delete(key);
  }
}
