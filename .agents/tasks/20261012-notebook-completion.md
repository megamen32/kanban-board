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

Checks: fast unit identity/policy expected <5s/max30; focused route <10s/max30;
normal release setup/check/build total max180s; browser steps <=20s each.
