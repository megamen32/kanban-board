# Calendar board view
Outcome: a native calendar mode beside Kanban/List/Graph, with dated tasks and private connected-calendar events.
Scope: read-only calendar projection and existing-card opening. No OAuth, credential creation, shared event storage, or automatic date/duration changes.
Branch: feat/board-calendar-view-20261106, base eeb10ad. Code commit:20d5877fb982e0b6a1244d5ded22683889036137.
Implemented: month/week view, date navigation, timezone selection, scheduled and deadline markers, undated tasks, existing-card opening, shareable view/date/period URLs.
Private events: existing per-user Keeper credentials only; current session revalidated on focus/pageshow, blur/hidden clears data, aborted/obsolete responses are ignored and server subject must match actual session. No credentials were created or read into browser.
Source validation:26 focused tests pass, TypeScript and changed-file eslint pass, final Next webpack production build passes. AST graph updated without LLM.
Full suite:29 failed/877 passed. Those29 baseline failures are independently reproduced and recorded in the ownership task. Overall suite is not green.
Browser QA:actual candidate on isolated loopback, desktop/mobile390px, navigation and reload, error states. Browser-only synthetic fixtures proved scheduled/deadline dates, all-day event, undated tasks and existing edit-dialog opening; they do not prove live personal-calendar integration.
Independent review:3 findings fixed with regression proof (nullable title, offset ordering, account-switch lifecycle); final recheck pending.
Release remains blocked:project release lease unavailable; fallback cannot prove required VERSION/live revision. Main/runtime were not changed. Another task reports a safety-review rejection on main merge; no alternate route was attempted.
Separate external prerequisite:real Google/iCloud calendar connection needs user authorization and credentials. No live read/write success is claimed.
