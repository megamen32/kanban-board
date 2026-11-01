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

## Implemented scope
- Dragging out of review opens the existing card dialog without sending an invalid generic PATCH. The user still makes an explicit accept/rework decision there.
- Existing shared mutation response handling owns error classification. Known reasons are allowlisted; unknown provider output is never rendered or retained.
- The diagnostic panel stores at most 30 records in memory for the current view, clearing on identity change/unmount/reload. No persistent browser storage, server log database or additional authorization.
- Create/update/delete/reorder/review requests attach a generated x-board-request-id. The journal associates failures with that actual outgoing request ID. This is correlation metadata, not proof of server receipt or a new server-side trace index.
- Network uncertainty is reported without automatic retry. Version conflicts still use the existing compare-and-retry flow.
- This first slice does not cover arbitrary executor errors or all external MCP activity. It is not a terminal and cannot execute commands.
- Authentication, reviewer identity, optimistic version and transition policy are unchanged.
