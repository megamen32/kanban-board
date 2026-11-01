# Review decisions and safe diagnostics

## Existing flow
- Board drag calls useKanban.moveCard, then the shared PATCH transition policy.
- Leaving review requires an explicit human decision. A generic status patch is intentionally refused.
- The existing card dialog calls POST /api/kanban/cards/:id/review with accept, rework or owner recovery, verified human identity and optimistic version.
- Result submission and executor callbacks must never accept work for the human.

## Small change
1. A review card dropped into another column opens the existing decision dialog instead of sending a doomed generic status patch.
2. Shared mutation response handling records bounded, sanitized diagnostic events visible in the Board. No task text, URLs, tokens, response bodies or personal data.
3. Journal lives only in the current browser view. It is not a second task store, command console or server audit log.
4. Preserve authentication, reviewer permissions, CAS and all canonical transitions. No direct database edits.

## Checks
Cover review versus non-review drag intent, accepted/rejected decisions, version conflicts, repeated failures, unknown/raw secret-bearing errors, journal cap and clearing. Deployment and authenticated browser acceptance remain pending.
