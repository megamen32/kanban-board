'use client';

import { useMemo, useState } from 'react';
import { CheckCircle2, Circle, Flag } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DEFAULT_COLUMNS, PRIORITY_COLORS } from '@/lib/kanban/types';
import type { KanbanCard, KanbanColumn } from '@/lib/kanban/types';

interface Props {
  cards: KanbanCard[];
  onStatusChange: (id: string, column: KanbanColumn, version: number) => Promise<unknown>;
  onOpen: (card: KanbanCard) => void;
}

export function TaskListView({ cards, onStatusChange, onOpen }: Props) {
  const [pendingStatuses, setPendingStatuses] = useState<Record<string, KanbanColumn>>({});
  const displayCards = useMemo(() => cards.map(card => pendingStatuses[card.id] ? { ...card, column: pendingStatuses[card.id] } : card), [cards, pendingStatuses]);
  const sorted = useMemo(() => [...cards].sort((a, b) => {
    if (a.column === 'done' && b.column !== 'done') return 1;
    if (a.column !== 'done' && b.column === 'done') return -1;
    return a.order - b.order;
  }), [cards]);

  const changeStatus = async (card: KanbanCard, column: KanbanColumn) => {
    setPendingStatuses(previous => ({ ...previous, [card.id]: column }));
    const result = await onStatusChange(card.id, column, card.version);
    setPendingStatuses(previous => {
      const next = { ...previous };
      delete next[card.id];
      return next;
    });
    if (!result) return;
  };

  return (
    <div className="flex-1 overflow-y-auto p-3 sm:p-6">
      <div className="mx-auto max-w-3xl space-y-2">
        {sorted.length === 0 && (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            В этом представлении пока нет задач
          </div>
        )}
        {sorted.map(card => {
          const displayCard = displayCards.find(item => item.id === card.id) ?? card;
          const done = displayCard.column === 'done';
          return (
            <div key={card.id} className="flex items-center gap-2 rounded-xl border bg-background p-3 shadow-sm">
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0"
                aria-label={done ? 'Вернуть задачу в работу' : 'Отметить выполненной'}
                onClick={() => changeStatus(displayCard, done ? 'todo' : 'done')}
              >
                {done ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <Circle className="h-5 w-5 text-muted-foreground" />}
              </Button>
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpen(card)}>
                <div className={`font-medium ${done ? 'text-muted-foreground line-through' : ''}`}>{card.title}</div>
                <div className="mt-1 line-clamp-2 text-sm text-muted-foreground">{card.description || 'Без описания'}</div>
                <div className="mt-1 text-[11px] text-muted-foreground">{card.project || 'Без проекта'}{card.assignees.length ? ` · ${card.assignees.join(', ')}` : ''}</div>
              </button>
              <div className="flex shrink-0 items-center gap-1.5">
                <Badge variant="outline" className={`hidden sm:inline-flex text-[10px] px-1.5 py-0 ${PRIORITY_COLORS[card.priority]}`}>
                  <Flag className="mr-0.5 h-2.5 w-2.5" />{card.priority}
                </Badge>
                <select
                  aria-label={`Статус задачи: ${card.title}`}
                  className="h-9 max-w-[115px] rounded-md border bg-background px-2 text-xs"
                  value={displayCard.column}
                  onChange={event => changeStatus(displayCard, event.target.value as KanbanColumn)}
                >
                  {DEFAULT_COLUMNS.filter(column => column.id !== 'archived').map(column => (
                    <option key={column.id} value={column.id}>{column.title}</option>
                  ))}
                </select>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
