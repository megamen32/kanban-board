# Installed static preview — 2026-10-14

Board source a9df822 (main/pushed), image9c737dd0, native adapter0695cc0 (main/pushed), SAME app19620bec-17f0-4515-b6aa-0cf09976217f, normal SDK build1681bd60-dc75-44f7-993b-9c934d87896d COMPLETE/source dcdc6cc9d1268a0b05676a96ea7df2d7f69681d5. No app grants/core/auth changes.

## Accepted installed source paths

- http://127.0.0.1:43327/link-preview — anonymous HTML200, exact canonical export, SHA25608de207870255ec4d3a61ffc682eb0a2e267b016e5b277793a2055be387b7164.
- http://127.0.0.1:43327/todo-preview.png — anonymous PNG200, 1200x630, SHA256a322669a5f08dc741ba9a89c9fd0db826162e16ecc187370b0e0b63ab6546608; visually inspected generic Todo artwork, no task/owner data.
- Native SDK registers GET /link-preview public and /static/{name} public, root remains user. Genuine saved owner native HTTP reads both200 and exact bytes, private query ignored. Root303 retains project/assignee/view/tab and drops redirect parameter. This is HTTP proof, not GUI login proof.
- SAME encrypted MCP resource4b0302bc-da78-4a06-8905-8203fb2af213: normal initialize/tools-list test and SDK kanban.list/read/project.list accepted;74 cards/2 projects,0 mutations and0 sends. No replay of previous accepted card/project/browser cases.
- External UI302, unauth MCP401, native human root401. Runtime caps512MiB/768MiB combined/CPU2/PIDs256 and existing mounts retained.

## Exact public ingress collision

Anonymous native https://todo-board.airlock.bezrabotnyi.com/link-preview and /static/todo-preview.a322669a5f08.png return401 after deployment and owner activation. Therefore public crawler/Telegram preview is NOT accepted yet. Stock nginx edge forwards native wildcard to Caddy4280; route declarations are public but platform delivery still denies anonymous requests. No core or app-access workaround applied.

Concrete narrow infra destinations handed to root01a1366e: native /link-preview → fixed43327/link-preview; native /static/todo-preview.a322669a5f08.png → fixed43327/todo-preview.png; discard all query/cookies. Telegram crawler native root may map to fixed preview separately from authenticated human root. Ingress belongs to Admin, not excode.

Metadata: title «Todo — задачи и проекты»; description «Общая доска задач: проекты, исполнители, сроки и результаты работы. Доступ к доске после входа.»; canonical/og:url https://todo-board.airlock.bezrabotnyi.com/; og:image https://todo-board.airlock.bezrabotnyi.com/static/todo-preview.a322669a5f08.png; image1200x630; twitter summary_large_image.

Fast unit2 tests passed0.429s (expected1s/max10s). Focused SDK integration/Go build16s (expected20s/max200s); Next build11s (expected20s/max200s), memory peak854831104B/PIDs99/noOOM. Reviewed finite limits enforced. Foreign Exmanager WIP remains untouched; only owned paths published.

Evidence (ignored, credential-free summaries): .tmp/native-preview/{loopback-readback,anonymous-readback,owner-native-readback,mcp-readback,board-build-resources}.json; build logs. Native target/browser finished previously is untouched. Telegram sends remain root-owned.

Verdict: installed source/API paths accepted; BLOCKED_REAL_SURFACE at anonymous native ingress pending owning Admin hunk, not public-preview completion.
