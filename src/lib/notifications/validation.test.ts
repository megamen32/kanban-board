import { describe, expect, test } from 'vitest';
import { validatePushSubscription } from './validation';

const validSubscription = {
  endpoint: 'https://push.example.test/send/abc',
  keys: {
    p256dh: `BA${'A'.repeat(85)}`,
    auth: 'YWJjZGVmZ2hpamtsbW5vcA',
  },
};

describe('push subscription validation', () => {
  test('accepts a realistic public browser push endpoint', () => {
    const browserSubscription = {
      ...validSubscription,
      endpoint: 'https://fcm.googleapis.com/fcm/send/fake-browser-subscription-id',
    };

    expect(validatePushSubscription(browserSubscription)).toEqual(browserSubscription);
  });

  test('rejects malformed endpoints and missing encryption keys', () => {
    expect(() => validatePushSubscription({ ...validSubscription, endpoint: 'http://insecure.test' })).toThrow(/endpoint/i);
    expect(() => validatePushSubscription({ endpoint: validSubscription.endpoint, keys: {} })).toThrow(/keys/i);
  });

  test('rejects base64url keys with an impossible encoded length', () => {
    expect(() => validatePushSubscription({
      ...validSubscription,
      keys: { ...validSubscription.keys, p256dh: 'abcdefghijklmnopq' },
    })).toThrow(/p256dh/i);
    expect(() => validatePushSubscription({
      ...validSubscription,
      keys: { ...validSubscription.keys, auth: 'abcdefghijklmnopq' },
    })).toThrow(/auth/i);
  });

  test('rejects syntactically valid keys with non-canonical decoded lengths', () => {
    expect(() => validatePushSubscription({
      ...validSubscription,
      keys: { ...validSubscription.keys, p256dh: 'A'.repeat(86) },
    })).toThrow(/p256dh/i);
    expect(() => validatePushSubscription({
      ...validSubscription,
      keys: { ...validSubscription.keys, auth: 'A'.repeat(20) },
    })).toThrow(/auth/i);
  });

  test.each([
    'https://localhost/push',
    'https://127.0.0.1/push',
    'https://10.0.0.1/push',
    'https://172.16.0.1/push',
    'https://192.168.0.1/push',
    'https://[::1]/push',
    'https://[fc00::1]/push',
    'https://[::ffff:127.0.0.1]/push',
    'https://[::ffff:10.0.0.1]/push',
  ])('rejects local or private endpoint %s', endpoint => {
    expect(() => validatePushSubscription({ ...validSubscription, endpoint })).toThrow(/endpoint/i);
  });
});
