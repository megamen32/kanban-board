import { describe, expect, test, vi } from 'vitest';

const { startDueReminderScheduler } = vi.hoisted(() => ({
  startDueReminderScheduler: vi.fn(),
}));

vi.mock('./lib/notifications/scheduler', () => ({ startDueReminderScheduler }));

import { register } from './instrumentation';

describe('Node runtime instrumentation', () => {
  test('starts the due reminder scheduler once during Node registration', async () => {
    const runtime = process.env.NEXT_RUNTIME;
    process.env.NEXT_RUNTIME = 'nodejs';

    await register();

    expect(startDueReminderScheduler).toHaveBeenCalledTimes(1);
    process.env.NEXT_RUNTIME = runtime;
  });
});
