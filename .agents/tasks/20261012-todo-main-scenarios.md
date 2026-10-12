# Todo main-scenario repair and actual browser acceptance

## Owner request

Check remaining main Todo scenarios in real browser and fix broken behavior;
working board required, not only notebook checkbox repair.

## Scope and ownership

Canonical Todo main checkout /home/roomhacker/excode; start720b843 clean.
Root01a11197 owns task source/tests/rollout and independent final readback.
Actual todo.bezrabotnyi.com through primary headed Mini AgentBrowser;
task-owned targetE50F4E32258B7A741B260EA4F33E5A18, sessiongptadmin-mini-todo-full.
Only test cards/projectQA, no business assignment/date/status changes, keys or
Airlock/core/relay/storage changes. Retain original board and recoverable deletes.

## Scenario matrix

1. Create with title/description/project/assignee/deadline/priority/tags; reload.
2. Edit fields, clear optional fields, confirm reassignment; save/reload.
3. Move status in edit dialog and board drag/reorder, notebook close/reopen.
4. Search, person/project/workspace/attention filters, deep-link reload.
5. Inbox, Today scheduling/rank, weekly selection/acceptance, role views.
6. Delete own test card and confirm absence; cross-page updates.
7. Rejected/network/conflict writes preserve input, do not claim success.

Each browser operation focused integration <=20s; each scenario expected30–90s,
maximum180s excluding repair. Fast regression unit expected<5s/max30;
ordinary release setup/check/build combined180s, one bounded workload at a time.
No slow/nightly sweep blocks a focused live repair. Tests and real consumer
receipts recorded separately. Archive contains only synthetic fixture content.

## Initial verified state

Previous notebook fix alive; shared login and primary browser working.
Current board baseline71cards. Existing unrelated data never used as a canary.
Main-scenario audit underway; no blanket functional completion claim yet.

## Actual RED/GREEN observations

- Owned472e6a42-7212-4b0e-8436-202fee016042 (QA Alpha) created through dialog;
  assignee nikita persisted with direct human authorization; no external assignment.
- Plus sets parent defaulttodo but mounted dialog keeps inbox (stale prop state).
- UI edit description/tags/status/due/scheduled/timeRank persisted; Today showsQA.
- Stored scheduledAt12:00Z displays blank in edit; dueAt12:30Z displays05:30 in
  primary browser's America/Los_Angeles. Ordinary unchanged Save preserves stored
  scheduledAt: NOT confirmed data loss. Confirmed defect is missing display/clear.
- Controlled own PATCH503: editor closes and loses unsaved draft, no alert.
- Native adapter clicks sometimes dismiss dialog without DOMclick/APIrequest;
  physical-adapter ambiguity separated from product defects. DOM semantic control
  actions in the real headed browser execute the actual React/UI/backend path;
  no direct API writes stand in for scenario acceptance.
- Main tests use only synthetic dates; user-facing timezone remains Moscow.

Further RED: weekly proposal ignores projectQA/search and preselects five unrelated
cards; no acceptance was sent. Saved custom role8e7fbdb6 for isolated owner
QA-TODO-20261012 is absent from Balance (hard-coded six roles only).
Fixtures: Alpha in projectQA; isolated role store entry only. No user roles changed.

## Source repair in progress

HTTP failures are failures, not undefined success; create/edit/delete/reorder keep
visible state and unsaved input on failure. Modal default column follows opening
context; actual editable local planning date and original CAS snapshot preserved.
Week proposal/selection follows current filters and offers visible candidates;
personal saved role IDs/labels drive picker/balance, legacy default aliases retained
without rewriting existing card data. Inbox/roles retain input on failure and
don't close optimistically or accept duplicate button presses.
Focused RED/GREEN separately recorded; no runtime repair claim before deployed UI.

## First rollout and additional actual-surface findings

b685030 deployed image64ddb960 source label exact; full175checks PASS19.02s,
bounded Next build PASS. Actual headed browser: create Beta with all optional
fields201/v2, edit PATCH200/v3; one injected PATCH503 keeps editor/draft/date fields
and Russian alert. Clear dates/rank/description/assignees after explicit checkbox
confirmation PATCH200/v4 and reload retained. Mouse moves Beta todo→in-progress
PATCH200/v5 and swaps own Alpha/Beta order(v6 both). Delete503 preserves card/editor;
one retry deletes Beta, server404/absent UI. Today displays own scheduled Alpha.
Week accepts ONLY Alpha POST200/v5, exact real-other71 hash unchanged:
5a9e913da73b8a45dc5b965f09f4f7df93ccd9c844aca2a481d563123c072c91.
Isolated personal role edit503 retains draft, retry saves and deletion saves[].

Acceptance exposed an incomplete source fix: proposal selection used filtered
sections, but JSX still rendered global draft.cards. Browser showed5foreign+1QA;
no foreign selection accepted. Added actual render regression RED→GREEN changing
map to sections.proposal. Also custom role label showed literal undefined in
planning lists; render regression RED→GREEN now carries saved role definitions.
Inbox note model returned zero extracted tasks:201/cards[]/no persistence,
UI correctly retained text but capture itself unusable. Route regression RED→GREEN
preserves original non-actionable note as Inbox needs_review. No duplicate retry
of a persisted note; prior201 created zero cards. Final rollout/acceptance pending.
