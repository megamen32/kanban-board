'use client';

import { memo } from 'react';
import { getPreviewFontSize } from './card-preview-utils';
import { MarkdownText } from './markdown-text';

interface Props {
  title: string;
  description: string;
}

/**
 * Board card preview that shows the stored Markdown as readable text.
 *
 * The description is rendered in full inside the scrollable box, so no Markdown
 * structure is cut in the middle and no raw syntax reaches the reader.
 */
export const MarkdownCardPreview = memo(function MarkdownCardPreview({ title, description }: Props) {
  if (!description) return null;

  const fontSize = getPreviewFontSize(description.length);

  return (
    <>
      <div
        className="max-h-44 overflow-y-auto break-words text-muted-foreground leading-snug mb-2"
        style={{ fontSize: `${fontSize}px` }}
      >
        <MarkdownText text={description} />
      </div>
      <div className="pointer-events-none absolute left-2 right-2 top-full z-40 hidden pt-2 md:group-hover:block md:group-focus-within:block">
        <div className="max-h-[min(28rem,70vh)] overflow-y-auto rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-xl">
          <div className="mb-1 font-semibold text-sm">{title}</div>
          <MarkdownText text={description} />
        </div>
      </div>
    </>
  );
});
