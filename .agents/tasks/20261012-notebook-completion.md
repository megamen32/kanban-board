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

Checks: fast unit identity/policy expected <5s/max30; focused route <10s/max30;
normal release setup/check/build total max180s; browser steps <=20s each.
