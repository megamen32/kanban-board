'use client';

import { ArrowUpRight } from 'lucide-react';
import type { KanbanCard } from '../../lib/kanban/types';
import { taskSessionUrl } from '../../lib/kanban/task-execution';

const HARNESS_LABELS = { codex: 'Codex', zcode: 'ZCode', opencode: 'OpenCode' } as const;

/** A saved session binding, not a live-status probe. Never infer a session from card position. */
export function TaskSessionLink({ card, compact = false }: { card: KanbanCard; compact?: boolean }) {
  const receipt = card.taskExecutionHistory?.at(-1);
  if (!receipt) return null;
  const href = receipt.nativeSessionId
    ? taskSessionUrl(receipt.hostId, receipt.harness, receipt.nativeSessionId)
    : undefined;
  if (compact && !href) return null;

  const label = HARNESS_LABELS[receipt.harness] ?? receipt.harness;
  return (
    <div aria-label="Связь с Agent Herder" className={compact
      ? 'mt-2 flex flex-wrap items-center gap-1.5 text-[11px]'
      : 'flex flex-wrap items-center gap-2 rounded-md border bg-background/60 px-2.5 py-2 text-xs'}>
      <span className="text-muted-foreground">
        Agent Herder · {label}{compact ? '' : ` · ${receipt.hostId}`}
      </span>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-medium text-primary underline underline-offset-2 hover:opacity-80"
          aria-label={`Открыть сессию ${receipt.harness} ${receipt.nativeSessionId} в Agent Herder`}
          onPointerDown={event => event.stopPropagation()}
          onPointerUp={event => event.stopPropagation()}
          onClick={event => event.stopPropagation()}
          onKeyDown={event => event.stopPropagation()}>
          Открыть сессию <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
        </a>
      ) : (
        <span className="text-muted-foreground">
          {receipt.nativeSessionId ? 'Нет проверенного адреса сессии' : 'Сессия пока не подтверждена'}
        </span>
      )}
    </div>
  );
}
