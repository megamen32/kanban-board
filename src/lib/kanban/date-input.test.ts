import { describe, expect, test, vi, afterEach } from 'vitest';
import { fromDateTimeLocalValue, toDateTimeLocalValue } from './date-input';

afterEach(() => vi.unstubAllEnvs());

describe('deadline input precision', () => {
  test.each(['UTC', 'Europe/Moscow', 'America/Los_Angeles'])('keeps a date-only deadline through edit/save in %s', timezone => {
    vi.stubEnv('TZ', timezone);
    expect(toDateTimeLocalValue('2030-01-02')).toBe('2030-01-02');
    expect(fromDateTimeLocalValue(toDateTimeLocalValue('2030-01-02'))).toBe('2030-01-02');
  });

  test('keeps explicit local times and clearing behavior', () => {
    vi.stubEnv('TZ', 'Europe/Moscow');
    expect(toDateTimeLocalValue('2030-01-02T07:30:00.000Z')).toBe('2030-01-02T10:30');
    expect(fromDateTimeLocalValue('2030-01-02T10:30')).toBe('2030-01-02T07:30:00.000Z');
    expect(fromDateTimeLocalValue('')).toBeUndefined();
  });

  test('does not turn an impossible calendar date into another day', () => {
    expect(toDateTimeLocalValue('2030-02-30')).toBe('');
    expect(() => fromDateTimeLocalValue('2030-02-30')).toThrow();
  });
});
