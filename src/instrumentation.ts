export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startDueReminderScheduler } = await import('./lib/notifications/scheduler');
  startDueReminderScheduler();
}
