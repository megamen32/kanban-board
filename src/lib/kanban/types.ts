export interface KanbanCard {
  id: string;
  title: string;
  description: string;
  column: KanbanColumn;
  priority: Priority;
  tags: string[];
  order: number;
  created: string;
  updated: string;
  dueAt?: string;
  fileName: string;
  version: number;
  project: string;
  assignees: string[];
}

export type KanbanCardUpdates = Partial<Pick<KanbanCard, 'title' | 'description' | 'column' | 'priority' | 'tags' | 'order' | 'project' | 'assignees'>> & {
  dueAt?: string | null;
};

export type KanbanColumn = 'inbox' | 'todo' | 'in-progress' | 'review' | 'done' | 'archived';
export type Priority = 'low' | 'medium' | 'high' | 'critical';

export const DEFAULT_COLUMNS: { id: KanbanColumn; title: string; color: string }[] = [
  { id: 'inbox',      title: 'Inbox',       color: 'bg-slate-500' },
  { id: 'todo',       title: 'To Do',        color: 'bg-zinc-500' },
  { id: 'in-progress', title: 'In Progress',  color: 'bg-amber-500' },
  { id: 'review',     title: 'Review',       color: 'bg-violet-500' },
  { id: 'done',       title: 'Done',         color: 'bg-emerald-500' },
  { id: 'archived',   title: 'Archived',     color: 'bg-stone-400' },
];

export const PRIORITY_COLORS: Record<Priority, string> = {
  low:      'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
  medium:   'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  high:     'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  critical: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
};

export interface SyncEvent {
  type: 'created' | 'updated' | 'deleted' | 'moved' | 'reordered';
  card: KanbanCard;
  timestamp: string;
}

export interface ConflictInfo {
  cardId: string;
  serverVersion: number;
  clientVersion: number;
  serverCard: KanbanCard;
  clientCard: KanbanCard;
}
