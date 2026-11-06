import { afterEach, describe, expect, test } from 'vitest';
import { keeperCalendarApiUrl, keeperCalendarPublicUrl, keeperCalendarEnabled } from './keeper-config';

describe('keeper calendar configuration (no secrets in config)', () => {
  const ORIGINAL = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL };
    delete process.env.KEEPER_API_URL;
    delete process.env.KEEPER_PUBLIC_URL;
  });

  test('feature is disabled until the private LAN upstream is configured', () => {
    delete process.env.KEEPER_API_URL;
    expect(keeperCalendarApiUrl()).toBeNull();
    expect(keeperCalendarEnabled()).toBe(false);
  });

  test('reads the upstream URL and trims trailing slashes', () => {
    process.env.KEEPER_API_URL = 'http://192.168.2.100:43349/';
    expect(keeperCalendarApiUrl()).toBe('http://192.168.2.100:43349');
    expect(keeperCalendarEnabled()).toBe(true);
  });

  test('ignores whitespace-only and non-http upstream values', () => {
    process.env.KEEPER_API_URL = '   ';
    expect(keeperCalendarApiUrl()).toBeNull();
    process.env.KEEPER_API_URL = 'ftp://192.168.2.100:43349';
    expect(keeperCalendarApiUrl()).toBeNull();
  });

  test('public URL is optional and used only for event links', () => {
    expect(keeperCalendarPublicUrl()).toBeNull();
    process.env.KEEPER_PUBLIC_URL = 'https://keeper-calendar.airlock.bezrabotnyi.com';
    expect(keeperCalendarPublicUrl()).toBe('https://keeper-calendar.airlock.bezrabotnyi.com');
  });
});
