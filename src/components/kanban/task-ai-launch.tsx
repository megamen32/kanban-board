'use client';

import { useEffect, useRef, useState } from 'react';
import type { KanbanCard } from '@/lib/kanban/types';
import { executionOperationStorageKey, executionStartRequest, parseExecutionSnapshot, parseNativeTargetPreview, type NativeTargetPreview } from './integrator-dashboard-model';

export async function sendTaskAiStart(
  card: Pick<KanbanCard, 'id' | 'version'>, target: NativeTargetPreview,
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  send: (url: string, init: RequestInit) => Promise<Response>, makeId: () => string,
): Promise<'accepted' | 'existing' | 'not-sent' | 'unknown'> {
  const key = executionOperationStorageKey(card.id);
  let operation: { operationId: string; status: string; targetPreviewId: string };
  try {
    if (storage.getItem(key)) return 'existing';
    operation = { operationId: makeId(), status: 'pending', targetPreviewId: target.previewId };
    storage.setItem(key, JSON.stringify(operation));
  } catch { return 'not-sent'; }
  try {
    const response = await send(`/api/kanban/cards/${encodeURIComponent(card.id)}/execution`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(executionStartRequest(card.version, operation.operationId, undefined, target.previewId)),
    });
    try { storage.setItem(key, JSON.stringify({ ...operation, status: response.ok ? 'admitted' : 'unknown' })); } catch { /* pending key remains */ }
    return response.ok ? 'accepted' : 'unknown';
  } catch { return 'unknown'; }
}

/** One explicit launch, bound to the server-selected route and a durable browser key. */
export function TaskAiLaunch({ card, onRefresh }: { card: KanbanCard; onRefresh: () => Promise<unknown> | void }) {
  const [target, setTarget] = useState<NativeTargetPreview | null>(null);
  const [available, setAvailable] = useState(false);
  const [message, setMessage] = useState('Проверяем маршрут…');
  const [busy, setBusy] = useState(false);
  const marker = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    let started = false;
    async function load() {
      if (started) return;
      started = true;
      try {
        const key = executionOperationStorageKey(card.id);
        if (window.localStorage.getItem(key)) { setMessage('Запуск уже был запрошен. Откройте задачу, чтобы проверить состояние.'); return; }
        const endpoint = `/api/kanban/cards/${encodeURIComponent(card.id)}/execution`;
        const [route, state] = await Promise.all([
          fetch(`${endpoint}?target=preview`, { cache: 'no-store', signal: controller.signal }),
          fetch(endpoint, { cache: 'no-store', signal: controller.signal }),
        ]);
        const preview = route.ok ? parseNativeTargetPreview(await route.json()) : null;
        const snapshot = state.ok ? parseExecutionSnapshot(await state.json(), card.id) : null;
        if (!preview || preview.cardVersion !== card.version || !snapshot) throw new Error('unavailable');
        setTarget(preview);
        setAvailable(preview.selectable && snapshot.startAvailable === true);
        setMessage(preview.selectable && snapshot.startAvailable === true ? '' : (snapshot.unavailableReason || preview.reason || 'Запуск сейчас недоступен'));
      } catch { if (!controller.signal.aborted) setMessage('Маршрут запуска не удалось проверить.'); }
    }
    const node = marker.current;
    if (!node || typeof IntersectionObserver === 'undefined') { void load(); return () => controller.abort(); }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) void load(); }, { rootMargin: '100px' });
    observer.observe(node);
    return () => { observer.disconnect(); controller.abort(); };
  }, [card.id, card.version]);

  async function start() {
    if (inFlight.current || busy || !available || !target || target.cardVersion !== card.version) return;
    inFlight.current = true;
    setBusy(true);
    try {
      setAvailable(false);
      const result = await sendTaskAiStart(card, target, window.localStorage, fetch, () => window.crypto.randomUUID());
      setMessage(result === 'accepted' ? 'Запуск принят. Состояние появится после подтверждения.'
        : result === 'existing' ? 'Запуск уже запрошен. Проверьте состояние задачи.'
          : result === 'not-sent' ? 'Не удалось подготовить запуск. Запрос не отправлен.' : 'Исход запуска не подтверждён. Повтор не отправлен.');
      await Promise.resolve(onRefresh()).catch(() => undefined);
    } catch { setAvailable(false); setMessage('Не удалось подтвердить запуск. Проверьте состояние перед повтором.'); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <div ref={marker} className="mt-2 text-xs" onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    {target && <p className="text-muted-foreground">{target.harness} / {target.model}<br />{target.hostId}</p>}
    {message && <p role="status" className="mt-1 text-muted-foreground">{message}</p>}
    <button type="button" disabled={!available || busy} onClick={() => void start()} className="mt-1 rounded-md bg-primary px-3 py-1.5 font-semibold text-primary-foreground disabled:opacity-50">{busy ? 'Запускаю…' : 'Запустить AI'}</button>
  </div>;
}
