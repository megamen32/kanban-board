import { getAllCards } from '../kanban/file-store';
import { tasksDirForScope } from '../auth/data-scope';
import type { BoardScope } from '@/lib/auth/scopes';
import { reminderIntervalMs, reminderLookbackHours, subscriptionsFilePath } from './config';
import { dispatchDueReminder } from './push';

const SCHEDULER_KEY = '__excodeDueReminderScheduler';
type SchedulerGlobal = typeof globalThis & { [SCHEDULER_KEY]?: { timer: ReturnType<typeof setInterval> } };

export async function runDueReminderTick(
  now = new Date(),
  options: { scopes?: BoardScope[]; tasksDir?: (scope: BoardScope) => string; storePath?: string } = {},
): Promise<number> {
  const scopes = options.scopes || ['work', 'personal'];
  const resolveTasksDir = options.tasksDir || tasksDirForScope;
  const earliest = now.getTime() - reminderLookbackHours() * 60 * 60 * 1000;
  let dispatched = 0;
  for (const scope of scopes) {
    let tasksDir: string;
    try {
      tasksDir = resolveTasksDir(scope);
    } catch {
      continue;
    }
    const cards = getAllCards(tasksDir);
    for (const card of cards) {
      if (!card.dueAt) continue;
      const dueAt = new Date(card.dueAt).getTime();
      if (!Number.isFinite(dueAt) || dueAt > now.getTime() || dueAt < earliest) continue;
      const result = await dispatchDueReminder(scope, card, options.storePath || subscriptionsFilePath());
      dispatched += result.sent;
    }
  }
  return dispatched;
}

export function startDueReminderScheduler(): void {
  const globalState = globalThis as SchedulerGlobal;
  if (globalState[SCHEDULER_KEY]) return;
  const timer = setInterval(() => { void runDueReminderTick().catch(() => undefined); }, reminderIntervalMs());
  if (typeof timer === 'object' && 'unref' in timer && typeof timer.unref === 'function') timer.unref();
  globalState[SCHEDULER_KEY] = { timer };
  void runDueReminderTick().catch(() => undefined);
}
