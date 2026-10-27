'use client';

import { FormEvent, ReactNode, useEffect, useState } from 'react';

export type UnauthenticatedAuthMode = 'loopback-preview' | 'verified-login-required';

export function unauthenticatedAuthMode(hostname: string): UnauthenticatedAuthMode {
  const host = hostname.toLowerCase();
  if (host === '127.0.0.1' || host === '::1' || host === '[::1]' || host === 'localhost') return 'loopback-preview';
  return 'verified-login-required';
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [error, setError] = useState('');
  const [redirectingToAirlock, setRedirectingToAirlock] = useState(false);

  useEffect(() => {
    fetch('/api/auth/session')
      .then(async (response) => {
        if (response.ok) {
          setAuthenticated(true);
          return;
        }
        const mode = unauthenticatedAuthMode(window.location.hostname);
        if (mode === 'loopback-preview') {
          // The QA endpoint itself only serves its isolated read-only loopback store.
          setAuthenticated(true);
          return;
        }
        if (response.status === 401) {
          const relay = await fetch('/api/auth/airlock/status', { cache: 'no-store' }).catch(() => null);
          if (relay?.status === 204) {
            setRedirectingToAirlock(true);
            window.location.replace('/api/auth/airlock/login?next=%2F');
            return;
          }
        }
        setAuthenticated(false);
      })
      .catch(() => setAuthenticated(false))
      .finally(() => setChecking(false));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: form.get('username'), password: form.get('password'), totp: form.get('totp') }),
    });
    if (!response.ok) {
      setError('Неверные учётные данные или код 2FA');
      return;
    }
    setAuthenticated(true);
  }

  if (checking || redirectingToAirlock) return <main aria-live="polite" className="grid min-h-screen place-items-center">{redirectingToAirlock ? 'Входим через Airlock…' : 'Проверяем вход…'}</main>;
  if (authenticated) return <>{children}</>;
  return (
    <main className="grid min-h-screen place-items-center bg-background p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-xl border bg-card p-6 shadow-sm">
        <div><h1 className="text-xl font-semibold">Вход в Kanban</h1><p className="text-sm text-muted-foreground">Для входа нужны пароль и код 2FA.</p></div>
        <label className="block text-sm">Пользователь<input name="username" required autoComplete="username" className="mt-1 w-full rounded-md border bg-background p-2" /></label>
        <label className="block text-sm">Пароль<input name="password" type="password" required autoComplete="current-password" className="mt-1 w-full rounded-md border bg-background p-2" /></label>
        <label className="block text-sm">Код 2FA<input name="totp" inputMode="numeric" pattern="[0-9]{6}" required autoComplete="one-time-code" className="mt-1 w-full rounded-md border bg-background p-2" /></label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <button type="submit" className="w-full rounded-md bg-primary px-4 py-2 text-primary-foreground">Войти</button>
      </form>
    </main>
  );
}
