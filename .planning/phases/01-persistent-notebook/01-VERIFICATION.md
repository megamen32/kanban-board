# Persistent notebook controls — verification

Status: PASS
Date: 2026-10-12
Tested code: e4694dc
Surface: real todo.bezrabotnyi.com in headed primary Mini Chrome, existing shared login.

## User journey

- Complete isolated notebook task by native click, reload closed list: stilldone/struck.
- Return task by native click, reload active list: todo/unticked.
- Update isolated card through registered Airlock MCP: open notebook updates without reload.
- Actual409 conflict, explicit local choice: status-only CAS against displayed version,
  saved DONE persists after reload, no false success or lingering error.
- Both isolated cards removed through recoverable normal deletion; existing tasks preserved.

## Evidence

Task archive `.agents/tasks/20261012-notebook-completion.md` records RED/GREEN,
tested source/image/runtime, current counters and independent Secretary polling.
No real task assignments/deadlines/completion manufactured as acceptance data.
62 focused checks plus18 final delta checks; bounded Next build and real UI are
separate evidence, not interchangeable.

## Scope boundary

This is the reported notebook/control repair, not a blanket claim that the whole
site or Secretary original-platform migration is finished. Focus-group fan-out
not used: changed existing controls have an exact failure/success criterion;
direct user-state/browser/CAS evidence provides the discriminating proof.
