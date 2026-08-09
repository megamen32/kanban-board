'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Flag } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { CardEditDialog } from './card-edit-dialog';
import { PRIORITY_COLORS } from '@/lib/kanban/types';
import type { KanbanCard as CardType } from '@/lib/kanban/types';
import * as React from 'react';
import { useState, createContext, useContext } from 'react';

// Context for update/delete without prop drilling
interface CardActionsCtx {
  onUpdate: (id: string, updates: Partial<CardType>, version?: number) => Promise<CardType | null>;
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

  return (
    <>
      <div ref={setNodeRef} style={style} className="group bg-background rounded-md border border-border p-3 cursor-pointer hover:shadow-sm transition-all hover:border-border" onClick={() => setEditing(true)}>
        <div className="flex items-start gap-1">
          <button className="mt-0.5 text-muted-foreground/30 hover:text-muted-foreground cursor-grab active:cursor-grabbing shrink-0" {...attributes} {...listeners} onClick={e => e.stopPropagation()}>
            <GripVertical className="h-4 w-4" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm leading-tight truncate mb-1">{card.title}</div>
            {card.description && <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{card.description}</p>}
            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${PRIORITY_COLORS[card.priority]}`}>
                <Flag className="h-2.5 w-2.5 mr-0.5" />{card.priority}
              </Badge>
              {card.tags.slice(0, 3).map(t => <Badge key={t} variant="secondary" className="text-[10px] px-1.5 py-0">{t}</Badge>)}
              {card.tags.length > 3 && <span className="text-[10px] text-muted-foreground">+{card.tags.length - 3}</span>}
            </div>
            <div className="text-[10px] text-muted-foreground/50 mt-1.5">v{card.version} · {timeAgo(card.updated)}</div>
          </div>
        </div>
      </div>
      {editing && <CardEditDialog card={card} open={editing} onOpenChange={setEditing} onUpdate={onUpdate} onDelete={() => onDelete(card.id)} />}
    </>
  );
}
