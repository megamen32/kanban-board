'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';

import { DEFAULT_COLUMNS, type KanbanCard, type KanbanColumn } from '@/lib/kanban/types';
import { statusSaveError } from './status-result';

interface Props {
  cards: KanbanCard[];
  authoritativeCards?: KanbanCard[];
  onStatusChange: (id: string, column: KanbanColumn, version: number) => Promise<unknown>;
  onOpen: (card: KanbanCard) => void;
}

export function TaskListView({ cards, authoritativeCards = cards, onStatusChange, onOpen }: Props) {
  const [pendingStatuses, setPendingStatuses] = useState<Record<string, KanbanColumn>>({});
  const [statusError, setStatusError] = useState<string | null>(null);
  const [failedStatus, setFailedStatus] = useState<{ id: string; column: KanbanColumn } | null>(null);
  useEffect(() => {
    // An explicit conflict choice can later save the same requested transition.
    // Clear its old warning only when authoritative card state proves success.
    if (failedStatus && authoritativeCards.some(card => card.id === failedStatus.id && card.column === failedStatus.column)) {
      setStatusError(null);
      setFailedStatus(null);
    }
  }, [authoritativeCards, failedStatus]);
  const displayCards = useMemo(() => cards.map(card => pendingStatuses[card.id] ? { ...card, column: pendingStatuses[card.id] } : card), [cards, pendingStatuses]);
  const sorted = useMemo(() => [...displayCards].sort((a, b) => {
    if (a.column === 'done' && b.column !== 'done') return 1;
    if (a.column !== 'done' && b.column === 'done') return -1;
    return a.order - b.order;
  }), [displayCards]);

  const changeStatus = async (card: KanbanCard, column: KanbanColumn) => {
    if (pendingStatuses[card.id]) return;
    setStatusError(null);
    setFailedStatus(null);
    setPendingStatuses(previous => ({ ...previous, [card.id]: column }));
    try {
      const result = await onStatusChange(card.id, column, card.version);
      const error = statusSaveError(result, column);
      setStatusError(error);
      if (error) setFailedStatus({ id: card.id, column });
    } catch {
      setStatusError('Не удалось сохранить статус. Исходная карточка не скрыта.');
      setFailedStatus({ id: card.id, column });
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
            const needsReview = displayCard.column === 'review' && displayCard.needsReview === true;
            const status = DEFAULT_COLUMNS.find(column => column.id === displayCard.column)?.title ?? displayCard.column;
            return (
              <div key={card.id} className="group flex min-h-12 items-center gap-3 py-2">
                <button
                  type="button"
                  aria-label={needsReview ? 'Открыть результат для приёмки' : done ? 'Вернуть задачу' : 'Отметить выполненной'}
                  disabled={Boolean(pendingStatuses[card.id])}
                  onClick={() => needsReview ? onOpen(displayCard) : changeStatus(displayCard, done ? 'todo' : 'done')}
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${done ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-muted-foreground/50 hover:border-foreground'}`}
                >
                  {done && <Check className="h-3.5 w-3.5" />}
                </button>
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpen(displayCard)}>
                  <span className={`block text-sm sm:text-base ${done ? 'text-muted-foreground line-through' : 'text-foreground'}`}>{card.title}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{status}{needsReview ? ' · ожидает решения человека' : ''}{card.parent ? ` · подзадача ${card.parent}` : ''}</span>
                  {card.nextAction && <span className="mt-0.5 block truncate text-xs text-muted-foreground">Следующий шаг: {card.nextAction}</span>}
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
