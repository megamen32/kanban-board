---
quick_id: 261013-u31
status: passed
---
# Installed project and normal MCP proof

Source main5ccd85b published, deployed imagebb6d5056, existing container
kanban-board-kanban-1 restarted2026-10-13T18:56:06.995Z with512MiB RAM,
768MiB RAM+swap, CPU2/PIDs256 and unchanged work/auth/legacy mounts.
No clone/worktree, core, credentials, model, Telegram or business-card mutation.

Fast unit/focused integration:48files/190tests PASS9.13s. Ordinary tests plus
Next build PASS20s under180s deadline. Native scope high2GiB/max3GiB,
swap256MiB/CPU4/tasks512; peak797700096B/137tasks, no high/max/OOM events.
Four actual separate Node processes converged on one immutable UUID;
new hidden registry was observed through the existing live watcher.

Official SDK in existing airlock-todo, same encrypted todo_board resource
4b0302bc-da78-4a06-8905-8203fb2af213:
- Existing73-card list and one current card read/version match.
- Ensure owned externalKey returned created=true, repeated exact key/name
  returned the same55af988d project with created=false; project.list included it.
- Incompatible name request returned SDK nonzero; subsequent read/list proved
  unchanged immutable ID/name. That failed request was not replayed.
- Owned normal task create with assignee/deadline, sensitive edit with positive
  CAS, readback, stale-CAS rejection, evidence DONE and independent read PASS.
- Only own card19fd9fc4 was deleted; project remains listed at zero cards.
- Exact full Markdown set before/after:73 files, identical combined SHA256.
- Both native Todo and Secretary credential tests passed on SAME resource,
  without reading/changing credential values. Actual cached SDK tools/list now
  includes7 tools including kanban.project.ensure/list, after normal native app
  startup/sync. Credential test alone does not refresh that cached catalog.

Native entry delegated separately: Exmanager main058eb6f includes ONLY
handlers/home.go + home_test.go. Original go tool air build passed full source
build/tests. Same app19620bec SDK deploymentfc6d93dd COMPLETE, source6707b897.
Public authenticated HTTP GET on https://todo-board.airlock.bezrabotnyi.com/
returns303 to existing board preserving project/assignee/view/tab, dropping
unrecognized redirect arguments. App AccessAdmin MCP and existing auth unchanged.
This is native entry to existing board, not a second task store. HTTP proof is
not GUI proof.

# Earlier boundary and owner correction

Earlier missing SSO browser state was superseded by the owner selecting the installed localhost UI for acceptance. No SSO login is required for that selected route. Historical observation:
Owned headed AgentBrowser tabt2/target21EC5E1CF82E9ED3F4A9B66F72250B6A shows
actual auth.bezrabotnyi.com login. Host44 LAN192.168.2.5, live RustDesk470156714;
login handoff sent to root01a11197. No password/cookie/token injection or foreign
profile clone. Current default44 MCP ChromePID1198694 is in unbounded
system/gptadmin-shellmcp-go.service, so further acceptance needs a reviewed
existing managed bounded44/88 route. Do not change/stop that shared foreign unit.
Tabt2 is retained for the assigned human login handoff; other tabs untouched.

External unauthenticated board302→existingSSO; /mcp noBearer401;
native app unauth401. App static /link-preview HTML and1200x630PNG are installed
and verified directly against existing upstream. Public page/image still302
because root expressly deferred public crawler ingress until narrow auth review.
No Telegram preview or authenticated external SSO UI acceptance claimed. Localhost UI/reload acceptance is proven below.

Private sanitized proof and exact attempt records: owning ignored
.tmp/project-ensure/{live-canary,airlock-handshake,native-readback,
native-deploy-status,board-before,board-after,build-resources}.json.
Synthetic registry fixture remains pending actual empty-project UI proof;
there is deliberately no project deletion/rename API.


# Final installed localhost UI acceptance — PASS

Source71cf3d9 published and installed as imagea15e7fe2, same container/mounts and
512MiB/768MiB/CPU2/PIDs256 limits. Add and edit project fields now use native
input/datalist suggestions from the same merged project options as the filter.
190 tests PASS9.77s plus Next build:22s total. Bound2/3GiB RAM,swap256MiB,CPU4,
tasks512; peak880349184B/133tasks, no high/max/OOM events. No MCP write replay.

The owner explicitly chose local UI without SSO. Own loopback44:44327 forwarded
to the existing100:43327 upstream, not another board. Actual headed Chrome on44
was admitted through the published exact-owner todo-browser44 profile and SAME
stock guard/payload:2GiB high=max,swap0,CPU2,tasks384,temp128MiB/20kobjects,IO10,
expected60s/emergency600s with fresh104GiB available and20GiB host reserve.
The immutable reviewed actor used one stock Chrome and finite stdlib CDP client
inside its SAME scope, not the foreign default MCP browser or copied auth state.

Actual renderer/AX and screenshots prove in4.229s:
1. Persistent empty QA project is a real filter option; selected view shows0cards.
2. Chrome Page.reload followed by settled filter/zero-card readback retains it.
3. New-card form has connected project suggestions including this empty project
   and legacy names (4options); project entered through actual browser input.
4. Escape cancels the form; UI and independent current local API still0owncards.

All three own screenshots exported and visually inspected:
- `.tmp/project-ensure/local-ui-artifacts/todo-empty-project.png`
- `.tmp/project-ensure/local-ui-artifacts/todo-empty-after-reload.png`
- `.tmp/project-ensure/local-ui-artifacts/todo-empty-project-in-create-form.png`

Native/UI result in `.tmp/project-ensure/local-ui-artifacts/todo-ui-result.json`;
local API/GUI aggregate in `.tmp/project-ensure/local-ui-proof.json`.
Native scope run-rb30343dd2c00452d8daeb1199637809c/inode1522139/helper0,
peak329773056B/swap0/OOM0. Exact Chrome2055367/Xvfb2055364/worker2055351 gone,
CDP34943 closed, cgroup/unit/reservation absent. Own SSH tunnel also stopped.
No browser card writes, auth copies, provider sends or model calls. R38 retained
its premature unused stock blank allocation separately (UIinputs0); only ONE
meaningful UI case ran. No accepted business/provider action was repeated.

External unauthenticated board remains302→existingSSO, /mcp noBearer401.
Localhost is ONLY the acceptance route; human links remain native
https://todo-board.airlock.bezrabotnyi.com/ with supported presentation queries.
Public crawler ingress/actual Telegram preview remains expressly deferred to
root's narrow review, separate from the completed project/MCP/UI contract.
