'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CalendarClock, GripVertical, Flag } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { CardEditDialog } from './card-edit-dialog';
import { CardPreview } from './card-preview';
import { shouldOpenCardAfterPointer, type PointerCoordinates } from './card-interaction';
import { PRIORITY_COLORS } from '@/lib/kanban/types';
import type { KanbanCard as CardType, KanbanCardUpdates } from '@/lib/kanban/types';
import * as React from 'react';
import { useState, createContext, useContext, useRef } from 'react';

// Context for update/delete without prop drilling
interface CardActionsCtx {
  onUpdate: (id: string, updates: KanbanCardUpdates, version?: number) => Promise<CardType | null>;
  onDelete: (id: string) => void;
}
export const CardActionsContext: React.Context<CardActionsCtx> = createContext<CardActionsCtx>(null!);
export const useCardActions = () => useContext(CardActionsContext);

interface Props {
  card: CardType;
  columnId: string;
}

export function KanbanCard({ card, columnId }: Props) {
  const [editing, setEditing] = useState(false);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const { onUpdate, onDelete } = useCardActions();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { card, columnId },
  });

  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };

  const timeAgo = (d: string) => {
    const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
    if (m < 1) return 'сейчас';
    if (m < 60) return `${m}м`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}ч`;
    return `${Math.floor(h / 24)}д`;
  };
  const dueLabel = card.dueAt ? new Date(card.dueAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : null;

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        className="group relative bg-background rounded-md border border-border p-3 cursor-grab active:cursor-grabbing hover:shadow-sm transition-all hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary touch-pan-y"
        onPointerDownCapture={event => {
          pointerStart.current = { x: event.clientX, y: event.clientY };
          suppressClick.current = false;
        }}
        onPointerUpCapture={event => {
          if (!pointerStart.current) return;
          suppressClick.current = !shouldOpenCardAfterPointer({
            startX: pointerStart.current.x,
            startY: pointerStart.current.y,
            endX: event.clientX,
            endY: event.clientY,
          } satisfies PointerCoordinates);
          pointerStart.current = null;
        }}
        onClick={event => {
          if (suppressClick.current) {
            event.preventDefault();
            event.stopPropagation();
            suppressClick.current = false;
            return;
          }
          setEditing(true);
        }}
        aria-label={`Открыть задачу: ${card.title}`}
      >
        <div className="flex items-start gap-2">
          <span aria-hidden className="mt-0.5 text-muted-foreground/30 shrink-0">
            <GripVertical className="h-4 w-4" />
          </span>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm leading-tight truncate mb-1">{card.title}</div>
            <CardPreview title={card.title} description={card.description} />
            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{card.project || 'Без проекта'}</Badge>
              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${PRIORITY_COLORS[card.priority]}`}>
                <Flag className="h-2.5 w-2.5 mr-0.5" />{card.priority}
              </Badge>
              {card.tags.slice(0, 3).map(t => <Badge key={t} variant="secondary" className="text-[10px] px-1.5 py-0">{t}</Badge>)}
              {card.tags.length > 3 && <span className="text-[10px] text-muted-foreground">+{card.tags.length - 3}</span>}
              {card.assignees.length > 0 && <span className="text-[10px] text-muted-foreground">↗ {card.assignees.join(', ')}</span>}
              {dueLabel && <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground"><CalendarClock className="h-2.5 w-2.5" />{dueLabel}</span>}
            </div>
            <div className="text-[10px] text-muted-foreground/50 mt-1.5">v{card.version} · {timeAgo(card.updated)}</div>
          </div>
        </div>
      </div>
      {editing && <CardEditDialog card={card} open={editing} onOpenChange={setEditing} onUpdate={onUpdate} onDelete={() => onDelete(card.id)} />}
    </>
  );
}
