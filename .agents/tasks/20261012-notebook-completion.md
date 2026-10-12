# Notebook completion repair

Owner request: completion briefly strikes task then reverts; relevant Todo controls unreliable.
Scope: canonical Todo source, existing login and task state; no Airlock/core/S3/keys changes.
Executor: root native 01a11197, sole task-owned changes in canonical main.
Source start: 2c6d36c, clean checkout.
Evidence: actual authenticated external gateway browser, internal /api/auth/session401.
Isolated QA card c5478d23-0260-4a49-b9aa-13651452d8e1; never complete real business tasks as a test.
Hypothesis: external login is discarded by transition route, classifying click as automation.
Next: actual click/readback, focused RED, smallest verified identity integration, rollout/reload proof.

Checks: fast unit identity/policy expected <5s/max30; focused route <10s/max30;
normal release setup/check/build total max180s; browser steps <=20s each.
