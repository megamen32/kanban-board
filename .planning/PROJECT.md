# Todo

## What This Is

Existing shared task board at todo.bezrabotnyi.com, independent of Secretary.
Next/React renders board and notebook views over existing Markdown task storage;
the native MCP is used by Secretary through its registered platform resource.

## Core Value

Human task changes persist and remain correct after reload.

## Requirements

### Validated

- Existing Markdown board and native MCP read/edit integration are retained.

### Active

- [ ] Notebook completion persists after a human click and page reload.
- [ ] Existing shared login is recognized by human board transitions.
- [ ] Failures are shown instead of silently rolling back controls.

### Out of Scope

- New board UI or task store — preserve existing product and data.
- Platform/Secretary rewrite — separate owning project and roadmap.
- Reassigning or completing real business cards as test data — use isolated QA.

## Context

Owner reports checkbox strikes a task briefly then reverts. Existing outer cookie
gateway admits the browser but Kanban's internal session is absent. Current API
classifies such writes as automation and redirects DONE to review. This hypothesis
is being checked on an isolated card before fixing the exact integration.

## Constraints

- Preserve policy, task data, auth state, foreign WIP and normal MCP authority.
- Use canonical main source and published code before bounded live rollout.
- Verify actual notebook after reload, not only unit tests.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Preserve existing board and external login | User wants working existing controls | Existing |
| Keep service completion separate from human completion | No fabricated human authority | Pending repair |

## Evolution

Update validated requirements and decisions after consumer verification; preserve
unfinished outcomes and narrow scope on subsequent phases.

---
*Last updated: 2026-10-12 after brownfield initialization*
