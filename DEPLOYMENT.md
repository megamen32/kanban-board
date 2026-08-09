# Runtime layout

The app is exposed through one external port (`43327` in the deployment override). Inside the container:

- gateway: `3000` (published externally);
- Next standalone app: `3001`;
- Socket.IO watcher: `3003`.

The gateway accepts `?XTransformPort=3003` only for the Socket.IO service; all other HTTP requests go to Next. This keeps the browser's same-origin relative URLs working while exposing only one host port.

The deployment override mounts `/home/roomhacker/todo-kanban/tasks` into `/app/data/tasks`.
