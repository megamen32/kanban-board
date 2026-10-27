'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Circle, Target } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { type KanbanCard, type KanbanColumn, type RoleId, type RoleDefinition } from '../../lib/kanban/types';
import type { RoleBalanceView as RoleBalanceData } from '../../lib/kanban/planning-views';
import { getExecutionView, getWeekView } from '../../lib/kanban/planning-views';
import { getWeeklySelectionState } from './view-model';
import { MarkdownText } from './markdown-text';

const roleLabels: Record<RoleId, string> = {
  'product-builder': 'Создатель продуктов',
  'client-integrator': 'Интегратор для клиентов',
  'team-lead': 'Руководитель команды',
  'author-public': 'Автор и публичная роль',
  'personal-relationships': 'Личное и отношения',
  'sharpening-the-saw': 'Заточка пилы',
};

/** Returns one active Execution column, excluding the archived state. */
export function getExecutionColumnCards(cards: KanbanCard[], columnId: KanbanColumn): KanbanCard[] {
  return getExecutionView(cards)[columnId];
}

function planningStatusLabel(column: KanbanColumn): string {
  if (column === 'inbox' || column === 'todo' || column === 'someday') return 'Входящие';
  if (column === 'blocked') return 'В работе · блокер';
  if (column === 'in-progress') return 'В работе';
  if (column === 'review') return 'На проверке';
  if (column === 'done') return 'Готово';
  return 'Не планируется';
}

function dueDateLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('ru-RU');
}

interface CardListProps {
  cards: KanbanCard[];
  roles?: RoleDefinition[];
  onOpen: (card: KanbanCard) => void;
  empty: string;
}

/** Renders a compact keyboard-accessible card list for derived planning views. */
export function PlanningCardList({ cards, roles = [], onOpen, empty }: CardListProps) {
  if (cards.length === 0) return <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{empty}</div>;
  return (
    <div className="mx-auto w-full max-w-3xl space-y-2">
      {cards.map(card => (
        <article key={card.id} className="flex items-start gap-3 rounded-xl border bg-background p-3 shadow-sm">
          <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <button type="button" onClick={() => onOpen(card)} className="block max-w-full truncate text-left font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              {card.title}
            </button>
            {card.description.trim()
              ? <div className="mt-1 max-h-40 overflow-y-auto text-sm text-muted-foreground"><MarkdownText text={card.description} /></div>
              : <p className="mt-1 text-sm text-muted-foreground">Без описания</p>}
            <p className="mt-1 text-[11px] text-muted-foreground">{card.project || 'Без проекта'}{card.role ? ` · ${roles.find(role => role.id === card.role)?.label ?? roleLabels[card.role] ?? card.role}` : ''}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Badge variant="outline" className="text-[10px]">{planningStatusLabel(card.column)}</Badge>
            {(card.urgent || card.priority === 'critical') && <Badge variant="destructive" className="text-[10px]">Срочно</Badge>}
            {card.dueAt && <span className="text-[10px] text-muted-foreground">Срок: {dueDateLabel(card.dueAt)}</span>}
          </div>
        </article>
      ))}
    </div>
  );
}

interface WeekViewProps {
  cards?: KanbanCard[];
  roles?: RoleDefinition[];
  now?: string | Date;
  draft: { week: string; cardIds: string[]; cards: KanbanCard[] } | null;
  loading: boolean;
  error: string | null;
  canAccept: boolean;
  onLoad: () => void;
  onAccept: (ids: string[]) => Promise<unknown>;
  onOpen: (card: KanbanCard) => void;
}

interface WeeklyViewSections {
  currentWeek: KanbanCard[];
  proposal: KanbanCard[];
}

/** Splits the derived current-week view from the separately accepted proposal. */
export function getWeeklyViewSections(
  cards: KanbanCard[],
  draft: WeekViewProps['draft'],
  now: string | Date = new Date(),
): WeeklyViewSections {
  return {
    currentWeek: getWeekView(cards, now),
    proposal: draft ? cards.filter(card => card.column !== 'done' && card.column !== 'archived' && !(card.bigRock && card.week === draft.week)) : [],
  };
}

