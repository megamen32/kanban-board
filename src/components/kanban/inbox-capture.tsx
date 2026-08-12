'use client';

import { useState } from 'react';
import { Mic, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export function InboxCapture({ owner, onCaptured }: { owner: string; onCaptured: () => void }) {
  const [text, setText] = useState('');
  const [audio, setAudio] = useState<File | null>(null);
  const [status, setStatus] = useState('');
  const send = async () => {
    setStatus('');
    const response = audio
      ? await fetch('/api/kanban/inbox-capture', { method: 'POST', body: (() => { const form = new FormData(); form.set('audio', audio); form.set('owner', owner); return form; })() })
      : await fetch('/api/kanban/inbox-capture', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, owner }) });
    const data = await response.json();
    if (!response.ok) { setStatus(data.error || 'Не получилось добавить'); return; }
    setText(''); setAudio(null); setStatus('В Inbox'); onCaptured();
  };
  return <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
    <div className="flex items-center gap-2 text-sm font-medium"><Mic className="h-4 w-4" />Выгрузить в Inbox</div>
    <Textarea value={text} onChange={event => { setText(event.target.value); setAudio(null); }} placeholder="Вставь расшифровку — разберём потом" rows={3} />
    <div className="flex flex-wrap items-center gap-2"><input aria-label="Аудиофайл для транскрипции" type="file" accept="audio/*" onChange={event => { setAudio(event.target.files?.[0] ?? null); setText(''); }} /><Button size="sm" onClick={() => void send()} disabled={!text.trim() && !audio}><Send className="mr-2 h-4 w-4" />{audio ? 'Расшифровать' : 'В Inbox'}</Button>{status && <span className="text-xs text-muted-foreground">{status}</span>}</div>
  </div>;
}
