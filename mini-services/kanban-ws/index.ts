import { Server } from 'socket.io';
import fs from 'node:fs';
import { boardTasksDirectory, watchBoard } from './board-watcher';

const PORT = 3003;
const TASKS_DIR = boardTasksDirectory();
const io = new Server(PORT, { cors: { origin: '*' } });
console.log(`[kanban-ws] WebSocket on port ${PORT}, watching ${TASKS_DIR}`);
if (!fs.existsSync(TASKS_DIR)) fs.mkdirSync(TASKS_DIR, { recursive: true });

// Notify, don't emit a second truncated card representation. The authenticated
// HTTP API owns the full schema, planning metadata and the current version.
const watcher = watchBoard(TASKS_DIR, fileName => io.emit('board:changed', { fileName }));
io.on('connection', socket => {
  console.log('[kanban-ws] Client connected');
  socket.on('disconnect', () => console.log('[kanban-ws] Client disconnected'));
});

async function shutdown() {
  await watcher.close();
  io.close(() => process.exit(0));
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
