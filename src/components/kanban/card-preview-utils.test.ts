import { describe, expect, test } from 'vitest';
import { getPreviewFontSize, getPreviewText } from './card-preview-utils';

describe('card preview', () => {
  test('keeps the preview bounded to 500 characters', () => {
    const text = 'x'.repeat(620);
    expect(getPreviewText(text)).toHaveLength(500);
    expect(getPreviewText(text).endsWith('…')).toBe(true);
  });

  test('shrinks long previews without going below the readable minimum', () => {
    expect(getPreviewFontSize(20)).toBeGreaterThan(getPreviewFontSize(500));
    expect(getPreviewFontSize(500)).toBeGreaterThanOrEqual(10);
    expect(getPreviewFontSize(500)).toBeLessThanOrEqual(14);
  });
});
