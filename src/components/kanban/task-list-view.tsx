'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';

import { DEFAULT_COLUMNS, type KanbanCard, type KanbanColumn } from '@/lib/kanban/types';
import { statusSaveError } from './status-result';
import { ReviewRecoveryControl } from './review-recovery-control';
import { TaskSessionLink } from './task-session-link';
import { getCardAncestorChain, groupVisibleCardHierarchy, type VisibleCardHierarchyGroup } from './card-hierarchy';

interface Props {
  cards: KanbanCard[];
  authoritativeCards?: KanbanCard[];
  breadcrumbCards?: KanbanCard[];
  highlightCardId?: string | null;
  username?: string | null;
  onRefresh?: () => void | Promise<void>;
  onStatusChange: (id: string, column: KanbanColumn, version: number) => Promise<unknown>;
  onOpen: (card: KanbanCard) => void;
}

const ROW_TONE: Record<string, string> = {
  inbox: 'border-l-slate-400 bg-slate-50/70 dark:border-l-slate-500 dark:bg-slate-900/45',
  todo: 'border-l-sky-500 bg-sky-50/70 dark:border-l-sky-500 dark:bg-sky-950/20',
  'in-progress': 'border-l-blue-500 bg-blue-50/70 dark:border-l-blue-500 dark:bg-blue-950/20',
  review: 'border-l-amber-500 bg-amber-50/70 dark:border-l-amber-500 dark:bg-amber-950/20',
  blocked: 'border-l-rose-500 bg-rose-50/70 dark:border-l-rose-500 dark:bg-rose-950/20',
  done: 'border-l-emerald-500 bg-emerald-50/70 dark:border-l-emerald-500 dark:bg-emerald-950/20',
  someday: 'border-l-violet-500 bg-violet-50/70 dark:border-l-violet-500 dark:bg-violet-950/20',
};

const STATUS_TONE: Record<string, string> = {
  inbox: 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200',
  todo: 'border-sky-200 bg-sky-100 text-sky-800 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-200',
  'in-progress': 'border-blue-200 bg-blue-100 text-blue-800 dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-200',
  review: 'border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200',
  blocked: 'border-rose-200 bg-rose-100 text-rose-800 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-200',
  done: 'border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200',
  someday: 'border-violet-200 bg-violet-100 text-violet-800 dark:border-violet-800 dark:bg-violet-950/60 dark:text-violet-200',
};

