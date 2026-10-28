'use client';

import { memo } from 'react';
import { CardBriefPanel } from './card-brief-panel';
import type { CardBriefSource } from './card-brief';

interface Props {
  card: CardBriefSource;
}

/**
 * Board card preview with current structured facts. Full Markdown stays in the
 * card dialog, where it can be opened separately from this concise view.
 */
export const MarkdownCardPreview = memo(function MarkdownCardPreview({ card }: Props) {
  return <CardBriefPanel card={card} compact />;
});
