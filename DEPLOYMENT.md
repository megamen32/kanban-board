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
