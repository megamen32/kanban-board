# Code/data split

This checkout contains the Kanban application code only.

Runtime task data stays in the private data repository:

```text
/home/roomhacker/todo-kanban/tasks -> /app/data/tasks
```

The deployment override mounts the work-only path
`/home/roomhacker/todo-kanban/work-tasks` and sets `TASKS_DIR`. Do not copy
`tasks/`, `private/`, `.trash/`, or runtime databases into this code repository.

The public code repository is `megamen32/kanban-board`; the private data
repository is `megamen32/todo-kanban-data`. Both production Compose projects
build the same `local/kanban-board:latest` image from this checkout; only their
mounted task directories differ. `scripts/update-code.sh` accepts
only a clean fast-forward from `origin/main`, so a code refresh cannot overwrite
local changes or the mounted task data.

## Code update contract

The checkout is intended to track the public code remote on `main`. A future
deployment hook may run a guarded fast-forward update of this checkout; it must
never overwrite the private data path.
