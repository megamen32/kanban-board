import { describe, expect, test } from 'vitest';
import { shouldOpenCardAfterPointer } from './card-interaction';

describe('card pointer interaction', () => {
  test('opens on a tap', () => {
    expect(shouldOpenCardAfterPointer({ startX: 10, startY: 10, endX: 13, endY: 12 })).toBe(true);
  });

  test('does not open after a drag', () => {
    expect(shouldOpenCardAfterPointer({ startX: 10, startY: 10, endX: 30, endY: 10 })).toBe(false);
  });
});
