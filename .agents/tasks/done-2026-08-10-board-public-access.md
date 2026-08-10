# Доска: публичный доступ без пароля

## Original request

> Доска почему-то стала закрыта паролем. Убери пароль, пожалуйста. Пароль нужен только когда ChatGPT подключается. Для обычного человека сейчас пароль не нужен. Потом, может быть, его добавим. Но сейчас не надо мне всякие пароли, хорошо?

## Objective

Обычный пользователь должен открывать и использовать доску без пароля; отдельная авторизация ChatGPT должна сохраниться.

## Business canary

Анонимный браузер открывает доску и выполняет безопасное чтение карточек без login/password; ChatGPT OAuth/API-путь по-прежнему проходит свою предусмотренную авторизацию.

## Confirmed scope

- Найти фактический gate, который требует пароль для обычного пользователя.
- Убрать только публичное требование пароля для UI и его пользовательских API-вызовов.
- Сохранить отдельный auth-контур подключения ChatGPT.
- Добавить focused regression/black-box canary до исправления, затем проверить green.

## Explicit exclusions

- Не менять ChatGPT OAuth, токены, scopes или секреты.
- Не деплоить, не перезапускать и не менять production без отдельного подтверждения.
- Не удалять существующие данные доски и не менять unrelated UI.

## Estimate (immutable initial)

- Optimistic: 15 active minutes
- Likely: 30 active minutes
- Pessimistic: 60 active minutes

## Initial plan (по-русски)

1. Read-only определить реальный auth gate и разделение UI/API с ChatGPT OAuth.
2. Зафиксировать красный focused тест/канарейку для анонимного доступа.
3. Внести минимальный локальный фикс, сохранив ChatGPT authorization.
4. Запустить focused tests и доступный реальный read-only canary.

## Progress

- Read-only inspection confirmed the browser `AuthGate` blocks `page.tsx`, while all Kanban API routes reject requests without a session/bearer identity.
- The OAuth authorize route uses strict `identityFromRequest` and must remain login-gated.
- Red regression run: `bun test src/lib/auth/request.test.ts` failed because the new `boardIdentityFromRequest` contract is not implemented yet.
- Implemented a public work-scope board identity for Kanban UI/API routes only; OAuth routes still use strict `identityFromRequest`.
- Green focused tests: 22 passed across auth, Kanban storage, and UI interaction suites.
- `node_modules/.bin/tsc --noEmit` passed.
- `bun run build` passed and listed all expected app, Kanban API, and OAuth routes.
- Local HTTP canary passed: `/` returned 200 without the login form, `/api/kanban/cards` returned 200 without a cookie, `/api/auth/session` returned 401, and OAuth authorize without a session redirected to `/auth/login`.
- No deployment, restart, or production mutation performed.
- Full `bun test` remains blocked by the pre-existing `origin.test.ts` Vitest helper mismatch; `bun run lint` remains blocked by the missing ESLint 9 flat config. Both are recorded as separate todo items.

## Status

Complete; objective-specific business canary passed and no deployment or restart was performed.
