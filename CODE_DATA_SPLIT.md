# Code and task-data ownership

`/home/roomhacker/excode` contains application code for the Todo board. Its
public remote is `megamen32/kanban-board`. Runtime Markdown data belongs to the
private `megamen32/todo-kanban-data` repository at `/home/roomhacker/todo-kanban`.
Do not copy `tasks/`, `work-tasks/`, `personal-tasks/`, `private/`, `.trash/`,
auth state, runtime databases, or tokens into this public code checkout.

The active Todo deployment is the Compose project
`/home/roomhacker/services/kanban-board`, building this checkout. It mounts
`work-tasks` as `/app/data/scopes/work` and `work-auth` as `/app/data/auth`.
The live container additionally retains a legacy `/app/data/tasks` mount;
see `DEPLOYMENT.md`. A second hostname or Compose file is not evidence of an
active independent personal board.

With `KANBAN_SCOPE_ROOT` configured, the current `tasksDirForScope` maps both
scope labels to the shared work directory. Employee selection filters that
shared board. Do not document or depend on work/personal filesystem isolation
until the implementation and a real cross-scope denial check prove it.

## Code update contract

Track the public remote on `main`. `scripts/update-code.sh` accepts only a clean
fast-forward from `origin/main`; a code refresh must not overwrite local work
or mounted task data. Keep source updates separate from data backup/recovery.
Never use an old deployment copy or an image tag alone to identify the running
source revision. Verify the live Compose build context and image before a
release claim.
