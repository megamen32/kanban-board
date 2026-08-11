# Fix Kanban MCP transport

Role: Lead
Status: work
Created: 2026-08-11

## Original request

«MCP-проверка завершена честно: одна запись есть, но она сейчас отвечает HTTP 500; второй MCP для excode отсутствует, а /mcp у excode даёт 404. Я не буду подменять это REST-доступом. README и цель готовы, теперь прохожу финальную проверку worktree, затем коммит и push только этих изменений.» чини

## Objective

Восстановить настоящий MCP-контур для Kanban/excode: устранить HTTP 500 у зарегистрированного MCP, добавить второй board-scoped MCP только если это подтверждается существующим transport-контрактом, и добиться рабочего `initialize`/`tools/list` без подмены REST.

## Business canary

Каждый заявленный board MCP имеет подтверждённый endpoint/transport и проходит реальный JSON-RPC `initialize`, затем `tools/list`; excode `/mcp` либо работает по тому же контракту, либо его отсутствие объяснено точным upstream-блокером. README/PWA/dark-theme и чужие изменения не входят в исправляемый diff.

## Confirmed scope

- Read-only diagnosis of Codex MCP config, local excode app, ingress and real upstream.
- Minimal MCP transport/registration fix for the two board identities, if the supported implementation is discoverable.
- Focused transport tests and real initialize/tools-list canary.
- Isolated commit and push only for this MCP fix and its task evidence, after final diff review.

## Explicit exclusions

- Do not replace MCP with REST.
- Do not print, rotate, or edit bearer tokens or other credentials.
- Do not deploy/restart nginx or production services without an explicit gate at the exact action.
- Do not stage unrelated PWA, dark-theme, README, screenshots, or existing dirty work.

## Initial estimate (immutable)

- Optimistic: 30 active minutes
- Likely: 75 active minutes
- Pessimistic: 150 active minutes

## Initial plan (RU)

1. Проверить реальный transport и точные причины HTTP 500/404 без вывода секретов.
2. Найти поддерживаемую MCP-реализацию и границу двух board identities; если её нет, зафиксировать блокер, а не изобретать transport.
3. Добавить минимальный фикс и red/green transport canary для `initialize` и `tools/list`.
4. Проверить только MCP-дiff, затем сделать изолированный commit и push.

## Evidence

- 2026-08-11: Read-only topology confirmed `kanban-mini-mcp.service` on `127.0.0.1:8767`, public `todo.bezrabotnyi.com/mcp` behind nginx, and excode public `excode.bezrabotnyi.com` proxied to `127.0.0.1:43328`.
- 2026-08-11: Nginx error log identified the HTTP 500 root cause: `the rewritten URI has a zero length` for `POST /mcp`. The old `8767` upstream exposes `/health` and `/tools/*`, not MCP Streamable HTTP.
- 2026-08-11: Added the official `@modelcontextprotocol/sdk` dependency and versioned excode `/mcp` route with stateless Streamable HTTP, strict bearer identity, and OAuth-derived `work`/`personal` scope isolation.
- 2026-08-11: Added four scoped tools: `kanban.list`, `kanban.read`, `kanban.change`, and `kanban.delete`; no REST fallback is presented as MCP.
- 2026-08-11: Focused red/green: initial Vitest run exposed the existing alias-resolution gap for the new test; switching only the new MCP imports to relative paths fixed it. Focused test passed 2/2.
- 2026-08-11: `bun x vitest run`: 17 files and 36 tests passed. `bun run build`: passed and lists `ƒ /mcp`. `git diff --check`: passed.
- 2026-08-11: Real local standalone HTTP canary passed: unauthenticated `POST /mcp` 401; scoped work token `initialize` 200 with `excode-kanban-work`; independent `tools/list` 200 with all four tool names.
- 2026-08-11: Before the explicit deploy gate, public deployment was pending and `excode.bezrabotnyi.com/mcp` returned 404; the later post-restart evidence below supersedes that pre-deploy state. Codex config switch remains pending because no authorized Bearer is available and the exact ChatGPT OAuth callback is absent.
- 2026-08-11: No commit or push made yet; package/lock changes require isolated review because the shared worktree already contains the prior PWA dependency change.
- 2026-08-11: User explicitly authorized restart/deploy. `docker compose -f docker-compose.deploy.yml build kanban` passed; production image contains `ƒ /mcp`. `docker compose ... up -d --force-recreate --no-deps kanban` recreated only `excode-kanban-1`; legacy `todo` container was not touched.
- 2026-08-11: Post-restart business boundary passed: loopback and public `POST /mcp` without bearer return `401` JSON with `WWW-Authenticate: Bearer`; public excode root remains `200`. Authorized public initialize/tools-list is delegated to a fresh MCP Tester because no bearer credential is available in the shell environment.
- 2026-08-11: Fresh context-free Tester gates launched in parallel: MCP tester `019fee9e-6ba8-7710-b617-2817db6e7627` and personal-site tester `019fee9e-6e6a-7be1-b03a-190fa6dee73b`; both own separate read-only real-use task files and must append evidence before returning.
- 2026-08-11: MCP Tester completed on fresh BrowserOS surface: public `/mcp` returned `401` JSON with `WWW-Authenticate: Bearer`; screenshot was captured/inspected after an initial invalid relative-fetch attempt. Authenticated `initialize`/`tools/list` were not attempted because no authorized Bearer was available and no credential was printed or invented. Verdict `STOP_MISSING_CREDENTIAL`; evidence is in `work-2026-08-11-tester-mcp.md`.
- 2026-08-11: Personal-site Tester completed on fresh 390x844 BrowserOS surface: `https://todo.bezrabotnyi.com` showed the required username/password/2FA login gate. Screenshot was captured/inspected before stopping; no secret, bypass, or retry was used, and no card was created/changed/deleted. Verdict `STOP_MISSING_REAL_SURFACE`; evidence is in `work-2026-08-11-tester-personal-site.md`.
- 2026-08-11: Acceptance is not fully confirmed: public protected MCP boundary and local scoped canary pass, but live authenticated MCP and personal create/update/delete remain blocked by missing authorized credentials/login access. The exact ChatGPT OAuth callback is also still absent from runtime configuration; do not invent it.
