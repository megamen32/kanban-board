'use client';

import { KanbanBoard } from '@/components/kanban/kanban-board';
import { AuthGate } from '@/components/auth/auth-gate';

export default function ClassicBoardPage() {
  return <AuthGate><div className="flex h-dvh flex-col overflow-hidden bg-background">
    <a className="border-b px-4 py-2 text-sm text-primary underline" href="/">Вернуться в Контур</a>
    <KanbanBoard />
  </div></AuthGate>;
}
