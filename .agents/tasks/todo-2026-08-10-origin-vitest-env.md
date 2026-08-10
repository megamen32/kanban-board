# Existing test blocker: origin Vitest environment helpers

- Symptom: `bun test` fails in `src/lib/auth/origin.test.ts` before assertions.
- Smallest evidence: `TypeError: vi.stubEnv is not a function` and `vi.unstubAllEnvs is not a function`; 24 tests pass and 2 fail.
- Blocker: unrelated baseline test/runtime compatibility issue; excluded from the public-board auth change.
