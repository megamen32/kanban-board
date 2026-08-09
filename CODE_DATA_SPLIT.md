# Code/data split

This checkout contains the Kanban application code only.

Runtime task data stays in the private data repository:

```text
/home/roomhacker/todo-kanban/tasks -> /app/data/tasks
```

The work deployment mounts `/home/roomhacker/todo-kanban/work-tasks` as the
`work` scope and `/home/roomhacker/todo-kanban/personal-tasks` as the explicit
`personal` scope, plus a separate auth-state directory. The personal
deployment mounts only its personal scope and its own auth state. Do not copy
`tasks/`, `private/`, `.trash/`, auth state, or runtime databases into this code
repository.

The public code repository is `megamen32/kanban-board`; the private data
repository is `megamen32/todo-kanban-data`. Both production Compose projects
build the same `local/kanban-board:latest` image from this checkout; scope
mounts and auth state remain separate. `scripts/update-code.sh` accepts
only a clean fast-forward from `origin/main`, so a code refresh cannot overwrite
local changes or the mounted task data.

## Code update contract

The checkout is intended to track the public code remote on `main`. A future
deployment hook may run a guarded fast-forward update of this checkout; it must
never overwrite the private data path.
