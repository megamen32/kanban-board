'use client';

import { useState } from 'react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import type { KanbanCard } from '../../lib/kanban/types';

/** The server accepts a recovery decision only from the board owner. */
export const REVIEW_RECOVERY_OWNER = 'nikita';

interface RecoveryRequest {
  action: 'recover-rework';
  note: string;
  expectedVersion: number;
}

/**
 * A card is stuck when the review gate has nobody to decide: it waits for a
 * review, but no approver and no result exist, so ordinary status controls
 * stay disabled and the card can never leave the gate on its own.
 */
export function isOwnerRecoveryCandidate(card: KanbanCard, username: string | null | undefined): boolean {
  if (username !== REVIEW_RECOVERY_OWNER) return false;
  if (card.needsReview !== true) return false;
  if (card.column === 'review') return false;
  if ((card.requiresApprovalFrom?.length ?? 0) > 0) return false;
  if ((card.resultHistory?.length ?? 0) > 0) return false;
  return true;
}

/** A recovery needs a note, so the owner says what has to be fixed. */
export function canSubmitRecovery(note: string): boolean {
  return note.trim().length > 0;
}

/** The explicit owner decision: a note and the version that guards the write. */
export function buildRecoveryRequest(card: KanbanCard, note: string): RecoveryRequest {
  return { action: 'recover-rework', note: note.trim(), expectedVersion: card.version };
}

interface Props {
  card: KanbanCard;
  username: string | null | undefined;
  onDone?: () => void | Promise<void>;
}

/**
 * Owner-only recovery for a card stuck in an empty review gate.
 *
 * The control only offers the rework path: there is no accept and no automatic
 * approval here, and the server decides the outcome from the verified session,
 * the note and the expected version.
 */
export function ReviewRecoveryControl({ card, username, onDone }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  if (!isOwnerRecoveryCandidate(card, username)) return null;

  const submit = async () => {
    const body = buildRecoveryRequest(card, note);
    if (!canSubmitRecovery(body.note)) {
      setFailed(true);
      setMessage('Укажите, что нужно исправить.');
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/kanban/cards/${encodeURIComponent(card.id)}/review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => null);
      if (response.ok) {
        setFailed(false);
        setMessage('Задача возвращена на доработку.');
        setNote('');
        setExpanded(false);
        await onDone?.();
        return;
      }
      setFailed(true);
      if (response.status === 409) {
        setMessage('Карточка уже изменилась. Обновите доску и повторите.');
        await onDone?.();
        return;
      }
      if (response.status === 403) {
        setMessage('Вернуть задачу на доработку может только владелец.');
        return;
      }
      if (response.status === 401) {
        setMessage('Войдите под учёткой владельца задачи.');
        return;
      }
      setMessage(typeof data?.error === 'string' ? data.error : 'Не удалось вернуть задачу на доработку.');
    } catch {
      setFailed(true);
      setMessage('Не удалось вернуть задачу на доработку.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2"
      onClick={event => event.stopPropagation()}
    >
      {!expanded ? (
        <>
          <p className="text-xs text-muted-foreground">
            Приёмка заблокирована: у задачи нет назначенного проверяющего. Владелец может вернуть её на доработку с комментарием.
          </p>
          <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setExpanded(true)}>
            Вернуть на доработку
          </Button>
        </>
      ) : (
        <>
          <Textarea
            aria-label="Что нужно исправить"
            placeholder="Что нужно исправить"
            value={note}
            onChange={event => setNote(event.target.value)}
            rows={2}
            className="mt-2"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={saving || !canSubmitRecovery(note)} onClick={() => void submit()}>
              Вернуть на доработку
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => { setExpanded(false); setMessage(null); }}>
              Отмена
            </Button>
            {message && (
              <p role={failed ? 'alert' : 'status'} className="text-xs text-muted-foreground">{message}</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
