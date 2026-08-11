import { Server } from 'socket.io';
import chokidar from 'chokidar';
import path from 'path';
import fs from 'fs';
import matter from 'gray-matter';

const PORT = 3003;
const TASKS_DIR = process.env.TASKS_DIR || path.join(process.cwd(), '..', 'data', 'tasks');

interface CardPayload {
  id: string;
  title: string;
  description: string;
  column: string;
  priority: string;
  tags: string[];
  order: number;
  created: string;
  updated: string;
  dueAt?: string;
  fileName: string;
  version: number;
}

const io = new Server(PORT, {
  cors: { origin: '*' },
});

console.log(`[kanban-ws] WebSocket on port ${PORT}, watching ${TASKS_DIR}`);

if (!fs.existsSync(TASKS_DIR)) fs.mkdirSync(TASKS_DIR, { recursive: true });

function parseCard(filePath: string): CardPayload | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const { data, content } = matter(raw);
    const fileName = path.basename(filePath);
    return {
      id: data.id || fileName.replace('.md', ''),
      title: data.title || fileName.replace(/-[^-]+\.md$/, '').replace(/-/g, ' '),
      description: content.trim(),
      column: data.column || 'inbox',
      priority: data.priority || 'medium',
      tags: Array.isArray(data.tags) ? data.tags : [],
      order: data.order ?? 0,
      created: data.created || new Date(fs.statSync(filePath).birthtime).toISOString(),
      updated: data.updated || new Date(fs.statSync(filePath).mtime).toISOString(),
      dueAt: typeof data.dueAt === 'string' ? data.dueAt : undefined,
      fileName,
      version: data.version || 1,
    };
  } catch (e) {
    console.error(`[kanban-ws] Parse error ${filePath}:`, e);
    return null;
  }
}

const debounceMap = new Map<string, ReturnType<typeof setTimeout>>();
function debounce(key: string, fn: () => void, ms = 300) {
  const existing = debounceMap.get(key);
  if (existing) clearTimeout(existing);
  debounceMap.set(key, setTimeout(fn, ms));
}

const watcher = chokidar.watch(path.join(TASKS_DIR, '*.md'), {
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
});

watcher.on('add', (filePath) => {
  debounce(`add:${filePath}`, () => {
    const card = parseCard(filePath);
    if (card) {
      console.log(`[kanban-ws] File created: ${card.fileName}`);
      io.emit('file:created', card);
    }
  });
});

watcher.on('change', (filePath) => {
  debounce(`change:${filePath}`, () => {
    const card = parseCard(filePath);
    if (card) {
      console.log(`[kanban-ws] File updated: ${card.fileName} v${card.version}`);
      io.emit('file:updated', card);
    }
  });
});

watcher.on('unlink', (filePath) => {
  const fileName = path.basename(filePath);
  console.log(`[kanban-ws] File deleted: ${fileName}`);
  io.emit('file:deleted', { fileName });
});

io.on('connection', (socket) => {
  console.log(`[kanban-ws] Client connected: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`[kanban-ws] Client disconnected: ${socket.id}`);
  });
});
