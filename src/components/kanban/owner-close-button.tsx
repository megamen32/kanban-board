'use client';

import { useEffect, useRef, useState } from 'react';
import type { KanbanCard } from '@/lib/kanban/types';
import { canOwnerClose } from '@/lib/kanban/owner-close';
import { boardMutationRequest, mutationErrorMessage, readMutationResponse } from '@/lib/kanban/mutation-response';
import { Button } from '@/components/ui/button';

export function OwnerCloseButton({card, username, disabled, onSaved}: {
  card: KanbanCard; username?: string | null; disabled?: boolean; onSaved: (card: KanbanCard) => void;
}) {
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!canOwnerClose(card, username)) return null;
  async function close() {
    if (inFlight.current || disabled) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const response = await boardMutationRequest(`/api/kanban/cards/${encodeURIComponent(card.id)}/close`, {
        method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({expectedVersion: card.version}),
      }, 'review');
      const data = await readMutationResponse(response, true, 'review');
      if (!mounted.current) return;
      if (data.conflict || !data.card || data.card.column !== 'done') {
        setError('Карточка изменилась. Обновите её перед закрытием.'); return;
      }
      onSaved(data.card);
    } catch (failure) { if (mounted.current) setError(mutationErrorMessage(failure)); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  return <div className="space-y-1">
    <Button type="button" disabled={busy || disabled} onClick={() => void close()}>
      {busy ? 'Закрываю…' : 'Закрыть без проверки'}
    </Button>
    <p className="text-xs text-muted-foreground">Решение владельца. Доказательства не обязательны. История и работающие сессии сохраняются.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}
