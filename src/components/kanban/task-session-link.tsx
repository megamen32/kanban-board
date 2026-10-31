'use client';

import { useEffect, useState } from 'react';
import { ArrowUpRight, X } from 'lucide-react';
import type { KanbanCard } from '../../lib/kanban/types';
import { taskSessionEmbedUrl, taskSessionUrl } from '../../lib/kanban/task-execution';

const HARNESS_LABELS = { codex: 'Codex', zcode: 'ZCode', opencode: 'OpenCode' } as const;

type LinkedSession = {
  key: string;
  harness: string;
  sessionId: string;
  hostId: string;
  href: string;
  embedHref: string;
};

export function linkedTaskSessions(card: KanbanCard): LinkedSession[] {
  const links: LinkedSession[] = [];
  const seen = new Set<string>();
  // The most recent *created* session wins, even if a newer attempt has no session yet.
  for (const receipt of [...(card.taskExecutionHistory ?? [])].reverse()) {
    if (!receipt.nativeSessionId) continue;
    const href = taskSessionUrl(receipt.hostId, receipt.harness, receipt.nativeSessionId);
    const embedHref = taskSessionEmbedUrl(receipt.hostId, receipt.harness, receipt.nativeSessionId);
    if (!href || !embedHref || seen.has(href)) continue;
    seen.add(href);
    links.push({
      key: href,
      harness: receipt.harness,
      sessionId: receipt.nativeSessionId,
      hostId: receipt.hostId,
      href,
      embedHref,
    });
  }
  return links;
}

/** Direct Agent Herder link stays available; review may open the same chat beside the task, like LHC. */
export function TaskSessionLink({ card, compact = false }: { card: KanbanCard; compact?: boolean }) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  useEffect(() => { setPanelOpen(false); setSelectedKey(null); }, [card.id]);
  const sessions = linkedTaskSessions(card);
  const selected = sessions.find(session => session.key === selectedKey) ?? sessions[0];
  const latestReceipt = card.taskExecutionHistory?.at(-1);
  if (!selected && compact) return null;
  if (!selected && !latestReceipt) return null;

  const label = selected
    ? HARNESS_LABELS[selected.harness as keyof typeof HARNESS_LABELS] ?? selected.harness
    : latestReceipt?.harness ?? 'ИИ';
  return (
    <div aria-label="Связь с Agent Herder" className={compact
      ? 'mt-2 flex flex-wrap items-center gap-1.5 text-[11px]'
      : 'flex flex-wrap items-center gap-2 rounded-md border bg-background/60 px-2.5 py-2 text-xs'}>
      <span className="text-muted-foreground">
        Agent Herder · {label}{compact || !selected ? '' : ' · ' + selected.hostId}
      </span>
      {selected ? (
        <>
          <a href={selected.href} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-medium text-primary underline underline-offset-2 hover:opacity-80"
            aria-label={'Открыть сессию ' + selected.harness + ' ' + selected.sessionId + ' в Agent Herder'}
            onPointerDown={event => event.stopPropagation()}
            onPointerUp={event => event.stopPropagation()}
            onClick={event => event.stopPropagation()}
            onKeyDown={event => event.stopPropagation()}>
            Открыть сессию <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
          </a>
          {!compact && <button type="button"
            className="rounded border px-2 py-1 font-medium hover:bg-muted"
            onClick={() => setPanelOpen(true)}>
            Показать рядом
          </button>}
          {!compact && sessions.length > 1 && <details className="w-full text-xs">
            <summary className="cursor-pointer">Другие сессии задачи ({sessions.length - 1})</summary>
            <div className="mt-2 flex flex-col gap-2">
              {sessions.slice(1).map(session => <a key={session.key} href={session.href}
                target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                {session.harness} · {session.sessionId} <ArrowUpRight aria-hidden="true" className="inline h-3 w-3" />
              </a>)}
            </div>
          </details>}
        </>
      ) : <span className="text-muted-foreground">
        {latestReceipt?.nativeSessionId ? 'Нет проверенного адреса сессии' : 'Сессия пока не подтверждена'}
      </span>}
      {panelOpen && selected && !compact && (
        <aside role="dialog" aria-label="Сессия исполнителя в Agent Herder"
          className="fixed inset-y-0 left-0 z-[80] flex w-full min-w-0 flex-col border-r bg-background shadow-2xl lg:w-[58vw]"
          onClick={event => event.stopPropagation()}>
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2 text-sm">
            <strong className="mr-auto">Agent Herder</strong>
            {sessions.length > 1 && <select aria-label="Сессия исполнителя" value={selected.key}
              onChange={event => setSelectedKey(event.target.value)}
              className="max-w-[11rem] rounded border bg-background px-2 py-1">
              {sessions.map((session, i) => <option key={session.key} value={session.key}>
                {i === 0 ? 'Последняя · ' : ''}{session.harness}: {session.sessionId}
              </option>)}
            </select>}
            <a href={selected.href} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 underline underline-offset-2">
              Открыть отдельно <ArrowUpRight aria-hidden="true" className="h-3 w-3" />
            </a>
            <button type="button" onClick={() => setPanelOpen(false)} aria-label="Закрыть Agent Herder"
              className="rounded p-2 hover:bg-muted">
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <iframe key={selected.key} src={selected.embedHref}
            title="Рабочая сессия Agent Herder" referrerPolicy="no-referrer"
            className="min-h-0 w-full flex-1 border-0" />
        </aside>
      )}
    </div>
  );
}
