## 2026-08-10 — public board access (Short)

- What slowed or confused L? The first background HTTP canary returned no report and port 3311 was already occupied; a tty-managed server on 38173 produced clear evidence.
- Which instruction should change? Lead.md: prefer a tty-managed local canary with a free-port probe when background process output is ambiguous.
- Which skill, MCP, or tool is missing? none.
- What operation or error repeated? The same 2 `origin.test.ts` Vitest helper errors recurred in the next full `bun test`; the existing tooling todo remains the guard.
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

## 2026-08-11 — role card filter (Short)

- What slowed or confused L? The worker lane needed multiple bounded waits before returning its isolated `view-model.ts` change; integration itself stayed disjoint.
- Which instruction should change? feature-implementation/SKILL.md: include a short expected completion window for a Worker-owned bounded slice.
- Which skill, MCP, or tool is missing? none.
- What operation or error repeated? none; focused view-model tests passed 5/5, build and TypeScript passed, and BrowserOS verified role select/filter/reset.
- State: Proposed

## 2026-08-11 — role filter live diagnosis (Direct)

- What slowed or confused L? Live HTTP stayed healthy (`200`) while serving the pre-role image, so health alone could not prove the feature was deployed; the local commit/source marker comparison resolved it.
- Which instruction should change? bezrabotnyi-nginx-routing/SKILL.md: add a release-marker comparison between the running image and the intended local commit for UI rollout diagnosis.
- Which skill, MCP, or tool is missing? none.
- What operation or error repeated? none; Nginx-to-container mapping and local branch status were each checked once.
- State: Proposed

## 2026-08-11 — role filter post-redeploy publish (Short)

- What slowed or confused L? none; the requested redeploy-before-upload order was explicit and the live canary completed before push.
- Which instruction should change? none; the new user preference is recorded in memory.
- Which skill, MCP, or tool is missing? none.
- What operation or error repeated? none; one targeted Compose rebuild, one live BrowserOS filter canary, then publication.
- State: fixed now

## 2026-08-11 — MCP board check and README delivery (Short)

- What slowed or confused L? Codex listed one configured `kanban-mini-mcp`, but no callable tool namespace; direct initialize/tools/list/call all returned HTTP 500 and excode `/mcp` returned 404.
- Which instruction should change? openai-docs/SKILL.md: add a concise local MCP verification recipe that reports configured names, redacted transport status, and one read-only tools/list canary.
- Which skill, MCP, or tool is missing? A Codex MCP diagnostic/handshake tool for configured remote servers, with mandatory secret redaction and board-scope discovery.
- What operation or error repeated? 3 MCP requests returned HTTP 500; the existing `bun test` Vitest-helper incompatibility also recurred, while `bun x vitest run` passed 28/28.
- State: Proposed
## 2026-08-11 — versioned Kanban MCP transport (Short)

- What slowed or confused L? The public 500 was nginx's zero-length rewrite, while the upstream was only a REST-like HTTP facade; source and production route lived outside the excode git worktree.
- Which instruction should change? bezrabotnyi-nginx-routing/SKILL.md: add a standard MCP route check that distinguishes proxy rewrite failure from an actual JSON-RPC transport.
- Which skill, MCP, or tool is missing? A safe deploy preview that maps an unversioned local upstream to its owning repository before restart.
- What operation or error repeated? 2 local canary attempts failed before the final scoped JSON-RPC canary; guard with a versioned local server test before any restart.
- State: needs human decision

## 2026-08-11 — post-restart Tester gates (Short)

- What slowed or confused L? Live acceptance could not cross auth: `KANBAN_MINI_MCP_BEARER` is unset, `KANBAN_OAUTH_REDIRECT_URIS` is empty, and the personal site presents username/password/2FA.
- Which instruction should change? Lead.md: require a secure authorized test credential or explicit auth blocker before dispatching an authenticated MCP/site Tester.
- Which skill, MCP, or tool is missing? Secret-safe Tester credential injection plus a real browser session bootstrap for the protected personal board.
- What operation or error repeated? 2 malformed first attempts (missing curl URL; invalid BrowserOS relative URL) required screenshot/diagnostic retry; guard with absolute-URL validation in canary templates.
- State: needs human decision
