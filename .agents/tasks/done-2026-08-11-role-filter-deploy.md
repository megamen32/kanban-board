# Deploy фильтра карточек по роли

## Original request

> делай и запомни закачивай только после передеплоя

Контекст: опубликовать локальный выбор роли/фильтр «только мои карточки» и передавать изменения наружу только после успешного передеплоя.

## Objective

Передеплоить `excode-kanban-1`, проверить live-селектор роли, затем загрузить подтверждённые commits в `origin/main`.

## Business canary

На `https://excode.bezrabotnyi.com/` BrowserOS показывает `Моя роль`; выбор `Секретарь` оставляет только соответствующие карточки, сброс возвращает все карточки; `/api/kanban/cards` отвечает 200.

## Confirmed scope

- Передеплоить только `/home/roomhacker/excode` compose service `excode-kanban-1` на `43328`.
- Не трогать `kanban-board-kanban-1` на `43327`, Nginx, данные, auth и OAuth.
- После успешного live canary закоммитить task evidence и push `main`.
- Сохранить пользовательское правило: upload/push только после успешного redeploy.

## Explicit exclusions

- Не менять код в рамках deploy-задачи.
- Не reload/restart Nginx.
- Не публиковать при провале build, container health или live canary.

## Estimate (immutable initial)

- Optimistic: 10 active minutes
- Likely: 20 active minutes
- Pessimistic: 40 active minutes

## Initial plan (по-русски)

1. Проверить текущий commit, route и контейнер read-only.
2. Передеплоить `excode-kanban-1` из текущего локального source.
3. Проверить live API и реальный BrowserOS-фильтр.
4. Только после успеха закоммитить evidence и push `main`.

## Deployment evidence

- Preflight confirmed `excode.bezrabotnyi.com -> 127.0.0.1:43328 -> excode-kanban-1`; SSH localhost probe is inapplicable because server-100 is the current host and port 22 is closed.
- Old image was preserved as `local/kanban-board:rollback-role-filter-20260810T220023Z`.
- `docker compose -f docker-compose.deploy.yml up -d --build kanban` succeeded; new image is `sha256:518d98917808f99b078f6392359b7b6dbc0b3d68f7b57ad01923461bc75bb3cb`, container is running.
- Before push, local and live `/api/kanban/cards` both returned 200.
- Before push, BrowserOS live canary showed `Фильтр по роли`, role options, selected `Секретарь` with 3 cards, and reset `Все карточки` with 33 cards.
- Nginx and the unrelated `43327` container were not changed.

## Status

Redeploy and live canary complete; evidence is ready for the post-deploy push.
