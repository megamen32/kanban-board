export const MAX_CARD_PREVIEW_CHARS = 500;
export const MIN_CARD_FONT_SIZE = 10;
export const MAX_CARD_FONT_SIZE = 14;

export function getPreviewText(text: string, maxChars = MAX_CARD_PREVIEW_CHARS): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= 1) return '…'.slice(0, maxChars);
  return `${text.slice(0, maxChars - 1)}…`;
}

export function getPreviewFontSize(characterCount: number): number {
  const shrink = Math.max(0, characterCount - 80) / 80;
  return Math.max(MIN_CARD_FONT_SIZE, Math.min(MAX_CARD_FONT_SIZE, MAX_CARD_FONT_SIZE - shrink));
}
