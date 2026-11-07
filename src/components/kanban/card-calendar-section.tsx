'use client';

import { Button } from '@/components/ui/button';

export type CalendarBridgeStatus = {
  enabled: boolean;
  connected: boolean;
  /** Project names with an explicit calendar mapping (names only, no ids). */
  projects?: string[];
  publicUrl?: string | null;
  storeUnavailable?: boolean;
};

export interface CardCalendarSectionProps {
  /** The card's saved due date; the section only exists with one. */
  dueAt?: string | null;
  /** The card's existing board project; routes the event via the user's own mapping. */
  project?: string;
  /** null while the status request is in flight. */
  status: CalendarBridgeStatus | 'unavailable' | null;
  durationMinutes: number;
  onDurationChange: (minutes: number) => void;
  onSync: () => void;
  syncing?: boolean;
  /** The calling user's own synced event, if any. Never another user's. */
  eventId?: string | null;
  message?: string | null;
  /** The edited due date differs from the saved one: the section must say so. */
  dueAtUnsaved?: boolean;
  className?: string;
}

const DURATION_OPTIONS = [15, 30, 60, 90, 120];

/**
 * The «В календарь» section of the card dialog. The UI never holds calendar
 * credentials and never invents a connected account: until the bridge is
 * enabled AND this user's account is connected, the action stays disabled
 * with an honest label and a link to Keeper.
 */
export function CardCalendarSection({ dueAt, project, status, durationMinutes, onDurationChange, onSync, syncing = false, eventId, message, dueAtUnsaved = false, className }: CardCalendarSectionProps) {
  if (!dueAt) return null;

  const unavailable = status === 'unavailable' || (status !== null && (!status.enabled || status.storeUnavailable === true));
  const notConnected = !unavailable && status !== null && !status.connected;
  const actionReady = !unavailable && status !== null && status.connected && !syncing;
  const projectMapped = !unavailable && status !== null && !!project && (status.projects ?? []).includes(project);
  const label = unavailable
    ? 'Календарь недоступен'
    : status === null
      ? 'Проверяем календарь…'
      : notConnected
        ? 'Календарь не подключён'
        : syncing
          ? 'Синхронизация…'
          : 'В календарь';

  return (
    <div className={className} aria-label="Календарь" data-testid="card-calendar-section">
      <p className="text-xs font-medium text-muted-foreground">Календарь Keeper</p>
      <div className="flex flex-wrap items-center gap-2">
        {project && (
          <span className="text-xs text-muted-foreground" data-testid="calendar-project">
            Проект: {project}
            {projectMapped && <span className="ml-1 rounded bg-muted px-1" title="Проект направлен в отдельный календарь этого аккаунта">свой календарь</span>}
          </span>
        )}
        <label className="text-xs text-muted-foreground">Длительность
          <select
            aria-label="Длительность события"
            className="ml-1 rounded-md border bg-transparent px-2 py-1 text-xs"
            value={durationMinutes}
            onChange={event => onDurationChange(Number(event.target.value))}
          >
            {DURATION_OPTIONS.map(minutes => <option key={minutes} value={minutes}>{minutes} мин</option>)}
          </select>
        </label>
        <Button type="button" variant="outline" disabled={!actionReady} onClick={onSync}>{label}</Button>
        {status !== null && status !== 'unavailable' && status.publicUrl && (
          <a href={status.publicUrl} target="_blank" rel="noreferrer" className="text-xs underline text-muted-foreground">Открыть Keeper</a>
        )}
        {eventId && <span className="text-xs text-muted-foreground">Событие создано в вашем календаре</span>}
        {message && <span className="text-xs text-red-600" role="alert">{message}</span>}
      </div>
      {dueAtUnsaved && (
        <p className="text-xs text-amber-600" role="note">
          Срок изменён, но карточка не сохранена — в календарь уйдёт сохранённый срок. Сначала сохраните карточку.
        </p>
      )}
      {notConnected && (
        <p className="text-xs text-muted-foreground">
          Личный календарь Keeper ещё не подключён к вашему аккаунту — действие станет доступным после подключения.
        </p>
      )}
      {unavailable && (
        <p className="text-xs text-muted-foreground">Интеграция с календарём сейчас недоступна.</p>
      )}
    </div>
  );
}
