# Restore shared auth for Kanban

Role: Lead
Status: complete
Created: 2026-08-11

## Original request

«Так, блядь, я даже не знаю, какой логин-гейт и какой пароль... Мы же это как раз-таки отменяли, особенно двухфакторную аутентификацию... У меня же есть один способ заходить на мои сайты. Моя собственная авторизация, которая используется на всех остальных сайтах. auth.безработный.com.»

## Objective

Убрать неправильный локальный username/password/2FA gate из пользовательского пути Kanban и подключить excode/personal board к существующему shared authentication consumer через `auth.bezrabotnyi.com`, сохранив отдельную OAuth-защиту только для ChatGPT/MCP.

## Business canary

В свежем реальном браузере открыть excode и personal board через обычный пользовательский вход; auth должен пройти через существующий `auth.bezrabotnyi.com` flow без локальной формы Kanban и без ввода отдельного Kanban password/2FA. После входа board Tester должен create/update/delete временную карточку; MCP Tester должен пройти scoped `initialize`/`tools/list` через разрешённый OAuth/Bearer path.

## Confirmed scope

- Read-only trace shared-auth hostname, nginx ingress, existing consumers and excode auth implementation.
- Minimal adapter/config change that reuses the already deployed shared-auth contract.
- Real browser recheck and MCP/site Tester rerun after explicit deploy/restart gate.
- Preserve strict ChatGPT/MCP OAuth scope isolation; ordinary board users must not see a second Kanban password/2FA gate.

## Explicit exclusions

- Do not invent credentials, ask the user for a local Kanban password, or bootstrap a new owner/TOTP.
- Do not disable ChatGPT/MCP OAuth protection or replace MCP with REST.
- Do not mutate auth provider state, nginx, production services, or deploy until the exact existing consumer contract is identified and the user has the deployment gate.
- Do not touch unrelated PWA, dark-theme, README or dirty worktree changes.

## Initial estimate (immutable)

- Optimistic: 30 active minutes
- Likely: 90 active minutes
- Pessimistic: 180 active minutes

## Initial plan (RU)

1. Найти фактический shared-auth consumer path на других сайтах и сравнить его с текущим Kanban login/auth routes.
2. Зафиксировать точную границу: обычный UI через shared auth, ChatGPT/MCP через scoped OAuth.
3. Добавить минимальный адаптер, сначала доказать его focused/black-box canary, затем запросить deploy/restart gate.
4. Перезапустить только нужный consumer, заново прогнать двух независимых Tester-gates и закоммитить только этот фикс.

## Evidence

- 2026-08-11: Existing shared-auth contract is `/etc/nginx/snippets/gptadmin-cookie-auth-locations.conf`: nginx subrequest `/_gptauth/check` proxies to `127.0.0.1:18991/check`; unauthenticated requests redirect to `https://auth.bezrabotnyi.com/login?rd=...`. The auth service returns `X-GPTAdmin-User` on a valid shared cookie.
- 2026-08-11: `https://todo.bezrabotnyi.com/` without a cookie returns `302` to the shared auth login; `https://excode.bezrabotnyi.com/` is not behind that snippet and returns `200` directly. No local Kanban password was involved in the nginx gate.
- 2026-08-11: Personal `kanban-board-kanban-1` is the stale image `sha256:2042f0...`, created 2026-08-09; current `local/kanban-board:latest` is `sha256:435339...`, built 2026-08-11 from `/home/roomhacker/excode` and already used by `excode-kanban-1`.
- 2026-08-11: Root cause is stale personal container image, not a missing user password or a need to bootstrap local auth. Minimal proposed mutation is `docker compose -f /home/roomhacker/services/kanban-board/docker-compose.deploy.yml up -d --force-recreate --no-build kanban`, which targets only `kanban-board-kanban-1`; deploy/restart gate is still pending.
- 2026-08-11: User explicitly approved the personal restart. The exact compose command recreated only `kanban-board-kanban-1`; it now runs image `sha256:435339...` on port `43327`. Loopback `/` is `200` with no local Kanban/2FA marker; public unauthenticated `todo` remains a `302` to the shared auth login. Fresh shared-auth browser CRUD Tester `019feeda-2759-77b3-96c7-ac0c44f9d44a` is running.
- 2026-08-11: Fresh Tester `019feeda-2759-77b3-96c7-ac0c44f9d44a` PASS on BrowserOS page 96: shared-auth session was accepted, no local Kanban password/2FA appeared, and visible UI completed create → persistent description update → delete → absence verification. The temporary card was not left behind; screenshots were captured/inspected around the ambiguous delete transition.
- 2026-08-11: Human-auth objective is complete. The separate MCP task still has its earlier `STOP_MISSING_CREDENTIAL` for authenticated `initialize`/`tools/list`; no bearer was invented and no local password/2FA was enabled as a workaround.
