'use client';

import { useEffect, useState } from 'react';
import { ArrowUpRight, CircleHelp, Clock3 } from 'lucide-react';
import type { KanbanCard } from '@/lib/kanban/types';
import { Button } from '@/components/ui/button';
import { DEFAULT_COLUMNS } from '@/lib/kanban/types';
import { executionSignalLabel, getDashboardCounts, getLatestResult, isVerifiedSessionUrl, parseExecutionSnapshot, type ExecutionSnapshot } from './integrator-dashboard-model';

type Props = { cards: KanbanCard[]; onOpen: (card: KanbanCard) => void };

function safeSourceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch { return null; }
}

export function IntegratorTaskDashboard({ cards, onOpen }: Props) {
  const [executions, setExecutions] = useState<Record<string, ExecutionSnapshot | null>>({});
  const counts = getDashboardCounts(cards);

  useEffect(() => {
    let cancelled = false;
    const candidates = cards.filter(card => !['done', 'archived'].includes(card.column));
    setExecutions({});
    const load = async () => {
      for (let offset = 0; offset < candidates.length; offset += 4) {
        const batch = candidates.slice(offset, offset + 4);
        const results = await Promise.all(batch.map(async card => {
          try {
            const response = await fetch(`/api/kanban/cards/${encodeURIComponent(card.id)}/execution`, { cache: 'no-store' });
            if (!response.ok) return [card.id, null] as const;
            const body: unknown = await response.json();
            const data = body && typeof body === 'object' && 'execution' in body
              ? (body as { execution: unknown }).execution : body;
            return [card.id, parseExecutionSnapshot(data, card.id)] as const;
          } catch { return [card.id, null] as const; }
        }));
        if (!cancelled) setExecutions(previous => ({ ...previous, ...Object.fromEntries(results) }));
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [cards]);

  return (
    <section aria-labelledby="integrator-dashboard-title" className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="space-y-1">
          <h2 id="integrator-dashboard-title" className="text-xl font-semibold">Обзор задач</h2>
          <p className="text-sm text-muted-foreground">Задачи, исполнители и следующий шаг.</p>
        </header>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Summary label="Активные задачи" value={counts.active} />
          <Summary label="Ждут проверки" value={counts.review} />
          <Summary label="Заблокированы" value={counts.blocked} />
          <Summary label="С сохранённым результатом" value={counts.withResults} />
        </div>

        {cards.length === 0 ? <p className="rounded-lg border p-6 text-sm text-muted-foreground">В текущем фильтре нет активных задач.</p> : (
          <div className="space-y-3">
            {cards.map(card => {
              const result = getLatestResult(card);
              const execution = executions[card.id];
              const column = DEFAULT_COLUMNS.find(item => item.id === card.column)?.title ?? card.column;
              const sourceUrl = card.source ? safeSourceUrl(card.source) : null;
              return (
                <article key={card.id} className="rounded-lg border bg-card p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <button type="button" onClick={() => onOpen(card)} className="min-w-0 flex-1 text-left">
                      <h3 className="font-semibold leading-snug hover:underline">{card.title}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">{card.project || 'Без проекта'} · {column}</p>
                    </button>
                    {card.column === 'review' && card.needsReview && <Button size="sm" onClick={() => onOpen(card)}>Открыть проверку</Button>}
                  </div>

                  <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-xs text-muted-foreground">Ответственный за задачу</dt>
                      <dd>{card.accountable || card.owner || 'Не указан'}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Исполнитель</dt>
                      <dd>{card.assignees.length ? card.assignees.join(', ') : card.assignee || 'Не указан'}</dd>
                    </div>
                  </dl>

                    {card.description.trim() && <div className="mt-3 rounded-md bg-muted/40 p-3">
                    <p className="text-xs font-medium text-muted-foreground">Описание и ожидаемый результат</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{card.description}</p>
                  </div>}

                  <div className="mt-3 rounded-md border p-3">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {execution ? <Clock3 aria-hidden className="h-4 w-4" /> : <CircleHelp aria-hidden className="h-4 w-4" />}
                      <span>Сигнал исполнения по сохранённым данным: {execution ? executionSignalLabel(execution.state) : 'Нет доступного подтверждённого статуса'}</span>
                    </div>
                    {execution?.lastProgress && <p className="mt-2 text-sm"><span className="text-muted-foreground">Последняя сохранённая сводка:</span> {execution.lastProgress.summary}</p>}
                    {execution?.waitReason && <p className="mt-2 text-sm"><span className="text-muted-foreground">Причина ожидания:</span> {execution.waitReason}</p>}
                    {execution?.nextAction && <p className="mt-2 text-sm"><span className="text-muted-foreground">Следующий шаг исполнителя:</span> {execution.nextAction}</p>}
                    {execution?.sessionUrl && isVerifiedSessionUrl(execution.sessionUrl) && <a className="mt-2 inline-flex items-center gap-1 text-sm underline" href={execution.sessionUrl} target="_blank" rel="noreferrer">Открыть сессию исполнителя <ArrowUpRight aria-hidden className="h-3.5 w-3.5" /></a>}
                  </div>

                  {result && <div className="mt-3 border-l-2 pl-3">
                    <p className="text-xs font-medium text-muted-foreground">Последний сохранённый результат</p>
                    <p className="mt-1 text-sm">{result.summary}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Сохранён {formatDate(result.submittedAt)}{result.evidenceRefs.length ? ` · подтверждений: ${result.evidenceRefs.length}` : ''}</p>
                  </div>}

                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                    <p><span className="text-muted-foreground">Следующий шаг по карточке:</span> {card.nextAction || card.waitingFor?.join(', ') || (card.column === 'review' && card.needsReview ? 'Нужно решение проверяющего' : 'Не указан')}</p>
                    {card.dueAt && <p><span className="text-muted-foreground">Срок задачи:</span> {formatDate(card.dueAt)}</p>}
                    {sourceUrl && <a className="inline-flex items-center gap-1 underline" href={sourceUrl} target="_blank" rel="noreferrer">Источник <ArrowUpRight aria-hidden className="h-3.5 w-3.5" /></a>}
                    {(card.resultHistory?.length ?? 0) > 0 && <button type="button" className="underline" onClick={() => onOpen(card)}>Результат и история проверки</button>}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold">{value}</p></div>;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ru-RU');
}
