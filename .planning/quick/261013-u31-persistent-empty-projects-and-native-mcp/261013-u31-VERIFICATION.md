---
quick_id: 261013-u31
status: blocked_real_surface
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
- Only own card19fd9fc4 was deleted; project remains visible at zero cards.
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

# Exact remaining boundary

BLOCKED_REAL_SURFACE: no existing authenticated SSO owner state for server44.
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
No Telegram preview or authenticated UI/reload acceptance claimed.

Private sanitized proof and exact attempt records: owning ignored
.tmp/project-ensure/{live-canary,airlock-handshake,native-readback,
native-deploy-status,board-before,board-after,build-resources}.json.
Synthetic registry fixture remains pending actual empty-project UI proof;
there is deliberately no project deletion/rename API.
