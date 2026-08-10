'use client';

import { KanbanBoard } from '@/components/kanban/kanban-board';

export default function Home() {
  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden"><KanbanBoard /></div>
  );
}
