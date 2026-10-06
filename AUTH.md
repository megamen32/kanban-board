# Todo authentication and MCP

The existing task panel is `https://todo.bezrabotnyi.com/`. Its public UI is
protected by the outer `auth.bezrabotnyi.com` cookie gateway. Inside the app,
the shared work-board UI can render without a Kanban password; that fallback
does **not** authorize MCP. `/mcp` uses authenticated identity only.

## The current MCP contract

`POST /mcp` is the Next application's stateless Streamable HTTP MCP endpoint.
It accepts JSON-RPC with an authenticated Kanban session cookie or an AuthStore
Bearer token. Missing credentials return 401; authenticated GET/DELETE return
405 because this endpoint uses POST. Verify initialize and tools/list rather
than treating a healthy web page or a REST `/health` as MCP proof.

The public routing contract is `https://todo.bezrabotnyi.com/mcp` → the current
app on host port 43327. The corrected route was verified on 2026-10-06 to return application JSON 401
without credentials; authorized Airlock acceptance remains pending. The former
route targeted the separate legacy REST
listener on 8767, which does not implement this transport. That service remains
available for audited legacy callers; it is not the Airlock connector.

Current source exposes `kanban.list`, `kanban.read`, `kanban.capture_inbox`,
`kanban.change`, and `kanban.delete`. Check the deployed tools/list after a
release. Read before editing and preserve `expectedVersion`, assignment,
approval, deadline, weekly-plan, and completion transition policies.

## X-manager service connection

X-manager declares the board with native Airlock `RegisterMCP`. The connector
is callback-bound: employees use X-manager's authorized tools, rather than
receiving the shared service token or unrestricted board MCP access. X-manager
checks the caller, team membership, allowed projects, and authorized writes.
Airlock core and the board UI remain unchanged.

The work service Bearer is issued by the existing `AuthStore` API, with its
existing 30-day access-token lifetime. Kanban persists only its hash in
`/home/roomhacker/todo-kanban/work-auth/state.json`; Airlock stores the actual
token encrypted in the bound MCP resource. It is not a new human login,
password, setup owner, or TOTP account. Do not paste the token into chat, source,
a task archive, or command output. The rotation procedure is documented in
`/home/roomhacker/agents-projects/exmanager/docs/todo-mcp.md`.

`KANBAN_MANAGER_TOKEN` is a separate REST assignment capability: it does not
create a human session and is not an MCP Bearer token. Do not use it as a
substitute for AuthStore identity.

## Scope and employee selection

The current `tasksDirForScope` maps scope labels to the shared work store when
`KANBAN_SCOPE_ROOT` is set. Work/personal labels are not proof of filesystem
isolation in this deployment. X-manager must use work scope and enforce its
own employee/project boundaries. The board's person selector and Mine/Shared/
All are presentation filters over that shared store, not per-person server ACLs.

## Protected runtime configuration

The active environment file is
`/home/roomhacker/todo-kanban/work-auth/runtime.env`. It may contain
`KANBAN_AUTH_SECRET`, `KANBAN_SETUP_TOKEN`, `KANBAN_MANAGER_TOKEN`, and OAuth
client settings. Auth state and private task data stay outside the public code
repository. Never print resolved environment or auth state.

The existing OAuth routes are `/oauth/authorize`, `/oauth/token`, and
`/oauth/revoke`; OpenAPI is `/openapi.json` on the current host. OAuth redirect
URIs must exactly match the actual client callback. Existing one-time setup and
password/TOTP login are for human OAuth consent, not prerequisites to recreate
for the service connection. Never reset a configured owner to attach Airlock.
