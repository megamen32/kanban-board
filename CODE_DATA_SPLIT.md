# Code/data split

This checkout contains the Kanban application code only.

Runtime task data stays in the private data repository:

```text
/home/roomhacker/todo-kanban/tasks -> /app/data/tasks
```

The deployment override mounts that path and sets `TASKS_DIR`. Do not copy
`tasks/`, `private/`, `.trash/`, or runtime databases into this code repository.

## Code update contract

The checkout is intended to track the public code remote on `main`. A future
deployment hook may run a guarded fast-forward update of this checkout; it must
never overwrite the private data path.
