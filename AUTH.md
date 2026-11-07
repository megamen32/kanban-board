# Todo authentication and MCP

The existing task panel is `https://todo.bezrabotnyi.com/`. Its public UI is
protected by the outer `auth.bezrabotnyi.com` cookie gateway. Inside the app,
the shared work-board UI can render without a Kanban password; that fallback
does **not** authorize MCP. `/mcp` uses authenticated identity only.

Human transition routes also validate the existing `gptadmin_auth` cookie through
the existing HTTPS `https://auth.bezrabotnyi.com/check` endpoint (3-second bound,
no cache/redirects). Only that cookie is forwarded; no signing secret is copied.
The server-returned fleet owner `roomhacker` maps to the existing board owner
`nikita`; other verified users keep their own identity. Client headers, body flags
and the person filter are not authentication. Service Bearers remain non-human.
OAuth and MCP retain their original Kanban AuthStore contract. This repairs the
previous mismatch where shared-login clicks were classified as automation.

## The current MCP contract

`POST /mcp` is the Next application's stateless Streamable HTTP MCP endpoint.
It accepts JSON-RPC with an authenticated Kanban session cookie or an AuthStore
Bearer token. Missing credentials return 401; authenticated GET/DELETE return
405 because this endpoint uses POST. Verify initialize and tools/list rather
than treating a healthy web page or a REST `/health` as MCP proof.

The public routing contract is `https://todo.bezrabotnyi.com/mcp` → the current
app on host port 43327. The corrected route was verified on 2026-10-06 to return application JSON 401
without credentials. The initial authorized Airlock list/read/create/update
canary passed. The separate owner-confirmed assignment/deadline canary also
passed read/edit, permission rejection, visible panel verification, and cleanup. The former
route targeted the separate legacy REST
listener on 8767, which does not implement this transport. That service remains
available for audited legacy callers; it is not the Airlock connector.

Current source exposes `kanban.list`, `kanban.read`, `kanban.capture_inbox`,
`kanban.change`, and `kanban.delete`. Check the deployed tools/list after a
release. Both change (new/edit) and capture accept the optional display URLs
`sourceMessageUrl` and `sourceSessionUrl`. They are described in the native tool
schemas and initialization instructions. Omitted values preserve existing links;
null clears a link. See [the field contract and synthetic examples](docs/card-provenance-links.md).
Links do not grant source, execution or completion authority. Read before editing and preserve `expectedVersion`, assignment,
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

## Confirmed owner commands

The app's MCP checks the authenticated token's exact service client, username,
and work scope before accepting `ownerCommandConfirmed`. X-manager derives
that bit only through its configured-owner confirmation tools; ordinary
`board_change` strips it and supplies false. Browser sessions and other OAuth
clients cannot obtain this authorization by submitting the bit themselves.
Deadline, weekly-plan, completion-evidence, and optimistic-version policies
remain in force. The exact confirmed create/read/edit, unauthorized-confirmation denial, visible
panel check and temporary-card cleanup passed through the real native path.
The combined receipt is Exmanager's
`.agents/tasks/outcomes/20261006-todo-and-self-management.md`.

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

## Explicit delegated owner completion

The same authenticated eXmanager service may carry a distinct
`ownerCompletionConfirmed: true` together with `ownerCommandConfirmed: true`
for an existing owner card, a status-only `column: done` edit, and a positive
exact `expectedVersion`. The native application derives this bit only from its
configured owner's confirmed completion tool; it is not exposed as an ordinary
board change permission. Other fields, foreign owners/reviewers, missing or stale
versions, and untrusted callers are rejected without a write.

The board records server-issued `owner_confirmed_completion` evidence with
`origin: mcp`; it does not pretend a browser click or machine-verification.
Ordinary automated DONE still redirects to review, and caller-supplied audit
evidence never authorizes completion. Existing queued operations keep their
original semantics.

## Internal team work and empty projects (2026-10-13)

Native `kanban.project.ensure {externalKey,name}` returns
`{project:{id,externalKey,name},created}`; `kanban.project.list {}` returns
`{projects:[...]}`. The registry lives in `.projects/*.json` inside the same
scoped work mount, outside public source. It creates no cards. A repeated
exact key/name returns the same immutable UUID; a different name conflicts.
Publication is atomic across processes and fsynced before acknowledgment.
The UI combines registered names and legacy card-derived names, including
zero-card projects after reload. Project deletion/rename is not exposed.

