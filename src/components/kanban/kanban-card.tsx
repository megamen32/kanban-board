'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CalendarClock, GripVertical, Flag, Bot, Clock3 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { CardEditDialog } from './card-edit-dialog';
import { MarkdownCardPreview } from './markdown-card-preview';
import { getCardAncestorChain } from './card-hierarchy';
import { ReviewRecoveryControl } from './review-recovery-control';
import { linkedTaskSessions, TaskSessionLink } from './task-session-link';
import { TaskAiLaunch } from './task-ai-launch';
import { shouldOpenCardAfterPointer, type PointerCoordinates } from './card-interaction';
import { PRIORITY_COLORS } from '@/lib/kanban/types';
import type { KanbanCard as CardType, KanbanCardUpdates, RoleDefinition } from '@/lib/kanban/types';
import type { HumanReviewAction } from '@/lib/kanban/transition-policy';
import { taskPersonLabel } from '@/lib/kanban/task-membership';
import * as React from 'react';
import { useState, createContext, useContext, useRef } from 'react';

// Context for update/delete without prop drilling
interface CardActionsCtx {
  roles?: RoleDefinition[];
  username: string | null;
  refresh: () => Promise<void>;
  highlightCardId?: string | null;
  relatedCards: CardType[];
  breadcrumbCards: CardType[];
  onSelectCard: (card: CardType) => void;
  onUpdate: (id: string, updates: KanbanCardUpdates, version?: number) => Promise<CardType | null>;
  onDelete: (id: string) => Promise<unknown>;
  onReviewDecision: (id: string, action: HumanReviewAction, note: string, version: number) => Promise<CardType | null>;
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
  const { onUpdate, onDelete, onReviewDecision, roles, username, refresh, highlightCardId, relatedCards, breadcrumbCards, onSelectCard } = useCardActions();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { card, columnId },
  });
  const highlighted = highlightCardId === card.id;
  const hierarchyTrail = card.parent ? getCardAncestorChain(card, breadcrumbCards) : [];

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
  const columnAccent: Record<string, { rail: string; status: string; session: string }> = {
    inbox: { rail: 'border-l-slate-400', status: 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200', session: 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/70' },
    todo: { rail: 'border-l-sky-500', status: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-200', session: 'border-sky-200/80 bg-sky-50/70 dark:border-sky-900 dark:bg-sky-950/35' },
    'in-progress': { rail: 'border-l-blue-500', status: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-200', session: 'border-blue-200/80 bg-blue-50/70 dark:border-blue-900 dark:bg-blue-950/35' },
    review: { rail: 'border-l-amber-500', status: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200', session: 'border-amber-200/80 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/35' },
    blocked: { rail: 'border-l-rose-500', status: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-200', session: 'border-rose-200/80 bg-rose-50/70 dark:border-rose-900 dark:bg-rose-950/35' },
    done: { rail: 'border-l-emerald-500', status: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200', session: 'border-emerald-200/80 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/35' },
  };
  const accent = columnAccent[columnId] ?? columnAccent.todo;
  const executionReceipts = card.taskExecutionHistory ?? [];
  const linkedSessions = linkedTaskSessions(card);
  const linkedSessionCount = linkedSessions.length;
  const latestReceipt = executionReceipts.at(-1);
  const phaseLabels: Record<string, string> = {
    intent: 'Намерение записано',
    'create-unknown': 'Создание: результат неизвестен',
    created: 'Создано, запуск не подтверждён',
    'dispatch-unknown': 'Передача: результат неизвестен',
    running: 'Выполнение указано в сохранённых данных',
    waiting: 'Ожидание указано в сохранённых данных',
    stopped: 'Остановка указана в сохранённых данных',
    result: 'Результат сохранён',
  };

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        className={`group relative overflow-hidden rounded-xl border border-border/70 border-l-4 ${accent.rail} bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary touch-pan-y cursor-grab active:cursor-grabbing ${highlighted ? 'ring-2 ring-primary/70 bg-primary/5' : ''}`}
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
          <span aria-hidden className="mt-1 text-muted-foreground/45 shrink-0">
            <GripVertical className="h-5 w-5" />
          </span>
          <div className="flex-1 min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${accent.status}`}>{card.column === 'blocked' && card.blockerReason ? 'Заблокирована' : card.column === 'review' && card.needsReview ? 'Ждёт проверки' : card.column === 'in-progress' ? 'В работе' : card.column === 'done' ? 'Готово' : card.column === 'todo' ? 'Входящие' : 'Задача'}</span>
              <Badge variant="outline" className={`text-[11px] px-2 py-0.5 ${PRIORITY_COLORS[card.priority]}`}><Flag className="mr-1 h-3 w-3" />{{critical:'Срочный',high:'Высокий',medium:'Обычный',low:'Низкий'}[card.priority]}</Badge>
            </div>
            <div className="mb-2 font-semibold text-base leading-snug tracking-tight sm:text-[17px]">{card.title}</div>
            {card.parent && <p className="mb-2 truncate text-xs text-muted-foreground">Подзадача · {hierarchyTrail.length ? hierarchyTrail.map(item => item.title).join(' › ') : 'родитель скрыт текущей выборкой'}</p>}
            <MarkdownCardPreview card={card} />
            <ReviewRecoveryControl card={card} username={username} onDone={refresh} />
            {card.column === 'blocked' && card.blockerReason && <p className="mb-2 line-clamp-2 text-xs text-amber-700 dark:text-amber-300">Что мешает: {card.blockerReason}</p>}
            <section aria-label="Состояние AI-сессий" className={`my-3 rounded-xl border px-3 py-2.5 ${accent.session}`}>
              <div className="flex items-center gap-2 text-xs font-semibold">
                <Bot aria-hidden="true" className="h-4 w-4 text-primary" />
                <span>AI-сессии</span>
                <span className="ml-auto rounded-full border border-border/70 bg-background/80 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{linkedSessionCount} {linkedSessionCount === 1 ? 'сессия' : linkedSessionCount > 1 && linkedSessionCount < 5 ? 'сессии' : 'сессий'}</span>
              </div>
              {latestReceipt && <div className="mt-2 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                <Clock3 aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{phaseLabels[latestReceipt.phase] ?? 'Последнее состояние неизвестно'}</span>
              </div>}
              {latestReceipt?.lastProgress && <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-foreground/80"><span className="font-medium">Последнее сообщение:</span> {latestReceipt.lastProgress}{latestReceipt.lastProgressAt ? ` · ${timeAgo(latestReceipt.lastProgressAt)}` : ''}</p>}
              {latestReceipt ? <div className="mt-2"><TaskSessionLink card={card} compact /></div> : <TaskAiLaunch card={card} onRefresh={refresh} />}
            </section>
            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge variant="secondary" className="rounded-md px-2 py-1 text-xs">{card.project || 'Без проекта'}</Badge>
              {card.tags.slice(0, 3).map(t => <Badge key={t} variant="secondary" className="rounded-md px-2 py-1 text-xs">{t}</Badge>)}
              {card.tags.length > 3 && <span className="text-xs text-muted-foreground">+{card.tags.length - 3}</span>}
              {card.assignees.length > 0 && <span className="text-xs text-muted-foreground">↗ {[...new Set(card.assignees.map(taskPersonLabel))].join(', ')}</span>}
              {dueLabel && <span className="inline-flex items-center gap-1 rounded-md bg-muted/70 px-2 py-1 text-xs text-muted-foreground"><CalendarClock className="h-3.5 w-3.5" />{dueLabel}</span>}
            </div>
            <div className="mt-3 border-t border-border/60 pt-2 text-xs text-muted-foreground">Обновлена {timeAgo(card.updated)}</div>
            <button type="button" className="mt-2 text-xs font-semibold text-primary hover:underline" onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); setEditing(true); }} onKeyDown={event => event.stopPropagation()}>Открыть задачу →</button>
          </div>
        </div>
      </div>
      {editing && <CardEditDialog card={card} relatedCards={relatedCards} breadcrumbCards={breadcrumbCards} onSelectCard={related => { setEditing(false); onSelectCard(related); }} roles={roles} username={username} onRefresh={refresh} open={editing} onOpenChange={setEditing} onUpdate={onUpdate} onReviewDecision={onReviewDecision} onDelete={() => onDelete(card.id)} />}
    </>
  );
}
