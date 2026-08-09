'use client';

import { KanbanBoard } from '@/components/kanban/kanban-board';
import { AuthGate } from '@/components/auth/auth-gate';

export default function Home() {
  return (
    <AuthGate><div className="h-screen flex flex-col bg-background overflow-hidden"><KanbanBoard /></div></AuthGate>
  );
}
