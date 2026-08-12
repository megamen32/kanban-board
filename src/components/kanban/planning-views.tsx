'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Circle, Target } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { ROLE_IDS, type KanbanCard, type KanbanColumn, type RoleId } from '../../lib/kanban/types';
import type { RoleBalanceView as RoleBalanceData } from '../../lib/kanban/planning-views';
import { getExecutionView, getWeekView } from '../../lib/kanban/planning-views';
import { getWeeklySelectionState } from './view-model';

const roleLabels: Record<RoleId, string> = {
  'product-builder': 'Product builder',
  'client-integrator': 'Client integrator',
  'team-lead': 'Team lead',
  'author-public': 'Author / public',
  'personal-relationships': 'Personal relationships',
  'sharpening-the-saw': 'Sharpening the saw',
};

/** Returns one active Execution column, excluding the archived state. */
export function getExecutionColumnCards(cards: KanbanCard[], columnId: KanbanColumn): KanbanCard[] {
  return getExecutionView(cards)[columnId];
}

interface CardListProps {
  cards: KanbanCard[];
  onOpen: (card: KanbanCard) => void;
  empty: string;
}

/** Renders a compact keyboard-accessible card list for derived planning views. */
export function PlanningCardList({ cards, onOpen, empty }: CardListProps) {
  if (cards.length === 0) return <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{empty}</div>;
  return (
    <div className="mx-auto w-full max-w-3xl space-y-2">
      {cards.map(card => (
        <button key={card.id} type="button" onClick={() => onOpen(card)} className="flex w-full items-start gap-3 rounded-xl border bg-background p-3 text-left shadow-sm transition hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{card.title}</span>
            <span className="mt-1 block line-clamp-2 text-sm text-muted-foreground">{card.description || 'Без описания'}</span>
            <span className="mt-1 block text-[11px] text-muted-foreground">{card.project || 'Без проекта'}{card.role ? ` · ${roleLabels[card.role]}` : ''}</span>
          </span>
          <Badge variant="outline" className="shrink-0 text-[10px]">{card.column}</Badge>
        </button>
      ))}
    </div>
  );
}

interface WeekViewProps {
  cards?: KanbanCard[];
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
    proposal: draft?.cards ?? [],
  };
}

/** Displays accepted current-week work and keeps the write-free proposal secondary. */
export function WeeklyPlanView({ cards = [], now = new Date(), draft, loading, error, canAccept, onLoad, onAccept, onOpen }: WeekViewProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  useEffect(() => { if (draft) setSelectedIds(draft.cardIds); }, [draft]);
  const selection = useMemo(() => getWeeklySelectionState(selectedIds), [selectedIds]);
  const sections = useMemo(() => getWeeklyViewSections(cards.length > 0 ? cards : (draft?.cards ?? []), draft, now), [cards, draft, now]);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-3">
      <section aria-labelledby="accepted-week-heading" className="space-y-2">
        <div><h2 id="accepted-week-heading" className="font-medium">Текущая неделя</h2><p className="text-xs text-muted-foreground">Принятые Big Rocks и поддерживающие действия</p></div>
        <PlanningCardList cards={sections.currentWeek} onOpen={onOpen} empty="На эту неделю пока ничего не принято" />
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
          {draft.cards.map(card => {
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
export function RoleBalanceView({ balance }: { balance: RoleBalanceData }) {
  return <div className="mx-auto grid w-full max-w-3xl gap-3 sm:grid-cols-2">
    {ROLE_IDS.map(role => {
      const item = balance[role];
      return <section key={role} className="rounded-xl border bg-background p-4" aria-label={roleLabels[role]}>
        <div className="flex items-center justify-between gap-2"><h2 className="font-medium">{roleLabels[role]}</h2>{item.warning ? <Badge variant="destructive">Нет Big Rock</Badge> : <Badge variant="secondary">В фокусе</Badge>}</div>
        <p className="mt-2 text-sm text-muted-foreground">{item.acceptedBigRocks.length} принятых Big Rocks · {item.activeActions.length} активных действий</p>
      </section>;
    })}
  </div>;
}
