import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { v4 as uuidv4 } from 'uuid';
import type { KanbanCard, KanbanColumn, Priority } from './types';

const TASKS_DIR = process.env.TASKS_DIR || path.join(process.cwd(), 'data', 'tasks');

function ensureDir() {
  if (!fs.existsSync(/*turbopackIgnore: true*/ TASKS_DIR)) {
    fs.mkdirSync(/*turbopackIgnore: true*/ TASKS_DIR, { recursive: true });
  }
}

function sanitizeFileName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9а-яА-ЯёЁ\-_. ]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim() || 'untitled';
}

function slugify(title: string, id: string): string {
  const slug = sanitizeFileName(title);
  const shortId = id.split('-')[0];
  return `${slug}-${shortId}.md`;
}

export function getAllCards(): KanbanCard[] {
  ensureDir();
  const files = fs.readdirSync(TASKS_DIR).filter(f => f.endsWith('.md'));
  const cards: KanbanCard[] = [];

  for (const file of files) {
    try {
      const card = readCardFile(path.join(TASKS_DIR, file));
      if (card) cards.push(card);
    } catch (e) {
      console.error(`Error reading ${file}:`, e);
    }
  }

  return cards.sort((a, b) => a.order - b.order);
}

export function readCardFile(filePath: string): KanbanCard | null {
  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, 'utf-8');
  const { data, content } = matter(raw);
  const fileName = path.basename(filePath);

  return {
    id: data.id || fileName.replace('.md', ''),
    title: data.title || fileName.replace(/-[^-]+\.md$/, '').replace(/-/g, ' '),
    description: content.trim(),
    column: (data.column as KanbanColumn) || 'inbox',
    priority: (data.priority as Priority) || 'medium',
    tags: Array.isArray(data.tags) ? data.tags : [],
    order: typeof data.order === 'number' ? data.order : 0,
    created: data.created || new Date(fs.statSync(/*turbopackIgnore: true*/ filePath).birthtime).toISOString(),
    updated: data.updated || new Date(fs.statSync(/*turbopackIgnore: true*/ filePath).mtime).toISOString(),
    fileName,
    version: typeof data.version === 'number' ? data.version : 1,
  };
}

export function createCard(title: string, description: string = '', column: KanbanColumn = 'inbox', priority: Priority = 'medium', tags: string[] = []): KanbanCard {
  ensureDir();
  const id = uuidv4();
  const now = new Date().toISOString();
  const existing = getAllCards().filter(c => c.column === column);
  const maxOrder = existing.length > 0 ? Math.max(...existing.map(c => c.order)) + 1 : 0;

  const card: KanbanCard = {
    id,
    title,
    description,
    column,
    priority,
    tags,
    order: maxOrder,
    created: now,
    updated: now,
    fileName: slugify(title, id),
    version: 1,
  };

  writeCard(card);
  return card;
}

export function updateCard(id: string, updates: Partial<Pick<KanbanCard, 'title' | 'description' | 'column' | 'priority' | 'tags' | 'order' | 'version'>>, expectedVersion?: number): KanbanCard | { conflict: true; serverCard: KanbanCard } {
  const card = findCardById(id);
  if (!card) throw new Error(`Card ${id} not found`);

  // Conflict detection
  if (expectedVersion !== undefined && card.version !== expectedVersion) {
    return { conflict: true, serverCard: card };
  }

  const updated: KanbanCard = {
    ...card,
    ...updates,
    updated: new Date().toISOString(),
    version: card.version + 1,
  };

  // If title changed, rename file
  if (updates.title && updates.title !== card.title) {
    const oldPath = path.join(TASKS_DIR, card.fileName);
    if (fs.existsSync(oldPath)) fs.unlinkSync(/*turbopackIgnore: true*/ oldPath);
    updated.fileName = slugify(updates.title, id);
  }

  writeCard(updated);
  return updated;
}

export function deleteCard(id: string): boolean {
  const card = findCardById(id);
  if (!card) return false;

  const filePath = path.join(TASKS_DIR, card.fileName);
  if (fs.existsSync(filePath)) fs.unlinkSync(/*turbopackIgnore: true*/ filePath);
  return true;
}

export function moveCard(id: string, newColumn: KanbanColumn, newOrder?: number): KanbanCard | { conflict: true; serverCard: KanbanCard } {
  return updateCard(id, {
    column: newColumn,
    ...(newOrder !== undefined ? { order: newOrder } : {}),
  });
}

export function reorderColumn(column: KanbanColumn, cardIds: string[]): KanbanCard[] {
  const results: KanbanCard[] = [];
  cardIds.forEach((id, index) => {
    const card = findCardById(id);
    if (card && card.column === column) {
      const updated = updateCard(id, { order: index }) as KanbanCard;
      results.push(updated);
    }
  });
  return results;
}

export function findCardById(id: string): KanbanCard | null {
  ensureDir();
  const files = fs.readdirSync(TASKS_DIR).filter(f => f.endsWith('.md'));
  for (const file of files) {
    const card = readCardFile(path.join(TASKS_DIR, file));
    if (card && card.id === id) return card;
  }
  return null;
}

export function importExistingFile(filePath: string): KanbanCard | null {
  if (!fs.existsSync(filePath) || !filePath.endsWith('.md')) return null;

  const card = readCardFile(filePath);
  if (!card) return null;

  // Check if already imported (by id or filename)
  const existing = findCardById(card.id);
  if (existing) return existing;

  // Assign UUID if missing
  if (!card.id || card.id === card.fileName.replace('.md', '')) {
    card.id = uuidv4();
  }

  // Write to tasks dir
  const destPath = path.join(TASKS_DIR, slugify(card.title, card.id));
  const frontmatter = buildFrontmatter(card);
  fs.writeFileSync(destPath, frontmatter + (card.description ? '\n' + card.description : ''));

  return card;
}

export function getTasksDir(): string {
  return TASKS_DIR;
}

function yamlString(value: string): string {
  // JSON string literals are valid YAML scalars and safely encode quotes,
  // newlines, colons, and backslashes without producing invalid frontmatter.
  return JSON.stringify(value);
}

function buildFrontmatter(card: KanbanCard): string {
  const data: Record<string, unknown> = {
    id: card.id,
    title: card.title,
    column: card.column,
    priority: card.priority,
    tags: card.tags,
    order: card.order,
    created: card.created,
    updated: card.updated,
    version: card.version,
  };

  const lines = Object.entries(data).map(([key, value]) => {
    if (Array.isArray(value)) return `${key}: [${value.map(v => yamlString(String(v))).join(', ')}]`;
    if (typeof value === 'string') return `${key}: ${yamlString(value)}`;
    return `${key}: ${value}`;
  });

  return '---\n' + lines.join('\n') + '\n---';
}

function writeCard(card: KanbanCard): void {
  ensureDir();
  const filePath = path.join(TASKS_DIR, card.fileName);
  const frontmatter = buildFrontmatter(card);
  fs.writeFileSync(filePath, frontmatter + (card.description ? '\n' + card.description : ''));
}
