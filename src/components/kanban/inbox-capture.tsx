'use client';

import { useRef, useState } from 'react';
import { Mic, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { mutationErrorMessage, readMutationResponse, BoardMutationError } from '../../lib/kanban/mutation-response';

export function InboxCapture({ owner, onCaptured }: { owner: string; onCaptured: () => void }) {
  const [text, setText] = useState('');
  const [audio, setAudio] = useState<File | null>(null);
  const [status, setStatus] = useState('');
  const [sending, setSending] = useState(false);
  const busy = useRef(false);
  const send = async () => {
    if (busy.current) return;
    busy.current = true; setSending(true);
    setStatus('');
    try {
    const response = audio
      ? await fetch('/api/kanban/inbox-capture', { method: 'POST', body: (() => { const form = new FormData(); form.set('audio', audio); form.set('owner', owner); return form; })() })
      : await fetch('/api/kanban/inbox-capture', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, owner }) });
    const data = await readMutationResponse(response);
    if (!data.cards?.length) throw new BoardMutationError('Запись не подтверждена. Исходный текст остался в форме.');
    setText(''); setAudio(null); setStatus('Сохранено во Входящих'); onCaptured();
    } catch (failure) { setStatus(mutationErrorMessage(failure)); }
    finally { busy.current = false; setSending(false); }
  };
  return <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
    <div className="flex items-center gap-2 text-sm font-medium"><Mic className="h-4 w-4" />Добавить задачу во входящие</div>
    <Textarea value={text} onChange={event => { setText(event.target.value); setAudio(null); }} placeholder="Опишите задачу или вставьте расшифровку — приоритет уточним позже" rows={3} />
    <div className="flex flex-wrap items-center gap-2"><input aria-label="Аудиофайл для транскрипции" type="file" accept="audio/*" disabled={sending} onChange={event => { setAudio(event.target.files?.[0] ?? null); setText(''); }} /><Button size="sm" onClick={() => void send()} disabled={sending || (!text.trim() && !audio)}><Send className="mr-2 h-4 w-4" />{sending ? 'Сохраняем…' : audio ? 'Расшифровать' : 'Добавить во входящие'}</Button>{status && <span role="status" className="text-xs text-muted-foreground">{status}</span>}</div>
  </div>;
}
