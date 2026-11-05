'use client';

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { KanbanCard } from './kanban-card';
import type { ReactNode } from 'react';
import type { KanbanCard as KanbanCardType, KanbanColumn } from '@/lib/kanban/types';
import { groupVisibleCardHierarchy, type VisibleCardHierarchyGroup } from './card-hierarchy';

interface Props {
  id: KanbanColumn;
  title: string;
  color: string;
  cards: KanbanCardType[];
}

export function KanbanColumnComponent(props: Props) {
  const { id, title, color, cards } = props;
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
    <div className="min-w-[min(320px,calc(100vw-1.5rem))] w-[min(320px,calc(100vw-1.5rem))] shrink-0 flex flex-col">
      <div className={`mb-2 flex items-center gap-2 rounded-t-xl border border-b-0 border-border/60 border-t-4 ${color} bg-card px-3 py-3`}>
        <div className={`h-3 w-3 rounded-full ${color} ring-4 ring-background`} />
        <h3 className="font-semibold text-sm text-foreground">{title}</h3>
        <span aria-label={`${cards.length} ${cards.length === 1 ? 'задача' : cards.length > 1 && cards.length < 5 ? 'задачи' : 'задач'}`} className="ml-auto rounded-full border border-border/60 bg-muted/70 px-2.5 py-1 text-xs font-semibold tabular-nums text-muted-foreground">{cards.length} {cards.length === 1 ? 'задача' : cards.length > 1 && cards.length < 5 ? 'задачи' : 'задач'}</span>
      </div>

      <div
        ref={setNodeRef}
        className={`flex-1 rounded-b-xl rounded-tr-xl border border-border/60 bg-muted/25 p-2.5 transition-colors min-h-[160px] ${isOver ? 'bg-primary/5 border-primary/40 ring-2 ring-primary/15' : ''}`}
      >
        <SortableContext items={cards.map(c => c.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-3">
            {groups.map(renderGroup)}
          </div>
        </SortableContext>

        {cards.length === 0 && (
          <div className="flex min-h-[136px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-background/80 px-4 text-center text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">Здесь пока нет задач</span>
            <span className="max-w-[24ch] text-xs leading-relaxed">
              {id === 'todo'
                ? 'Нажмите «+ Задача» — новая задача появится здесь.'
                : id === 'review'
                  ? 'Переместите сюда задачу, когда её можно проверить.'
                  : 'Переместите сюда задачу, когда начнёте её выполнять.'}
            </span>
          </div>
        )}

      </div>
    </div>
  );
}
