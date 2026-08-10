# Task: MCP boards, README screenshot, and PWA notification goal

Status: partial; README and goal complete, two-board MCP integration blocked by missing working transport
Date: 2026-08-11

## Original request

«так а в codex добавил mcp двух досок? и проверил что он работает? комит и пуш. добавь ридми скришот и скажи есть миллиарод досок но эта моя. mobile , agent first

потом ставь как цель сделать pwa чтобы она могла нотификации сама слать»

## Objective

Verify and, when a real supported transport exists, configure Codex access to the two Kanban boards; add a privacy-safe product screenshot and the requested ownership/mobile/agent-first positioning to the public README; verify the requested business paths; commit and push the repository changes. Create a durable Codex goal for a mobile-first, agent-first PWA that can send notifications independently.

## Business canary

Both intended board integrations are identifiable in the active Codex MCP configuration and pass a safe read-only connectivity/tool-list check, or the exact missing transport is recorded as a blocker. The README renders a repository-relative screenshot without hostnames, secrets, or private card data. The pushed commit is present on the remote. The PWA notification goal exists in Codex.

## Confirmed scope

- `/home/roomhacker/excode` repository and its README/public product documentation.
- Codex MCP configuration discovery and narrowly scoped configuration only if the board MCP transport is already present or can be reused without inventing a server.
- Two board identities: work and personal, matching the repository's existing scoped API model.
- README screenshot and concise “many boards, this one is mine” / mobile-first / agent-first positioning.
- Commit and push of repository changes requested by the user.
- Creation of the explicitly requested PWA notification goal.

## Explicit exclusions

- No production deploy or service restart beyond the explicitly required narrow pre-push redeploy of `excode-kanban-1`; no unrelated services or proxy changes.
- No new MCP server implementation or public exposure of a REST API without a concrete transport and acceptance contract.
- No secrets, OAuth tokens, private task contents, host paths, or deployment-only hostnames in README or committed files.
- No implementation of PWA notifications in this task; only goal creation.

## Initial active-minute estimate (immutable)

- Optimistic: 30 minutes
- Likely: 55 minutes
- Pessimistic: 90 minutes

## Initial plan

1. Проверить состояние репозитория, существующую модель work/personal и реальную конфигурацию MCP Codex без вывода секретов.
2. Проверить обе доски безопасным чтением; если MCP-транспорта нет, зафиксировать точный блокер, не подменяя MCP REST-запросом.
3. Добавить в README безопасный скриншот реального интерфейса и короткое позиционирование mobile-first / agent-first с акцентом «досок миллиарды, но эта — моя».
4. Запустить релевантные проверки, проверить diff, сделать коммит и push; production deploy не выполнять.
5. После завершения текущей поставки создать отдельную цель Codex для PWA-уведомлений.

## Estimate revisions

None.

## Evidence log

- 2026-08-11: Official Codex MCP documentation confirms shared MCP configuration in `~/.codex/config.toml` or trusted project `.codex/config.toml`, and supports stdio and streamable HTTP transports.
- 2026-08-11: `codex mcp list` shows one enabled board server, `kanban-mini-mcp`; no second board MCP entry or live Kanban MCP tool namespace is available in this Codex process.
- 2026-08-11: Safe MCP canary against the configured server returned HTTP 500 for initialize, tools/list, and read-only `kanban.list(limit=1)`. The current excode public surface returned HTTP 404 for `/mcp` and HTTP 200 for `/api/kanban/cards`; REST was not substituted for MCP.
- 2026-08-11: Added privacy-safe real UI screenshots generated from a local demo fixture at `docs/screenshots/kanban-mobile.png` and `docs/screenshots/kanban-board.png`; the README host/secret scan is clean.
- 2026-08-11: `docker compose config --quiet` passed. `bun x vitest run` passed: 11 files, 28 tests. `bun test` remains incompatible with the Vitest `vi.stubEnv` tests under Bun; `bun run lint` remains blocked by the repository's missing ESLint flat config.
- 2026-08-11: Created Codex goal `Сделать эту Kanban-доску mobile-first и agent-first PWA, которая после явного разрешения пользователя самостоятельно отправляет web push-уведомления о нужных изменениях и сроках.`
- 2026-08-11: Ran the required narrow redeploy for `excode-kanban-1` with Compose; the container was force-recreated and the live image/container IDs matched.
- 2026-08-11: Post-redeploy live checks passed: loopback API returned 18 cards, public board returned HTTP 200, OpenAPI returned HTTP 200. Fresh BrowserOS page 58 exposed `Фильтр по роли`; selecting `Секретарь` reduced the surface by 33 cards and left 3, and returning to `Все карточки` restored 33 cards.
