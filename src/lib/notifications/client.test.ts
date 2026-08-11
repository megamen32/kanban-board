import { describe, expect, test, vi } from 'vitest';
import { unsubscribeAfterServerDeletion } from './client';

describe('unsubscribeAfterServerDeletion', () => {
  test('rejects a failed deletion before browser unsubscribe', async () => {
    const unsubscribe = vi.fn(async () => true);

    await expect(unsubscribeAfterServerDeletion(
      { endpoint: 'https://fcm.googleapis.com/fcm/send/subscription', unsubscribe },
      async () => new Response(null, { status: 500 }),
    )).rejects.toThrow(/unable to disable/i);

    expect(unsubscribe).not.toHaveBeenCalled();
  });

  test('unsubscribes once after successful deletion', async () => {
    const unsubscribe = vi.fn(async () => true);

    await unsubscribeAfterServerDeletion(
      { endpoint: 'https://fcm.googleapis.com/fcm/send/subscription', unsubscribe },
      async () => new Response(null, { status: 204 }),
    );

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
