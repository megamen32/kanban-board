## 2026-08-10 — public board access (Short)

- What slowed or confused L? The first background HTTP canary returned no report and port 3311 was already occupied; a tty-managed server on 38173 produced clear evidence.
- Which instruction should change? Lead.md: prefer a tty-managed local canary with a free-port probe when background process output is ambiguous.
- Which skill, MCP, or tool is missing? none.
- What operation or error repeated? 3 baseline verification blockers: 2 `origin.test.ts` Vitest helper errors, missing ESLint 9 flat config, and unavailable `bunx`; each was recorded as a separate todo.
- State: Proposed

## 2026-08-10 — live board release gate (Short)

- What slowed or confused L? The live root returned 200 without login text even though the hydrated old client still showed the form; the unauthenticated Kanban API 401 was the decisive evidence.
- Which instruction should change? Lead.md: for live UI auth claims, prefer a hydrated/browser or protected API canary over raw HTML markers.
- Which skill, MCP, or tool is missing? none.
- What operation or error repeated? 1 misleading live root probe; guard with an objective API canary before release conclusions.
- State: Proposed

## 2026-08-10 — public board deployment (Short)

- What slowed or confused L? Project docs listed port 43327 while the excode vhost used 43328; two Kanban containers required read-only Nginx and Docker mapping checks.
- Which instruction should change? web-container-deploy/SKILL.md: support a local-server preflight when the target is the current host and require vhost-to-container mapping before apply.
- Which skill, MCP, or tool is missing? A local-target variant of the existing preflight script that does not require SSH.
- What operation or error repeated? 1 SSH preflight failure (`localhost:22 connection refused`) and 1 unprivileged `nginx -t` failure; guard with explicit local checks and a root-capability note.
- State: Proposed
