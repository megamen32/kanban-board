# Notebook completion repair

Owner request: completion briefly strikes task then reverts; relevant Todo controls unreliable.
Scope: canonical Todo source, existing login and task state; no Airlock/core/S3/keys changes.
Executor: root native 01a11197, sole task-owned changes in canonical main.
Source start: 2c6d36c, clean checkout.
Evidence: actual authenticated external gateway browser, internal /api/auth/session401.
Isolated QA card c5478d23-0260-4a49-b9aa-13651452d8e1; never complete real business tasks as a test.
Hypothesis: external login is discarded by transition route, classifying click as automation.
Actual RED: ordinary browser PATCH done/v2 -> HTTP200 redirected review/v3.
No actual human completion was recorded. Outer login is valid, app session401.
55 focused unit/route/policy checks PASS in3.75s; bounded Next build PASS~11s.
Additional confirmed defect: WS watches legacy TASKS_DIR and unsupported glob,
not KANBAN_SCOPE_ROOT/work; its old payload also drops planning/identity fields.
Repair: verified shared-cookie human identity, visible mismatched save warning,
correct directory watcher + invalidation/full canonical HTTP refresh.
Next: focused actual watcher check, published source and one combined rollout/reload proof.

## Published and live consumer

- d23aa92 human-login repair; 21f8fbb active-directory/full-state refresh repair.
- 60 focused checks across10files PASS5.75s; final bounded Next build PASS~8s.
- One combined existing Compose recreate, same three files/mounts/runtime bounds.
  Image9f94aea4ddd4c18b55663e2b965c10a4e4ab7fc7925fcef34212c0244966ad2b,
  source21f8fbb, started2026-10-12T03:30:40.744Z; restart0/OOMfalse.
  Live164.6MiB/28tasks; old5a82e49 image kept as rollback-notebook-20261012.
  Immediate readiness probe was premature/reset; actual subsequent HTTP200
  and authenticated browser200, not claimed as immediate zero-downtime.
- Actual shared-login session now200/nikita; no additional Kanban login.
- Native browser trusted click -> done/v4, manual_confirmation/human-ui/nikita;
  actual reload closed notebook stilldone/struck/returnbutton.
- Native browser return click -> todo/v5; actual reload active notebook unticked.
- Existing app-scoped Airlock MCP callback rename ONLY isolated QA card -> v6;
  open browser updated without reload, no stale name/dialog/error.
- No real business-card status/assignment/deadline changed by canary.
- No Airlock/Secretary/relay/S3/credentials changes. Original cutover remains separate NOTREADY.

Next: remove isolated own QA card, record resulting cleanboard and published outcome.

First QA removed via normal DELETE (recoverable store trash); native app callback
list confirms71cards, QA absent, previously updated business sources retained.
Additional confirmed UI defect: resolveConflict(false) only closed the dialog,
despite «Использовать мою» promising a save. Repair retries only original patch
with shown server version, retaining another409 and visible failure; no forced
overwrite or invented owner approval. Own fresh conflict QA exercises this delta.

Actual conflict RED on21f8fbb: real409, native «Использовать мою» closes but
todo/v2 remains. Delta5e5eca8/a377a1c fixes saving: real409 -> native choice ->
PATCH expectedVersion2/200 -> done/v3/manual-human evidence. Final consumer found
remaining stale warning because execution-view filters remove DONE from its cards;
repair passes full canonical card state to warning resolution (no inferred success).
That acceptance was CHANGES_REQUIRED, not declared fully green.

## Final acceptance — PASS for this bounded repair

Final published code e4694dc, imageafd1ed9468e83a724c69b18759e0075fcdc03b9554af07e3f7946696a2eb2c6c,
existing container started2026-10-12T03:47:57.546Z. No subsequent intentional
runtime/config changes. Same limits/mounts;101.1MiB/28tasks/OOMfalse/restart0.

Real headed Mini browser, intended existing shared login, task-owned tab only:
QA10ab1916 currenttodo/v4 -> forced stale expectedVersion1 reaches actual409;
native explicit «Использовать мою» sends ONLY original status patch with displayed
version4 ->200/done/v5/manual-human identity. Dialog closes, alerts empty.
Reload actual closed notebook: done/v5, struck, returnbutton, no stale warning.
The old failure and the intermediate stale warning were retained as RED evidence,
not skipped or called successful. Ordinary complete/reopen and external MCP refresh
already accepted in the same cycle; final delta affects conflict warning only.

Both isolated QA cards removed through normal recoverable DELETE, not business
cards; card count returns71. All prior source-bound business synchronization kept.
No cloud/core/native model/TG sends, approval flags or credentials modified.

Secretary automatic polling independently read-only verified in production:
enabled minute cron; latest03:48–03:50 runs succeeded,2projects/53cards/20skipped,
33READY links/0conflicts with fresh last_seen. Skipped/unassigned/out-of-scope
cards are not falsely described as fully assigned or projected. No job rerun,
old digest replay, forged user session or platform DB write.
Final independent registered-resource list:71cards/bothQAabsent; all33READY
Secretary link versions exactly match current authoritative board versions.
Only the task-owned headed Todo tab was closed; shared browser/foreign tabs remain.

Checks:62 focused checks/11files PASS5.40s, final delta18checks PASS3.27s;
final bounded Next compile/typecheck/static generation PASS~8s. Every individual
ordinary build/check run remained below180s, resource budgets retained.
No broad claim that every unrelated Todo feature or original Airlock migration
is complete. Pages hookup and product/core cutover keep their separate blockers.

Checks: fast unit identity/policy expected <5s/max30; focused route <10s/max30;
normal release setup/check/build total max180s; browser steps <=20s each.
