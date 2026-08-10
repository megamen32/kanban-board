# Existing tooling blocker: bunx command unavailable

- Symptom: requested typecheck command cannot start.
- Smallest evidence: `bunx tsc --noEmit` returns `/bin/bash: bunx: команда не найдена`.
- Blocker: runner command availability; use the repository-local TypeScript binary if present, without changing project tooling in this task.
