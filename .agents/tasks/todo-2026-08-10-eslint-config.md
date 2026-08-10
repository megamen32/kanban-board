# Existing tooling blocker: ESLint flat config

- Symptom: `bun run lint` exits before linting.
- Smallest evidence: ESLint 9.39.5 reports no `eslint.config.(js|mjs|cjs)` found.
- Blocker: unrelated repository tooling configuration; excluded from the public-board auth change.