export function TaskListView({ cards, authoritativeCards = cards, breadcrumbCards = cards, highlightCardId = null, username = null, onRefresh, onStatusChange, onOpen }: Props) {
  const [pendingStatuses, setPendingStatuses] = useState<Record<string, KanbanColumn>>({});
  const [statusError, setStatusError] = useState<string | null>(null);
  const [failedStatus, setFailedStatus] = useState<{ id: string; column: KanbanColumn } | null>(null);
  const highlightedRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    // A freshly created card has to reach the eye without a manual hunt.
    if (!highlightCardId) return;
    highlightedRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [highlightCardId]);
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
  const groups = useMemo(() => groupVisibleCardHierarchy(sorted), [sorted]);
  const breadcrumbById = useMemo(() => new Map(breadcrumbCards.map(card => [card.id, card])), [breadcrumbCards]);

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
    <div className="flex-1 overflow-y-auto px-3 py-4 sm:px-5 sm:py-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        {statusError && <p role="alert" className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{statusError}</p>}
        {sorted.length === 0 && (
          <div className="rounded-2xl border border-dashed bg-card px-5 py-14 text-center shadow-sm">
            <p className="text-base font-semibold text-foreground">Задачи не найдены</p>
            <p className="mt-2 text-sm text-muted-foreground">Проверь поиск и выбранные фильтры.</p>
          </div>
        )}
        <div className="space-y-3">
          {groups.map(group => renderGroup(group, 0))}
        </div>
      </div>
    </div>
  );

  function renderGroup(group: VisibleCardHierarchyGroup, depth: number): ReactNode {
            const card = group.card;
            const displayCard = card;
            const done = displayCard.column === 'done';
            const needsReview = displayCard.column === 'review' && displayCard.needsReview === true;
            const status = DEFAULT_COLUMNS.find(column => column.id === displayCard.column)?.title ?? displayCard.column;
            const receipts = card.taskExecutionHistory ?? [];
            const latestReceipt = receipts.at(-1);
            const knownSessionCount = new Set(receipts.map(receipt => receipt.nativeSessionId).filter((id): id is string => Boolean(id?.trim()))).size;
            const receiptPhase: Record<string, string> = {
              intent: 'Запуск запрошен',
              'create-unknown': 'Создание сессии не подтверждено',
              created: 'Сессия создана',
              'dispatch-unknown': 'Отправка задания не подтверждена',
              running: 'в работе',
              waiting: 'Ожидается ответ',
              stopped: 'Остановлено',
              result: 'Результат получен',
            };
            return (
              <div key={card.id} className={depth ? 'ml-3 border-l-2 border-border pl-3 sm:ml-5 sm:pl-4' : ''}>
                <div
                  ref={card.id === highlightCardId ? highlightedRef : undefined}
                  className={`group grid min-h-28 grid-cols-[1.5rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2 rounded-2xl border border-l-4 border-border/70 p-3.5 shadow-sm transition hover:shadow-md sm:p-5 ${ROW_TONE[card.column] ?? ROW_TONE.todo} ${card.id === highlightCardId ? 'ring-2 ring-primary/60' : ''}`}
                >
                  <button
                    type="button"
                    aria-label={needsReview ? 'Открыть результат для приёмки' : done ? 'Вернуть задачу' : 'Отметить выполненной'}
                    disabled={Boolean(pendingStatuses[card.id])}
                    onClick={() => needsReview ? onOpen(displayCard) : changeStatus(displayCard, done ? 'todo' : 'done')}
                    className={`mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 transition-colors ${done ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-muted-foreground/50 bg-background/80 hover:border-foreground'}`}
                  >
                    {done && <Check className="h-3.5 w-3.5" />}
                  </button>
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-start gap-3">
                      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpen(displayCard)}>
                        <span className={`mb-2 inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_TONE[card.column] ?? STATUS_TONE.todo}`}>{status}{needsReview ? ' · ждёт решения' : ''}</span>
                        <span className={`block text-base font-semibold leading-snug tracking-tight sm:text-lg ${done ? 'text-muted-foreground line-through' : 'text-foreground'}`}>{card.title}</span>
                        <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                          <span className="rounded-md border border-border/60 bg-background/70 px-2 py-1">{card.project || 'Без проекта'}</span>
                          {card.assignees.length > 0 && <span>Ответственные: {card.assignees.join(', ')}</span>}
                          {card.parent && <span>Подзадача · {getCardAncestorChain(card, [...breadcrumbById.values()]).at(-1)?.title ?? 'родитель вне текущей выборки'}</span>}
                        </span>
                        {card.nextAction && <span className="mt-2 block text-sm text-foreground/80">Следующий шаг: {card.nextAction}</span>}
                        {card.column === 'blocked' && card.blockerReason && <span className="mt-2 block rounded-lg border border-rose-200 bg-rose-50/70 px-3 py-2 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">Что мешает: {card.blockerReason}</span>}
                      </button>
                      <span className="hidden max-w-40 shrink-0 text-right text-xs text-muted-foreground lg:block">Обновлена<br />{new Date(card.updated).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</span>
                    </div>
                    <section aria-label="AI-сессии задачи" className="mt-3 rounded-xl border border-indigo-200/70 bg-indigo-50/70 px-3 py-2.5 text-muted-foreground dark:border-indigo-900 dark:bg-indigo-950/30 sm:px-4">
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                        <span className="text-xs font-semibold text-foreground">AI-сессии · {knownSessionCount}</span>
                        <span className="rounded-full bg-background/75 px-2.5 py-1 text-xs text-muted-foreground">
                          {latestReceipt ? `Последнее состояние: ${receiptPhase[latestReceipt.phase] ?? 'неизвестно'}` : 'AI-сессия не прикреплена · откройте задачу для подробностей'}
                        </span>
                      </div>
                      {latestReceipt?.lastProgress?.trim() && <p className="mt-2 break-words text-sm leading-relaxed text-foreground/80">Последнее сообщение: {latestReceipt.lastProgress.trim()}</p>}
                      {receipts.length > 0 && <TaskSessionLink card={displayCard} compact />}
                      {receipts.length === 0 && <button type="button" className="mt-2 text-xs font-semibold text-primary hover:underline" onClick={() => onOpen(displayCard)}>Открыть задачу →</button>}
                    </section>
                    <ReviewRecoveryControl card={displayCard} username={username} onDone={onRefresh} />
                    {group.children.length > 0 && <details className="mt-3">
                      <summary className="cursor-pointer text-sm font-medium text-muted-foreground">Подзадачи · {group.children.length}</summary>
                      <div className="mt-3 space-y-2">{group.children.map(child => renderGroup(child, depth + 1))}</div>
                    </details>}
                  </div>
                </div>
              </div>
            );
  }
}
