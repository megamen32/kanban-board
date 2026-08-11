'use client';

import { useEffect, useState } from 'react';
import { Bell, BellOff, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { unsubscribeAfterServerDeletion } from '@/lib/notifications/client';

type NotificationState = 'loading' | 'disabled' | 'off' | 'on' | 'error';

function urlBase64ToArrayBuffer(value: string): ArrayBuffer {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map(character => character.charCodeAt(0))).buffer as ArrayBuffer;
}

export function NotificationSettings() {
  const [state, setState] = useState<NotificationState>('loading');
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setState('disabled');
      return () => { cancelled = true; };
    }
    void Promise.all([
      fetch('/api/notifications/public-key').then(response => response.json().then(body => ({ ok: response.ok, body }))),
      fetch('/api/notifications/subscription').then(response => response.json()),
    ]).then(([keyResult, status]) => {
      if (cancelled) return;
      if (!keyResult.ok || !keyResult.body.publicKey) {
        setState('disabled');
        return;
      }
      setPublicKey(keyResult.body.publicKey);
      setState(status.subscribed ? 'on' : 'off');
    }).catch(() => {
      if (!cancelled) setState('error');
    });
    return () => { cancelled = true; };
  }, []);

  const enable = async () => {
    if (!publicKey) return;
    setMessage('');
    setState('loading');
    try {
      const permission = Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission();
      if (permission !== 'granted') {
        setState('off');
        setMessage('Разрешение не выдано');
        return;
      }
      await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      const ready = await navigator.serviceWorker.ready;
      const subscription = await ready.pushManager.getSubscription()
        || await ready.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToArrayBuffer(publicKey) });
      const response = await fetch('/api/notifications/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });
      if (!response.ok) throw new Error((await response.json()).error || 'Не удалось включить уведомления');
      setState('on');
      setMessage('Уведомления включены');
    } catch (error) {
      setState('error');
      setMessage(error instanceof Error ? error.message : 'Не удалось включить уведомления');
    }
  };

  const disable = async () => {
    setMessage('');
    setState('loading');
    try {
      const registration = await navigator.serviceWorker.getRegistration('/');
      const subscription = await registration?.pushManager.getSubscription();
      await unsubscribeAfterServerDeletion(subscription ?? null, endpoint => fetch('/api/notifications/subscription', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(endpoint ? { endpoint } : {}),
      }));
      setState('off');
      setMessage('Уведомления выключены');
    } catch {
      setState('error');
      setMessage('Не удалось выключить уведомления');
    }
  };

  const sendTest = async () => {
    setMessage('Отправляю…');
    const response = await fetch('/api/notifications/test', { method: 'POST' });
    const result = await response.json();
    setMessage(result.ok ? 'Тест отправлен' : 'Push пока недоступен');
  };

  if (state === 'disabled') return null;
  const enabled = state === 'on';
  const loading = state === 'loading';

  return (
    <div className="flex items-center gap-1 min-w-fit">
      <Button
        variant={enabled ? 'secondary' : 'ghost'}
        size="sm"
        className="h-8 px-2 text-xs"
        onClick={enabled ? disable : enable}
        disabled={loading}
        aria-label={enabled ? 'Выключить уведомления' : 'Включить уведомления'}
        title={enabled ? 'Выключить уведомления' : 'Включить уведомления'}
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : enabled ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
        <span className="hidden sm:inline ml-1">{enabled ? 'Push включён' : 'Включить push'}</span>
      </Button>
      {enabled && (
        <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={sendTest} title="Отправить тестовое уведомление" aria-label="Отправить тестовое уведомление">
          <Check className="h-3.5 w-3.5" />
          <span className="hidden sm:inline ml-1">Проверить</span>
        </Button>
      )}
      {message && <span className="text-[10px] text-muted-foreground whitespace-nowrap">{message}</span>}
    </div>
  );
}
