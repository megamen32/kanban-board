'use client';

import { ArrowUpRight, Bot, MessageSquare } from 'lucide-react';
import type { KanbanCard } from '@/lib/kanban/types';
import { cardProvenanceLinks, UNKNOWN } from '@/components/kontur/kontur-model';
import { legacyCardReferences, legacyReferenceLabel } from '@/lib/kanban/legacy-card-references';

export function TaskReferenceLinks({ card, compact = false, legacyOnly = false }: { card: KanbanCard; compact?: boolean; legacyOnly?: boolean }) {
  const links = cardProvenanceLinks(card);
  const primaryItems = [
    { key: 'message', title: 'Исходное сообщение', href: links.sourceMessageUrl, Icon: MessageSquare },
    { key: 'session', title: 'Сессия агента', href: links.sessionUrl, Icon: Bot },
    ...(links.sourceSessionUrl && links.sourceSessionUrl !== links.sessionUrl
      ? [{ key: 'source-session', title: 'Исходная сессия', href: links.sourceSessionUrl, Icon: Bot }] : []),
  ];
  const items = legacyOnly ? [] : [...primaryItems];
  const seen = new Set(primaryItems.map(item => item.href));
  for (const [index, reference] of legacyCardReferences(card).entries()) {
    if (seen.has(reference.href)) continue;
    seen.add(reference.href);
    items.push({ key: `legacy-${index}`, title: legacyReferenceLabel(reference), href: reference.href,
      Icon: reference.service === 'userio' ? MessageSquare : Bot });
  }
  if (compact) {
    const known = items.filter(item => item.href);
    if (!known.length) return null;
    return <nav className="k-reference-links flex flex-wrap gap-2 text-xs" aria-label="Ссылки задачи">
      {known.map(({ key, title, href, Icon }) => <a key={key} href={href!} title={href!} aria-label={title}
        target="_blank" rel="noopener noreferrer" draggable={false}
        className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-primary hover:underline">
        <Icon size={12} />{title}<ArrowUpRight size={12} />
      </a>)}
    </nav>;
  }
  return <section className="rounded-md border border-border/70 bg-muted/30 p-3 text-xs" aria-label="Связи задачи">
    <dl className="grid gap-2">
      {items.map(({ key, title, href, Icon }) => <div key={key} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">{title}</dt>
        <dd className="min-w-0 max-w-full">
          {href ? <a href={href} title={href} aria-label={title} target="_blank" rel="noopener noreferrer"
            className="inline-flex max-w-full items-center gap-1 break-all text-primary hover:underline">
            <Icon size={12} className="shrink-0" />Открыть<ArrowUpRight size={12} className="shrink-0" />
          </a> : <span className="text-muted-foreground">{UNKNOWN}</span>}
        </dd>
      </div>)}
    </dl>
  </section>;
}
