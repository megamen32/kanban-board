import { MarkdownText } from './markdown-text';

export interface CardResultPreviewData {
  summary: string;
  submittedBy: string;
  submittedAt: string;
}

export function CardResultPreview({ result }: { result: CardResultPreviewData }) {
  return (
    <section className="space-y-1 rounded-md border bg-muted/20 p-3" aria-label="Результат для проверки">
      <h3 className="text-sm font-medium">Результат для проверки</h3>
      <MarkdownText
        text={result.summary}
        className="[&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:px-2 [&_td]:py-1"
      />
      <p className="text-xs text-muted-foreground">
        {result.submittedBy} · {new Date(result.submittedAt).toLocaleString()}
      </p>
    </section>
  );
}
