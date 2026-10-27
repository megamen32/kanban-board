'use client';

import { memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { cn } from '../../lib/utils';

interface Props {
  text: string;
  className?: string;
}

/**
 * Read-only Markdown rendering for stored task text.
 *
 * The stored text stays verbatim; only the display is rendered. Raw HTML is not
 * enabled, so a description cannot inject markup into the board.
 */
export const MarkdownText = memo(function MarkdownText({ text, className }: Props) {
  if (!text.trim()) return null;

  return (
    <div className={cn('min-w-0 break-words leading-snug [&>*:first-child]:mt-0 [&>*:not(:first-child)]:mt-1.5', className)}>
      <ReactMarkdown
        components={{
          h1: ({ children }) => <h1 className="text-sm font-semibold leading-snug">{children}</h1>,
          h2: ({ children }) => <h2 className="text-sm font-semibold leading-snug">{children}</h2>,
          h3: ({ children }) => <h3 className="text-xs font-semibold leading-snug">{children}</h3>,
          h4: ({ children }) => <h4 className="text-xs font-medium leading-snug">{children}</h4>,
          h5: ({ children }) => <h5 className="text-xs font-medium leading-snug">{children}</h5>,
          h6: ({ children }) => <h6 className="text-xs font-medium leading-snug">{children}</h6>,
          p: ({ children }) => <p className="whitespace-pre-wrap">{children}</p>,
          ul: ({ children }) => <ul className="list-disc space-y-0.5 pl-4">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-0.5 pl-4">{children}</ol>,
          li: ({ children }) => <li className="pl-0.5">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          del: ({ children }) => <del>{children}</del>,
          blockquote: ({ children }) => <blockquote className="border-l-2 border-border pl-2 text-muted-foreground">{children}</blockquote>,
          hr: () => <hr className="border-border" />,
          a: ({ children, href }) => (
            <a href={href} className="underline underline-offset-2" target="_blank" rel="noreferrer">{children}</a>
          ),
          code: ({ children, className: codeClassName }) => (codeClassName
            ? <code className="block overflow-x-auto rounded bg-muted p-2 font-mono text-xs">{children}</code>
            : <code className="rounded bg-muted px-1 font-mono text-[0.9em]">{children}</code>),
          pre: ({ children }) => <pre className="overflow-x-auto text-xs">{children}</pre>,
          img: ({ alt }) => <span className="text-muted-foreground">[изображение{alt ? `: ${alt}` : ''}]</span>,
        } satisfies Components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
