---
quick_id: 261012-9pn
status: passed
verdict: PASS
verified: 2026-10-12
---
# Real browser acceptance

Scope: main existing board workflows, synthetic QA data only. Visible authenticated
Mini AgentBrowser sessiongptadmin-mini-todo-full/owned targetE50F4E32258B7A741B260EA4F33E5A18.
Actual UI controls (semantic DOM events where physical adapter was ambiguous),
normal frontend HTTP path, independent persisted readback; no direct API writes
substituted for UI scenarios. Claims are functional, not new onboarding/design;
no additional simulated focus group used for these deterministic journeys.

## Final accepted candidate

- Sourcee7d50b1f7fce065c163c4c1d88c4c1374da81507, includesb685030.
- Liveimage53c9bf7f1ba8d8b439f81c0a5e6bd395679d61d05e2bbc18b1eeb0bd587117c3.
- Started2026-10-12T04:50:18.901501801Z, restart0/OOMfalse.
- Same43327/mounts/512MiBRAM768MiBcombined/CPU2/PIDs256; actual109.8MiB/27tasks.
- Own-card-only final screenshot on browser runner:
  /Users/roomhacker/.agent-browser/tmp/screenshots/screenshot-1791781068650.png.
- Deliberate PATCH503 own-form screenshot:
  /Users/roomhacker/.agent-browser/tmp/screenshots/screenshot-1791779669612.png.

## Matrix

| Journey | Expected and actual observed result |
|---|---|
| Create full fields | Beta201/v2, description/project/assignee/high/tag/due/scheduled/rank persisted; defaulttodo. |
| Failed create and double click | Final Gamma503 keeps title+form+Russian alert; retry201 creates exactly1 even two same-turn clicks. |
| Edit/reload/clear | Beta200/v3 title; reopen dates05:30/05:00 local =15:30/15:00Moscow. Explicit reassignment confirmation clears assignees, description, dates, rank200/v4; independent reread null/empty. |
| Failed edit/delete/roles | Own503 preserves editor/current card/draft and visible error; one normal retry persists; deletion verified404 and absent UI. |
| Board drag and reorder | Real mouse moves Beta todo→in-progressv5; swaps Alpha/Beta ordering(v6 each); no false error or unintended business update. |
| Notebook/closed | Alpha donev7 aftercheckbox and reload→todo v8. Final Gamma donev4, appears afterclosedreload, return→todo v5; no warning/revert. |
| Today | Scheduled Alpha visible with correct preserved planning fields. |
| Week | First live exposed global JSX despite filtered selection; fixed+render regression. Final QA/Mine shows ONLY own Inbox candidate, selects1/accept200→week2026-W42/bigRocktrue/v4; displayed current-week label resolves custom role; proposals now0. |
| Roles | Isolated own role create/edit/failure/retry; picker includes savedstableID, balance shows1activeaction. Add secondrole, moveup, save/reopen correct order; delete/save[]. |
| Inbox | Own503 keepsinput. Realmodel tasks[] previously201/empty reproduced; final actual201/needs_review creates Inboxnotev2 with originaltext, clearsinput; role/projecteditv3. |
| Workspace/search/assignee | Mine=ownInbox; Shared=0synthetic; All=Alpha+Inbox. assigneenikita=Alpha; searchInbox=ownnote. |
| Filters/deep links | ProjectQA,person,search,unassigned preserved afterreload; blockedGamma only aftereditor statuschange. |
| Cleanup/read integration | All4 own fixture IDs404, UIQA0, rolesQA[]. Browser session200; SDK-protected kanban.list oktrue/count71/QA0. |

## Data/repository boundary

All71 non-QA cards before/after accepted operations and cleanup match exact
full JSON SHA2565a9e913da73b8a45dc5b965f09f4f7df93ccd9c844aca2a481d563123c072c91.
No real task names/bodies/credentials exported. Card deletions target only listed
own fixture IDs. Other tabs preserved; only exact owned tab closed after readback.
Changed repository is only /home/roomhacker/excode; published main, fullchecksGREEN.
Unrelated original-platform WIP in Exmanager is preserved and not included in
this gate or claimed complete. Push/fetch after docs verifies HEAD==origin/main.