/** Displays accepted current-week work and keeps the write-free proposal secondary. */
export function WeeklyPlanView({ cards = [], roles, now = new Date(), draft, loading, error, canAccept, onLoad, onAccept, onOpen }: WeekViewProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  useEffect(() => { if (draft) setSelectedIds(draft.cardIds); }, [draft]);
  const sections = useMemo(() => getWeeklyViewSections(cards, draft, now), [cards, draft, now]);
  const visibleIds = sections.proposal.map(card => card.id).join('\n');
  useEffect(() => { setSelectedIds(current => current.filter(id => sections.proposal.some(card => card.id === id))); }, [visibleIds]);
  const selection = useMemo(() => getWeeklySelectionState(selectedIds.filter(id => sections.proposal.some(card => card.id === id))), [selectedIds, sections.proposal]);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-3">
      <section aria-labelledby="accepted-week-heading" className="space-y-2">
        <div><h2 id="accepted-week-heading" className="font-medium">Текущая неделя</h2><p className="text-xs text-muted-foreground">Принятые Big Rocks и поддерживающие действия</p></div>
        <PlanningCardList cards={sections.currentWeek} roles={roles} onOpen={onOpen} empty="На эту неделю пока ничего не принято" />
      </section>
      {!draft && <Button variant="outline" onClick={onLoad} disabled={loading}>{loading ? 'Загружаем…' : 'Загрузить план недели'}</Button>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {draft && <>
        <section aria-labelledby="weekly-proposal-heading" className="space-y-2 rounded-lg border bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h2 id="weekly-proposal-heading" className="font-medium">Предложение на неделю {draft.week}</h2><p className="text-xs text-muted-foreground">Выберите от 1 до 6 Big Rocks</p></div>
          <Button onClick={() => onAccept(selection.selectedIds)} disabled={!canAccept || !selection.canAccept || loading}>
            <Check className="mr-2 h-4 w-4" />Принять ({selection.selectedIds.length})
          </Button>
        </div>
        <div className="space-y-2">
          {sections.proposal.map(card => {
            const selected = selection.selectedIds.includes(card.id);
            return <label key={card.id} className="flex items-start gap-3 rounded-xl border bg-background p-3">
              <input type="checkbox" className="mt-1 h-4 w-4" checked={selected} onChange={() => setSelectedIds(current => selected ? current.filter(id => id !== card.id) : [...current, card.id])} aria-label={`Выбрать Big Rock: ${card.title}`} />
              <button type="button" onClick={() => onOpen(card)} className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><span className="block font-medium">{card.title}</span><span className="text-sm text-muted-foreground">{card.project || 'Без проекта'}</span></button>
              {card.bigRock && <Target className="h-4 w-4 shrink-0 text-amber-500" aria-label="Уже Big Rock" />}
            </label>;
          })}
        </div>
        </section>
      </>}
    </div>
  );
}

/** Renders the six-role current-week balance with accepted-rock warnings. */
export function RoleBalanceView({ balance, roles = [] }: { balance: RoleBalanceData; roles?: RoleDefinition[] }) {
  return <div className="mx-auto grid w-full max-w-3xl gap-3 sm:grid-cols-2">
    {Object.keys(balance).map(role => {
      const item = balance[role];
      const label = roles.find(item => item.id === role)?.label ?? roleLabels[role] ?? role;
      return <section key={role} className="rounded-xl border bg-background p-4" aria-label={label}>
        <div className="flex items-center justify-between gap-2"><h2 className="font-medium">{label}</h2>{item.warning ? <Badge variant="destructive">Нет Big Rock</Badge> : <Badge variant="secondary">В фокусе</Badge>}</div>
        <p className="mt-2 text-sm text-muted-foreground">{item.acceptedBigRocks.length} принятых Big Rocks · {item.activeActions.length} активных действий</p>
      </section>;
    })}
  </div>;
}
