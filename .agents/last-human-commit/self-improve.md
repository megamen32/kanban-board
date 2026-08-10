## 2026-08-10 — public board access (Short)

- What slowed or confused L? The first background HTTP canary returned no report and port 3311 was already occupied; a tty-managed server on 38173 produced clear evidence.
- Which instruction should change? Lead.md: prefer a tty-managed local canary with a free-port probe when background process output is ambiguous.
- Which skill, MCP, or tool is missing? none.
- What operation or error repeated? 3 baseline verification blockers: 2 `origin.test.ts` Vitest helper errors, missing ESLint 9 flat config, and unavailable `bunx`; each was recorded as a separate todo.
- State: Proposed
