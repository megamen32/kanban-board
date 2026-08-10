# Live-доска всё ещё просит пароль

## Original request

Пользователь прислал скриншот `excode.bezrabotnyi.com`, на котором после исправления всё ещё отображается форма «Вход в Kanban» с паролем и кодом 2FA.

## Objective

Понять, почему live-домен не показывает уже исправленную публичную доску, и довести live business canary до состояния без пароля после отдельного подтверждения production action.

## Business canary

На `https://excode.bezrabotnyi.com/` обычный браузер получает доску без формы входа; `/api/kanban/cards` отвечает без cookie; ChatGPT OAuth без сессии остаётся login-gated.

## Confirmed scope

- Read-only сопоставить live HTTP с локальным commit `23e7734`.
- Найти текущий release/deploy boundary.
- После явного подтверждения пользователя выполнить только необходимый deploy/restart и повторить live canary.

## Explicit exclusions

- Не менять auth-код повторно без evidence.
- Не менять production secrets, данные, OAuth scopes или пользователей.
- Не выполнять deploy/restart до отдельного подтверждения.

## Estimate (immutable initial)

- Optimistic: 10 active minutes
- Likely: 20 active minutes
- Pessimistic: 40 active minutes

## Initial plan (по-русски)

1. Проверить live HTTP и локальный commit read-only.
2. Определить, что именно не доставлено: push, image, compose или restart.
3. Показать точную consequential boundary и запросить подтверждение.

## Pre-deployment status

Production was untouched during the initial read-only diagnosis.

## Progress

- Local source and commit `23e773493877cd9798f30882074c439b30b59630` contain the public board fix; `page.tsx` no longer imports `AuthGate`, and Kanban routes use `boardIdentityFromRequest`.
- Live read-only canary: `https://excode.bezrabotnyi.com/api/kanban/cards` returns `401` without a cookie; the screenshot is consistent with the old deployed build.
- At the initial read-only stage, local `main` was ahead of `origin/main` by commit `23e7734`; publishing and applying the build required explicit user confirmation.

## Deployment evidence

- User confirmed the push/deploy action.
- `git push origin main` succeeded: `main -> main` at `23e7734`.
- Nginx mapping was read-only verified as `excode.bezrabotnyi.com -> 127.0.0.1:43328`; only `excode-kanban-1` was rebuilt/recreated.
- Preserved rollback image tag: `local/kanban-board:rollback-20260810T203424Z`.
- `docker compose -f docker-compose.deploy.yml up -d --build kanban` succeeded; compose state is `running`.
- Live HTTP canary passed: `/` 200, `/api/kanban/cards` 200 with a `cards` array, and BrowserOS snapshot showed the Kanban board with 18 tasks and no login form.
- `/api/auth/session` remains 401 without a session. OAuth source/login gate was not changed, but live OAuth cannot be fully exercised because configured redirect URI count is zero; recorded as a separate todo without changing secrets.
- Nginx reload was not performed because the vhost was unchanged; unprivileged `nginx -t` was blocked by permission denied.

## Status

Complete for the requested public-board deployment; OAuth redirect configuration remains an explicit external blocker.
