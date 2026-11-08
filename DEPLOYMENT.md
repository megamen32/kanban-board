# Todo runtime and deployment

Verified on server-100 on 2026-10-06. Infrastructure discovery starts in
`/home/roomhacker/ServersAdministartion`; its service card is
`docs/inventory/sites/todo.md`.

| Responsibility | Location |
| --- | --- |
| Public task board | `https://todo.bezrabotnyi.com/` |
| Application source | `/home/roomhacker/excode`, `megamen32/kanban-board` |
| Live Compose project | `/home/roomhacker/services/kanban-board` |
| Compose files | Base + deploy files in that project, then `/home/roomhacker/agents-projects/exmanager/deploy/todo/docker-compose.runtime.yml` as the final overlay |
| Runtime | `kanban-board-kanban-1`, image `local/kanban-board:latest` |
| Upstream | Host `43327` → container gateway `3000` |
| Active tasks | `/home/roomhacker/todo-kanban/work-tasks` → `/app/data/scopes/work` |
| Auth state | `/home/roomhacker/todo-kanban/work-auth` → `/app/data/auth` |
| Protected environment | `/home/roomhacker/todo-kanban/work-auth/runtime.env` |

The deployment project's old source tree is not authoritative: its override
sets `build.context: /home/roomhacker/excode`. This checkout's own deployment
override on port `43328` belongs to an old, separate deployment; do not use it
as a Todo restart command. Docker labels alone cannot prove the source path.

## Start and inspect the existing deployment

Only after reviewing the source, foreign changes, project budget, and intended
runtime change, use the explicit live project:

```bash
cd /home/roomhacker/services/kanban-board
docker compose -f docker-compose.yml -f docker-compose.deploy.yml -f /home/roomhacker/agents-projects/exmanager/deploy/todo/docker-compose.runtime.yml config --quiet
docker compose -f docker-compose.yml -f docker-compose.deploy.yml -f /home/roomhacker/agents-projects/exmanager/deploy/todo/docker-compose.runtime.yml up -d --build kanban
docker compose -f docker-compose.yml -f docker-compose.deploy.yml -f /home/roomhacker/agents-projects/exmanager/deploy/todo/docker-compose.runtime.yml ps
curl -fsS -o /dev/null http://127.0.0.1:43327/
```

Do not dump `docker compose config` without `--quiet`: it can resolve secrets.
The existing runtime restart policy is `unless-stopped`. A rebuild is not needed
for an ingress-only MCP correction or Airlock credential binding.

## Required runtime guard

The **third** Compose file is the maintained Exmanager thin runtime overlay:
`/home/roomhacker/agents-projects/exmanager/deploy/todo/docker-compose.runtime.yml`. It preserves the live work/auth/legacy mounts and supplies
256 MiB reservation, 512 MiB RAM, 768 MiB combined RAM+swap, 2 CPUs, and 256 PIDs.
Leaving it out drops the reviewed limits. Keep it last in every inspection or
restart command; do not start only the old base/deploy pair.

Build resources are separate from those runtime caps. Next build-worker
concurrency is configured to 2. The bounded confirmed-MCP build receipt recorded
591,097,856 bytes peak memory, no swap, and 42 PIDs (runner CPU budget: 4); this
is a build measurement, not a claim that the service runs above its RAM limit.
No parallel broad build is authorized merely by this deployment recipe.

## Why there is one external port

`docker-entrypoint.sh` starts a gateway on `3000`, the Next standalone app on
`3001`, and a Socket.IO watcher on `3003`, and exits if one child fails.
The gateway forwards normal HTTP, including Next's `/mcp`, to the app. It
accepts `?XTransformPort=3003` for Socket.IO. This keeps browser relative URLs
and live updates on the same origin without publishing three host ports.

The live runtime also retains an old personal-data mount at `/app/data/tasks`.
It is not the active shared work path while `KANBAN_SCOPE_ROOT=/app/data/scopes`.
Do not remove legacy mounts without auditing their callers. See `AUTH.md` for
authentication and the current scope behavior, and `CODE_DATA_SPLIT.md` for
code/data ownership.

## Prepared fenced Compose entrypoint (not yet live-accepted)

`scripts/release-todo.py` composes the existing three launch files with a persistent content-addressed
image-only override. It never builds or pulls and requires immutable local image
IDs, source revision labels, and a candidate admitted by Herder's existing
`ReleaseGate.candidate_descends_from` (published main and ancestry).

Before invoking it, independently verify the running owner-fleet authority's
hostname, effective HOME/ledger override, canonical existing ledger and installed
release gate directory. Acquire the existing project lease using the documented
Herder operator CLI, for project `/home/roomhacker/excode/.git` and deployment target
`{"fleetDir":"/home/roomhacker/services/kanban-board","unit":"kanban-board-kanban-1"}`.
Keep the returned proof private (0600), renew during preparation, and release it
in the operator's finally path. Do not create a ledger or use the separate root
MCP child's authority. The script does not acquire, renew or release leases.

Arguments: `--proof`, `--ledger`, `--release-gate-dir`, `--expected-image`,
`--expected-revision`, `--candidate-image`, `--candidate-revision`. All are required.
Build the candidate separately from reviewed source before entering this short
release window; preserve the previous image for explicitly authorized rollback.

The Docker endpoint is fixed to unix:///var/run/docker.sock and Compose project
name to kanban-board. Docker/Compose environment overrides are removed from
subprocesses. Emergency unmerged rollout environment is rejected. Dependencies
are not started (--no-deps).

The existing Herder gate holds project and target OS locks for the entire change.
Immediately before Compose it checks token/fence/expiry, compares the current
container image and source label to the operator's expected revision, and checks
the fence again. A cooperative release must use this same authority and target.
Direct Docker writers cannot be made transactional by an advisory release lock;
resolve other active writers before execution.

After Compose, verify exact installed image/revision and loopback HTTP health.
A successful receipt explicitly leaves user-path acceptance pending. Perform
separate authenticated UI checks before calling the feature complete. Any failure
or uncertain command stops without retry or automatic rollback; inspect live
state first. This preparation does not override pending publication permissions
or authorize live deployment by itself.

Unit checks: `python3 -m unittest discover -s scripts -p test_release_todo.py`.

The image override is retained under the deployment project's release-images
directory after success or uncertain failure, so the container's config_files
label never references a deleted temporary file. Subsequent maintenance must
include the exact retained image override recorded by the current container,
rather than reverting to the historical three-file image tag. Previous manifests
are retained for explicit rollback. No generic desired-state pointer is inferred
after an uncertain command.

Compose files, optional .env and runtime.env are hashed (never printed) before
admission and checked again immediately before up. This detects drift but does
not eliminate a non-cooperating writer's check/use race; all deployment writers
must share the same authority and lock. The operator must still verify the
installed release-gate code before use; an arbitrary supplied Python directory
is not a trust proof.
