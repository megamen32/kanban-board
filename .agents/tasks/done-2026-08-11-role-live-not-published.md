# Live-доска без выбора роли

## Original request

> не вижу выбор роли чтобы я мог выбрать показывать только мои карточки

Пользователь прислал screenshot live `excode.bezrabotnyi.com`, где видны только Kanban/Список, проект и Inbox, но нет выбора роли.

## Objective

Подтвердить, почему live не показывает уже реализованный выбор роли, и сообщить точную границу между локальным commit и production.

## Business canary

Live UI показывает `Моя роль` / `Фильтр по роли` и позволяет выбрать assignee; до deploy это не должно считаться подтверждённым.

## Confirmed scope

- Read-only проверить hostname → nginx → container → local commit status.
- Не менять код и не выполнять deploy без отдельной команды пользователя.

## Explicit exclusions

- Не перезапускать Compose и не публиковать `main`.
- Не менять карточки, auth или OAuth.

## Estimate (immutable initial)

- Optimistic: 5 active minutes
- Likely: 10 active minutes
- Pessimistic: 20 active minutes

## Initial plan (по-русски)

1. Проверить live UI/API и routing chain.
2. Сопоставить live с локальным commit `bfba0a8`.
3. Сообщить причину и запросить deploy только если пользователь его подтвердит.

## Pre-deployment status

Production was untouched; this pass is read-only diagnosis.

## Progress

- Live read-only canary: `https://excode.bezrabotnyi.com/` and `/api/kanban/cards` return `200`.
- Nginx routing is confirmed: `excode.bezrabotnyi.com -> 127.0.0.1:43328 -> excode-kanban-1`.
- Running container source label is `/home/roomhacker/excode`, but its image predates the role-filter commit.
- Local `main` contains `bfba0a8 feat: add role filter to kanban board` and is ahead of `origin/main` by one commit; role markers are present in `kanban-board.tsx` and `view-model.ts`.
- The screenshot therefore shows the deployed pre-role build; no code, container, or production state was changed in this pass.

## Status

Diagnosis complete; waiting for an explicit deploy/publication command.
