# Fresh Tester: excode MCP

Role: Tester
Status: work
Created: 2026-08-11

## Original request

«Делаем рестарт и запускай тестера, пусть тестирует. Двух. Один тестирует MCP, а второй тестирует сайт персональный. Там создаст что-то, поудаляет, попробует поменять. В целом.»

## Objective

Проверить настоящий публичный MCP-контур excode после рестарта через его реальный HTTP/MCP endpoint.

## Business canary

На `https://excode.bezrabotnyi.com/mcp` подтвердить unauthenticated `401`, затем с уже имеющимся разрешённым OAuth Bearer выполнить JSON-RPC `initialize` и `tools/list`, проверить excode server identity и наличие четырёх Kanban tools. Не печатать токен.

## Confirmed scope

- Только black-box проверка публичного MCP endpoint после deploy/restart.
- Реальные JSON-RPC запросы к `/mcp`.
- Фиксация точных HTTP/RPC статусов и доступных tool names.

## Explicit exclusions

- Не читать исходники, логи, Docker state или task files приложения.
- Не менять код, конфигурацию, OAuth state, токены или данные досок.
- Не подменять MCP REST-запросами.
- Не выдумывать Bearer и не просить/выводить секрет; если авторизованный credential недоступен, честно остановиться на `STOP_MISSING_CREDENTIAL` после проверки публичного 401.

## Tester protocol

Использовать свежий контекст и реальный endpoint. При таймауте/ошибке сохранить безопасное доказательство ответа до повторной попытки. В конце дописать сюда append-only evidence и вернуть TL;DR с PASS или точным blocker.

## Tester evidence — 2026-08-11T05:23:11+03:00

- Mode: `only-new`; fresh BrowserOS context, owned hidden page `93`.
- Real surface: `https://excode.bezrabotnyi.com/mcp`.
- Journey attempted: opened the public MCP endpoint, then issued an unauthenticated `GET /mcp` through BrowserOS page-context fetch with `credentials: omit`.
- Observed result: HTTP `401 Unauthorized`; `content-type: application/json`; `WWW-Authenticate: Bearer`; body preview exactly `{"error":"authentication required"}`.
- Failure evidence: an initial BrowserOS relative-URL fetch attempt returned `fetch() URL is invalid`. Before retrying, BrowserOS screenshot of the same owned page was captured and inspected; it visibly showed the safe JSON response `{"error":"authentication required"}`. No secret data was present.
- Credential check: no authorized OAuth Bearer was available in the fresh runtime context. Only credential-like environment variable names were checked, without reading values; no token was printed, requested, invented, or used.
- Not attempted: authenticated JSON-RPC `initialize` and `tools/list`, because the required permitted Bearer was unavailable.
- Verdict: `STOP_MISSING_CREDENTIAL` (the real MCP surface is present and responds; the authorized credential is the blocker).
- Smallest unblock: inject/provide an already-authorized Bearer through the secure Tester harness without exposing its value, then rerun only the authenticated `initialize` and `tools/list` canary.
