'use client';

import { useEffect, useState } from 'react';
import { createCardDialogActionScope } from './card-dialog-action-scope';
import type { KanbanCard } from '@/lib/kanban/types';
import { parseManualVerification } from '@/lib/kanban/manual-verification';
import { boardMutationRequest, mutationErrorMessage, readMutationResponse } from '@/lib/kanban/mutation-response';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function ResultVerification({card, onSaved, onCancel}: {
  card: KanbanCard; onSaved: (saved: KanbanCard) => void; onCancel: () => void;
}) {
  // Bind the human's check to the version opened, even when a remote update arrives.
  const [version] = useState(card.version);
  const [result, setResult] = useState('');
  const [evidence, setEvidence] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [actionScope] = useState(createCardDialogActionScope);
  useEffect(() => {
    actionScope.enter();
    return () => actionScope.leave();
  }, [card.id, actionScope]);
  const input = {expectedVersion: version, confirmed, result, evidence};
  const valid = !!parseManualVerification(input) && card.version === version;
  async function save() {
    if (busy || !valid) return;
    const isCurrent = actionScope.capture();
    setBusy(true); setError('');
    try {
      const response = await boardMutationRequest(`/api/kanban/cards/${encodeURIComponent(card.id)}/verify`, {
        method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(input),
      }, 'review');
      const data = await readMutationResponse(response, true, 'review');
      if (!isCurrent()) return;
      if (data.conflict || !data.card || data.card.column !== 'done') {
        setConfirmed(false); setError('Карточка изменилась. Обновите её и проверьте новый результат перед приёмкой.'); return;
      }
      onSaved(data.card);
    } catch (failure) { if (isCurrent()) { setConfirmed(false); setError(mutationErrorMessage(failure)); } }
    finally { if (isCurrent()) setBusy(false); }
  }
  return <Dialog open onOpenChange={open => {if (!open && !busy) onCancel();}}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl" onEscapeKeyDown={event => {if (busy) event.preventDefault();}} onPointerDownOutside={event => event.preventDefault()}>
    <DialogHeader><DialogTitle>Проверка результата</DialogTitle>
      <DialogDescription>Убедитесь, что цель выполнена. Проверка будет записана от вашего имени для версии {version}.</DialogDescription>
    </DialogHeader>
    <section className="space-y-3">
    <label className="block space-y-1 text-sm">Что проверено и сделано
      <Textarea value={result} onChange={event => {setResult(event.target.value); setConfirmed(false);}} maxLength={4000} rows={3} placeholder="Какой результат вы проверили" />
    </label>
    <label className="block space-y-1 text-sm">Доказательство
      <Textarea value={evidence} onChange={event => {setEvidence(event.target.value); setConfirmed(false);}} maxLength={4000} rows={2} placeholder="Ссылка, файл, команда и её вывод или описание выполненной проверки" />
    </label>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 accent-primary" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />Я лично проверил результат и подтверждаю завершение.</label>
    {card.version !== version && <p role="alert" className="text-sm text-destructive">Версия изменилась. Закройте проверку, обновите карточку и откройте её заново.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex flex-wrap gap-2"><Button type="button" disabled={!valid || busy} onClick={() => void save()}>{busy ? 'Сохраняю проверку…' : 'Подтвердить и завершить'}</Button><Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Отмена</Button></div>
  </section></DialogContent></Dialog>;
}