The owner-approved internal team contract supersedes confirmation for the
exact existing `exmanager-airlock-service` / `exmanager-service` work principal.
Normal `kanban.change` can assign and change deadlines without confirmation
bits; edits require positive `expectedVersion`. X-manager retains actual
caller/team/project authorization before invoking its bound work resource.
Other clients and human UI keep their existing policy. No principal or secret
is copied, invented or changed. Completion requires non-empty typed result
`completionEvidence` (type plus a result field), and records server-issued
`internal_team_completion` with the service actor and original result evidence.
Outstanding reviewer requirements and missing evidence still redirect to review;
request data cannot impersonate this service or manufacture completion authority.

Static preview metadata and `/link-preview` contain no task or owner data.
The external UI remains behind the existing SSO gateway and `/mcp` remains
Bearer-authenticated. Public crawler ingress routing is a separate reviewed
infrastructure change; application metadata alone does not prove Telegram preview.

## Team and project metadata in Kontur

The project catalog uses the complete authorized cards and registered projects,
including empty projects. Mine/Shared/All only filters responsibility; it does
not remove project identities from navigation and does not define a team.

The cards GET snapshot includes a display-only `teamCatalog` with
`coverage: visible-projects`. Native callers receive exact project/team
relationships from the existing Exmanager project-scope resolver. The verified
owner browser grant still controls the owner's cards; bounded metadata lookups
cannot remove authorized cards when the team source is unavailable. Other
native callers receive metadata only from their successful project grants.
Legacy identities receive only relay-catalog relationships for their already
allowed projects. No new access grant is derived from catalog metadata.

Native team IDs are namespaced exact team names. Legacy relay IDs use a separate
namespace. The UI does not merge teams by display name or infer relationships
from project prefixes, aliases, participants or work/personal scopes. Missing
relationships remain unknown. The contract supports several explicit teams per
project, without changing the upstream membership model or creating bindings.

Catalog status distinguishes complete, partial and unavailable metadata.
Responses are private and uncached; the client validates relationships against
the same snapshot, clears them on 401/403 and refreshes after task writes and
when the tab regains attention. Team member IDs, board logins, write grants and
private source diagnostics are excluded from this display projection.

## Verified owner registration of empty projects

`POST /api/kanban/projects` is available to the same configured native Airlock
owner and verified Board owner session. The native assertion binds the exact
POST route and body; a configured same-origin browser action is required.
The endpoint accepts only `{externalKey,name}`, applies an 8 KiB body limit,
and writes through the existing durable work project registry. It returns
201 for a new identity, 200 for the same exact key/name and 409 for a conflicting
name. It creates no cards, teams, memberships or project access grants.

Service principals and unsigned owner cookies do not authorize this endpoint.
A failed or unavailable identity check fails closed. Registration metadata is
private and uncached. Use the same stable external key when reconciling an
uncertain result; never manufacture an Exmanager signed scope to register an
independent project.


## Observed owner team catalog

The verified native owner view may read a private, operator-imported Exmanager
directory from `.metadata/exmanager-team-catalog.json` in the existing work
task mount. Both the signed native identity and the configured Board owner
session must verify before the file is read. Other native users, legacy
sessions and unauthenticated requests never receive this owner directory.

The strict, bounded snapshot contains only a source app ID, source revision,
original UTC observation time, exact team IDs/names and explicit project/team
links. Only links to projects already authorized in the same owner snapshot
are returned. Unknown relations are never inferred from names. Known teams
without a confirmed visible project remain visible with unknown relations.

The response labels this projection `coverage: owner-catalog` and each link
`source: exmanager-snapshot`; provenance retains the original observation
time and source revision. The UI shows that automatic refresh is not connected.
Refreshing the board rereads the imported file; it does not claim a new
upstream observation. A valid imported directory avoids repeated calls to a
known-unavailable upstream resolver. Missing or invalid files fall back to
the existing metadata resolver without removing already authorized tasks.

This display cache does not grant task access, memberships, reviewer roles
or write permissions. It does not contain member IDs, logins, credentials,
task text or permission claims. No HTTP import endpoint is exposed.

Unfinished integration goal: replace the operator import with a supported,
current-user Exmanager metadata channel after the installed Airlock SDK
provides an admitted app-to-app invocation. Keep the dated snapshot notice
until an authenticated end-to-end refresh is implemented and verified.
