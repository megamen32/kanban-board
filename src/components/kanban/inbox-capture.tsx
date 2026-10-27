'use client';

import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Send, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { mutationErrorMessage, readMutationResponse, BoardMutationError } from '../../lib/kanban/mutation-response';

export function InboxCapture({ owner, onCaptured }: { owner: string; onCaptured: () => void }) {
  const [text, setText] = useState('');
  const [audio, setAudio] = useState<File | null>(null);
  const [status, setStatus] = useState('');
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const busy = useRef(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<BlobPart[]>([]);

  useEffect(() => () => {
    recorder.current?.stop();
    stream.current?.getTracks().forEach(track => track.stop());
  }, []);

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setStatus('Этот браузер не поддерживает запись с микрофона. Можно выбрать аудиофайл.');
      return;
    }
    try {
      const currentStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = currentStream;
      chunks.current = [];
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : undefined;
      const currentRecorder = new MediaRecorder(currentStream, mimeType ? { mimeType } : undefined);
      recorder.current = currentRecorder;
      currentRecorder.ondataavailable = event => { if (event.data.size) chunks.current.push(event.data); };
      currentRecorder.onerror = () => setStatus('Запись прервалась. Проверь разрешение на микрофон и попробуй ещё раз.');
      currentRecorder.onstop = () => {
        const blob = new Blob(chunks.current, { type: currentRecorder.mimeType || 'audio/webm' });
        stream.current?.getTracks().forEach(track => track.stop());
        stream.current = null;
        setRecording(false);
        if (blob.size === 0) {
          setAudio(null);
          setStatus('Запись пустая. Попробуй ещё раз.');
          return;
        }
        const extension = blob.type.includes('mp4') ? 'm4a' : 'webm';
        setAudio(new File([blob], `voice-task.${extension}`, { type: blob.type }));
        setText('');
        setStatus('Запись готова. Расшифруй её, проверь текст и только потом добавь задачу.');
      };
      currentRecorder.start();
      setText('');
      setAudio(null);
      setStatus('Записываю… Нажми «Остановить запись», когда закончишь.');
      setRecording(true);
    } catch (failure) {
      const name = failure instanceof DOMException ? failure.name : '';
      setStatus(name === 'NotAllowedError' || name === 'PermissionDeniedError'
        ? 'Микрофон запрещён. Разреши его для этой страницы в браузере.'
        : 'Не удалось включить микрофон. Проверь подключение и разрешение в браузере.');
    }
  };

  const stopRecording = () => {
    if (recorder.current?.state === 'recording') recorder.current.stop();
  };

  const transcribe = async () => {
    if (!audio || busy.current) return;
    busy.current = true;
    setTranscribing(true);
    setStatus('Расшифровываю…');
    try {
      const form = new FormData();
      form.set('action', 'transcribe');
      form.set('audio', audio);
      const reply = await readMutationResponse(await fetch('/api/kanban/inbox-capture', { method: 'POST', body: form }));
      if (!reply.text?.trim()) throw new BoardMutationError('Расшифровка не вернула текст. Запись осталась в форме.');
      setText(reply.text.trim());
      setAudio(null);
      setStatus('Проверь и поправь текст. Задача ещё не сохранена.');
    } catch (failure) {
      setStatus(mutationErrorMessage(failure));
    } finally {
      busy.current = false;
      setTranscribing(false);
    }
  };

  const send = async () => {
    if (busy.current || !text.trim()) return;
    busy.current = true;
    setSending(true);
    setStatus('');
    try {
      const response = await fetch('/api/kanban/inbox-capture', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, owner }),
      });
      const data = await readMutationResponse(response);
      if (!data.cards?.length) throw new BoardMutationError('Запись не подтверждена. Исходный текст остался в форме.');
      setText('');
      setAudio(null);
      setStatus('Сохранено во входящих');
      onCaptured();
    } catch (failure) {
      setStatus(mutationErrorMessage(failure));
    } finally {
      busy.current = false;
      setSending(false);
    }
  };

  return <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
    <div className="flex items-center gap-2 text-sm font-medium"><Mic className="h-4 w-4" />Добавить задачу во входящие</div>
    <Textarea value={text} onChange={event => { setText(event.target.value); setAudio(null); }} placeholder="Расскажи задачу своими словами. Срок или приоритет можно уточнить позже." rows={3} />
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant={recording ? 'destructive' : 'outline'} disabled={sending || transcribing} onClick={() => recording ? stopRecording() : void startRecording()}>
        {recording ? <MicOff className="mr-2 h-4 w-4" /> : <Mic className="mr-2 h-4 w-4" />}
        {recording ? 'Остановить запись' : 'Записать голосом'}
      </Button>
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent">
        <Upload className="h-4 w-4" />Выбрать аудио
        <input className="sr-only" aria-label="Аудиофайл для транскрипции" type="file" accept="audio/*" disabled={sending || transcribing || recording} onChange={event => { setAudio(event.target.files?.[0] ?? null); setText(''); }} />
      </label>
      {audio && <Button type="button" size="sm" variant="secondary" disabled={sending || transcribing} onClick={() => void transcribe()}>{transcribing ? 'Расшифровываю…' : `Расшифровать ${audio.name}`}</Button>}
      <Button type="button" size="sm" onClick={() => void send()} disabled={sending || transcribing || !text.trim()}><Send className="mr-2 h-4 w-4" />{sending ? 'Сохраняю…' : 'Добавить во входящие'}</Button>
      {status && <span role="status" className="min-w-0 text-xs text-muted-foreground">{status}</span>}
    </div>
  </div>;
}
