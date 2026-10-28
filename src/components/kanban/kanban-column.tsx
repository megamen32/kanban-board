'use client';

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { KanbanCard } from './kanban-card';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ReactNode } from 'react';
import type { KanbanCard as KanbanCardType, KanbanColumn } from '@/lib/kanban/types';
import { groupVisibleCardHierarchy, type VisibleCardHierarchyGroup } from './card-hierarchy';

interface Props {
  id: KanbanColumn;
  title: string;
  color: string;
  cards: KanbanCardType[];
  onAddCard?: () => void;
}

export function KanbanColumnComponent(props: Props) {
  const { id, title, color, cards, onAddCard } = props;
  const { setNodeRef, isOver } = useDroppable({ id });
  const groups = groupVisibleCardHierarchy(cards);

  const renderGroup = (group: VisibleCardHierarchyGroup): ReactNode => (
    <div key={group.card.id}>
      <KanbanCard card={group.card} columnId={id} />
      {group.children.length > 0 && <details className="ml-3 mt-1 border-l pl-2">
        <summary className="cursor-pointer px-1 py-1 text-[11px] text-muted-foreground">Подзадачи · {group.children.length}</summary>
        <div className="space-y-2">{group.children.map(renderGroup)}</div>
      </details>}
    </div>
  );

  return (
    <div className="min-w-[min(300px,calc(100vw-1.5rem))] w-[min(300px,calc(100vw-1.5rem))] shrink-0 flex flex-col">
      <div className="flex items-center gap-2 mb-3 px-1">
        <div className={`w-3 h-3 rounded-full ${color}`} />
        <h3 className="font-semibold text-sm text-foreground">{title}</h3>
        <span className="text-xs text-muted-foreground ml-auto bg-muted px-2 py-0.5 rounded-full">{cards.length}</span>
      </div>

      <div
        ref={setNodeRef}
        className={`flex-1 rounded-lg border border-border/50 bg-muted/30 p-2 transition-colors min-h-[100px] ${isOver ? 'bg-primary/5 border-primary/30' : ''}`}
      >
        <SortableContext items={cards.map(c => c.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {groups.map(renderGroup)}
          </div>
        </SortableContext>

        {cards.length === 0 && (
          <div className="flex items-center justify-center h-[80px] text-xs text-muted-foreground border border-dashed border-border/50 rounded-md">
            Перетащите карточку
          </div>
        )}

        {onAddCard && <Button
          variant="ghost"
          size="sm"
          className="w-full mt-2 text-muted-foreground hover:text-foreground"
          onClick={onAddCard}
        >
          <Plus className="h-4 w-4 mr-1" /> Добавить
        </Button>}
      </div>
    </div>
  );
}
