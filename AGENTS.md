# My Kanban / Todo: operational ownership

This checkout is the application source for `https://todo.bezrabotnyi.com`,
not the X-manager assistant. The public code remote is
`https://github.com/megamen32/kanban-board`; work on `main` and preserve unrelated
changes. Read `DEPLOYMENT.md`, `AUTH.md`, and `CODE_DATA_SPLIT.md` before touching
runtime, authentication, storage, or MCP.

## Locate the live service before deployment

Start infrastructure discovery in `/home/roomhacker/ServersAdministartion`
(`AGENTS.md`, `infra/access-topology.md`, `docs/inventory/README.md`), then follow
`docs/inventory/sites/todo.md`. The live Compose project is
`/home/roomhacker/services/kanban-board`; its deployment override builds **this**
checkout. Its working-directory label is not its source checkout.
Do not build the stale `services/kanban-board/src` copy or use this checkout's
old `docker-compose.deploy.yml` on port 43328 to deploy Todo.

## Preserve the existing board

The owner chose the existing board as X-manager's task panel. Integrate via its
native Streamable HTTP MCP; do not rewrite the UI, create a second task store,
or replace it with the legacy `apps/kanban-mini-mcp` HTTP service. Employee
selection and Mine/Shared/All are UI filters, not a separate server-side ACL.

The current source maps authenticated scopes to the shared work store when
`KANBAN_SCOPE_ROOT` is set. Do not claim work/personal data isolation merely
because an OAuth scope has a different name. Preserve assignment, approval,
deadline, and optimistic-version transition policies.

## Safe delivery

Task Markdown and auth state belong outside this public code checkout.
Never print/copy `runtime.env`, passwords, bearer tokens, auth databases, or
real task contents into logs, docs, fixtures, screenshots, or commits.
Before any build or test, inspect the inherited server-100 resource guard and
review a project budget; existing unlimited container settings are not a budget.
Use one bounded workload at a time. Follow the guarded code refresh contract in
`CODE_DATA_SPLIT.md`; never reset, stash, or overwrite foreign work to deploy.
A real MCP initialize, tools/list, and current-card read through Airlock are
required before claiming the integration works.
