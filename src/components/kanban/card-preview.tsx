'use client';

import { getPreviewFontSize, getPreviewText } from './card-preview-utils';

interface Props {
  title: string;
  description: string;
}

export function CardPreview({ title, description }: Props) {
  if (!description) return null;

  const text = getPreviewText(description);
  const fontSize = getPreviewFontSize(text.length);

  return (
    <>
      <p
        className="max-h-44 overflow-y-auto whitespace-pre-wrap break-words text-muted-foreground leading-snug mb-2"
        style={{ fontSize: `${fontSize}px` }}
      >
        {text}
      </p>
      <div className="pointer-events-none absolute left-2 right-2 top-full z-40 hidden pt-2 md:group-hover:block md:group-focus-within:block">
        <div className="max-h-[min(28rem,70vh)] overflow-y-auto rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-xl">
          <div className="mb-1 font-semibold text-sm">{title}</div>
          <div className="whitespace-pre-wrap break-words leading-snug" style={{ fontSize: `${fontSize}px` }}>
            {text}
          </div>
        </div>
      </div>
    </>
  );
}
