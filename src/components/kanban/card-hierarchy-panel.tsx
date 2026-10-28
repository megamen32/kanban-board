'use client';

import { Button } from '../ui/button';
import type { KanbanCard } from '@/lib/kanban/types';
import { getCardAncestorChain, getVisibleCardChildren } from './card-hierarchy';

interface Props {
  card: KanbanCard;
  relatedCards: KanbanCard[];
  breadcrumbCards?: KanbanCard[];
  onSelectCard?: (card: KanbanCard) => void;
}

export function CardHierarchyPanel({ card, relatedCards, breadcrumbCards = relatedCards, onSelectCard }: Props) {
  const ancestors = getCardAncestorChain(card, breadcrumbCards);
  const children = getVisibleCardChildren(card, relatedCards);
  if (!ancestors.length && !children.length && !card.parent) return null;

  const visibleCard = (id: string) => relatedCards.find(item => item.id === id);
  return (
    <section aria-label="Иерархия задач" className="space-y-2 rounded-md border bg-muted/20 p-3">
      {ancestors.length > 0 && <nav aria-label="Путь к задаче" className="flex flex-wrap items-center gap-1 text-sm">
        <span className="text-muted-foreground">Родительский путь:</span>
        {ancestors.map((ancestor, index) => <span key={ancestor.id} className="inline-flex items-center gap-1">
          {index > 0 && <span aria-hidden className="text-muted-foreground">›</span>}
          {onSelectCard && visibleCard(ancestor.id)
            ? <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => onSelectCard(visibleCard(ancestor.id)!)}>{ancestor.title}</Button>
            : <span>{ancestor.title}</span>}
        </span>)}
        <span aria-hidden className="text-muted-foreground">›</span><span className="font-medium">{card.title}</span>
      </nav>}
      {card.parent && ancestors.length === 0 && <p className="text-sm text-muted-foreground">Родительская задача скрыта текущей выборкой.</p>}
      {children.length > 0 && <details>
        <summary className="cursor-pointer text-sm font-medium">Дочерние задачи · {children.length}</summary>
        <ul className="mt-2 space-y-1 pl-2">
          {children.map(child => <li key={child.id}>
            {onSelectCard && visibleCard(child.id)
              ? <Button type="button" variant="link" size="sm" className="h-auto justify-start p-0 text-left" onClick={() => onSelectCard(visibleCard(child.id)!)}>{child.title}</Button>
              : <span className="text-sm">{child.title}</span>}
          </li>)}
        </ul>
      </details>}
    </section>
  );
}
