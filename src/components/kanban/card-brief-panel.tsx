'use client';

import { useEffect, useMemo, useState } from 'react';
import { taskPersonLabel } from '../../lib/kanban/task-membership';
import {
  CARD_BRIEF_MIN_DESCRIPTION_RUNES,
  CARD_BRIEF_MAX_SOURCE_RUNES,
  cardBriefProjectionCache,
  getCardBriefFacts,
  hashCardBriefSource,
  isCurrentCardBrief,
  requestCardBrief,
  type CardBriefProjection,
  type CardBriefSource,
} from './card-brief';

interface Props {
  card: CardBriefSource;
  compact?: boolean;
  autoSummarize?: boolean;
  summaryOnly?: boolean;
}

export function CardBriefPanel({ card, compact = false, autoSummarize = false, summaryOnly = false }: Props) {
  const assigneesKey = JSON.stringify(card.assignees);
  const source = useMemo<CardBriefSource>(() => ({
    id: card.id,
    title: card.title,
    description: card.description,
    assignees: JSON.parse(assigneesKey) as string[],
    assignee: card.assignee,
    dueAt: card.dueAt,
    nextAction: card.nextAction,
    column: card.column,
  }), [card.id, card.title, card.description, assigneesKey, card.assignee, card.dueAt, card.nextAction, card.column]);
  const sourceKey = JSON.stringify(source);
  const [hashState, setHashState] = useState<{ sourceKey: string; sourceHash: string } | null>(null);
  const [projectionState, setProjectionState] = useState<{ sourceKey: string; projection: CardBriefProjection | null; failure: 'unavailable' | 'oversize' | null; loading?: boolean } | null>(null);

  useEffect(() => {
    let active = true;
    setProjectionState(null);
    void hashCardBriefSource(source).then(async sourceHash => {
      if (!active) return;
      cardBriefProjectionCache.markCurrent(source.id, sourceHash);
      setHashState({ sourceKey, sourceHash });
      const cached = cardBriefProjectionCache.get(source.id, sourceHash);
      if (cached) {
        setProjectionState({ sourceKey, projection: cached, failure: null });
        return;
      }
      if (!autoSummarize) return;
      if (Array.from(source.description).length < CARD_BRIEF_MIN_DESCRIPTION_RUNES) return;
      if (Array.from(`${source.title}\n${source.description}\n${source.nextAction ?? ''}`).length > CARD_BRIEF_MAX_SOURCE_RUNES) {
        setProjectionState({ sourceKey, projection: null, failure: 'oversize' });
        return;
      }
      setProjectionState({ sourceKey, projection: null, failure: null, loading: true });
      const result = await requestCardBrief(source, sourceHash);
      if (!active) return;
      setProjectionState({ sourceKey, projection: result, failure: result ? null : 'unavailable' });
    }).catch(() => {
      if (active && autoSummarize && Array.from(source.description).length >= CARD_BRIEF_MIN_DESCRIPTION_RUNES) {
        setProjectionState({ sourceKey, projection: null, failure: 'unavailable' });
      }
    });
    return () => { active = false; };
  }, [source, sourceKey, autoSummarize]);

  const facts = getCardBriefFacts(card);
  const sourceHash = hashState?.sourceKey === sourceKey ? hashState.sourceHash : null;
  const currentProjection = sourceHash && projectionState?.sourceKey === sourceKey
    && isCurrentCardBrief(card.id, sourceHash, projectionState.projection) ? projectionState.projection : null;
  const summaryFailure = projectionState?.sourceKey === sourceKey ? projectionState.failure : null;
  const summaryLoading = projectionState?.sourceKey === sourceKey && projectionState.loading;

  const hasExecutor = card.assignees.some(person => person.trim()) || !!card.assignee?.trim();
  const hasDeadline = !!card.dueAt && Number.isFinite(new Date(card.dueAt).getTime());
  if (!currentProjection && !summaryLoading && !summaryFailure && (summaryOnly || (!hasExecutor && !hasDeadline && !facts.nextStep))) return null;

  return (
    <section aria-label="Краткая суть задачи" className={compact ? 'mb-2 space-y-1 text-xs' : 'space-y-3 rounded-md border bg-muted/20 p-3'}>
      {currentProjection && <p className="text-sm leading-snug"><span className="font-medium">ИИ-сводка: </span>{currentProjection.summary}</p>}
      {summaryLoading && <p role="status" className="text-xs text-muted-foreground">Готовлю ИИ-сводку…</p>}
      {summaryFailure === 'unavailable' && <p role="status" className="text-xs text-muted-foreground">ИИ-сводка сейчас недоступна; поля карточки и полный исходник доступны ниже.</p>}
      {summaryFailure === 'oversize' && <p role="status" className="text-xs text-muted-foreground">Описание слишком длинное для автоматической сводки; полный исходник доступен ниже.</p>}
      {!summaryOnly && <dl className={compact ? 'space-y-0.5 text-muted-foreground' : 'grid gap-2 text-sm sm:grid-cols-2'}>
        {facts.action.trim() !== card.title.trim() && <div><dt className="inline font-medium text-foreground">Действие: </dt><dd className="inline">{facts.action}</dd></div>}
        {hasExecutor && <div><dt className="inline font-medium text-foreground">Исполнитель: </dt><dd className="inline">{taskPersonLabel(facts.executor)}</dd></div>}
        {hasDeadline && <div><dt className="inline font-medium text-foreground">Готово до: </dt><dd className="inline">{facts.deadline}</dd></div>}
        {facts.nextStep && <div><dt className="inline font-medium text-foreground">Следующий шаг: </dt><dd className="inline">{facts.nextStep}</dd></div>}
      </dl>}
    </section>
  );
}
