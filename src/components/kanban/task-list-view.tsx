'use client';

import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';

import type { KanbanCard, KanbanColumn } from '@/lib/kanban/types';

interface Props {
  cards: KanbanCard[];
  onStatusChange: (id: string, column: KanbanColumn, version: number) => Promise<unknown>;
  onOpen: (card: KanbanCard) => void;
}

export function TaskListView({ cards, onStatusChange, onOpen }: Props) {
  const [pendingStatuses, setPendingStatuses] = useState<Record<string, KanbanColumn>>({});
  const [statusError, setStatusError] = useState<string | null>(null);
  const displayCards = useMemo(() => cards.map(card => pendingStatuses[card.id] ? { ...card, column: pendingStatuses[card.id] } : card), [cards, pendingStatuses]);
  const sorted = useMemo(() => [...displayCards].sort((a, b) => {
    if (a.column === 'done' && b.column !== 'done') return 1;
    if (a.column !== 'done' && b.column === 'done') return -1;
    return a.order - b.order;
  }), [displayCards]);

  const changeStatus = async (card: KanbanCard, column: KanbanColumn) => {
    if (pendingStatuses[card.id]) return;
    setStatusError(null);
    setPendingStatuses(previous => ({ ...previous, [card.id]: column }));
    try {
      const result = await onStatusChange(card.id, column, card.version);
      if (!result) setStatusError('Статус не сохранён. Проверьте сообщение об ошибке и обновите доску.');
    } catch {
      setStatusError('Не удалось сохранить статус. Исходная карточка не скрыта.');
    } finally {
      setPendingStatuses(previous => {
        const next = { ...previous };
        delete next[card.id];
        return next;
      });
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-3 py-4 sm:px-6 sm:py-6">
      <div className="mx-auto max-w-2xl">
        {statusError && <p role="alert" className="mb-3 rounded-md border p-3 text-sm text-destructive">{statusError}</p>}
        {sorted.length === 0 && (
          <div className="py-12 text-center text-sm text-muted-foreground">Задач пока нет</div>
        )}
        <div className="divide-y">
          {sorted.map(card => {
            const displayCard = displayCards.find(item => item.id === card.id) ?? card;
            const done = displayCard.column === 'done';
            return (
              <div key={card.id} className="group flex min-h-12 items-center gap-3 py-2">
                <button
                  type="button"
                  aria-label={done ? 'Вернуть задачу' : 'Отметить выполненной'}
                  disabled={Boolean(pendingStatuses[card.id])}
                  onClick={() => changeStatus(displayCard, done ? 'todo' : 'done')}
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${done ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-muted-foreground/50 hover:border-foreground'}`}
                >
                  {done && <Check className="h-3.5 w-3.5" />}
                </button>
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpen(card)}>
                  <span className={`block text-sm sm:text-base ${done ? 'text-muted-foreground line-through' : 'text-foreground'}`}>{card.title}</span>
                </button>
                {card.assignees.length > 0 && (
                  <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">{card.assignees.join(', ')}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
