import { getAllCards } from '../kanban/file-store';
import { tasksDirForScope } from '../auth/data-scope';
import type { BoardScope } from '@/lib/auth/scopes';
import { reminderIntervalMs, reminderLookbackHours, subscriptionsFilePath } from './config';
import { dispatchDueReminder } from './push';
import { consumeSourceIntentLaunchOnce } from '../kanban/source-launch';
import { reconcileQuestionDelivery, sweepQuestionTimeout } from '../kanban/board-questions';

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
      if (scope === 'work' && card.pendingQuestion && !card.pendingQuestion.answer) {
        try {
          await sweepQuestionTimeout(card, tasksDir);
        } catch (error) {
          console.error('board question timeout failed', error);
        }
      }
      if (scope === 'work' && card.pendingQuestion?.answer && !card.pendingQuestion.deliveredAt) {
        await reconcileQuestionDelivery(card, tasksDir);
      }
      if (!card.dueAt) continue;
      const dueAt = new Date(card.dueAt).getTime();
      if (!Number.isFinite(dueAt) || dueAt > now.getTime() || dueAt < earliest) continue;
      const result = await dispatchDueReminder(scope, card, options.storePath || subscriptionsFilePath());
      dispatched += result.sent;
    }
    // B04b: one pending source intent of this scope, launched from the existing
    // tick. No new timer, schedule or process is introduced for it.
    try {
      await consumeSourceIntentLaunchOnce(scope, { tasksDir });
    } catch (error) {
      // A failed launch must never stop the reminder cycle of the next scope.
      console.error('source intent launch failed', error);
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
