'use client';

import { useState, useCallback } from 'react';
import { useKanban } from '@/hooks/use-kanban';
import { DndProvider } from './dnd-provider';
import { KanbanColumnComponent } from './kanban-column';
import { AddCardDialog } from './add-card-dialog';
import { ConflictDialog } from './conflict-dialog';
import { CardActionsContext } from './kanban-card';
import { DEFAULT_COLUMNS } from '@/lib/kanban/types';
import { Plus, FolderSync, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { KanbanCard } from '@/lib/kanban/types';

export function KanbanBoard() {
  const { cards, loading, conflict, createCard, updateCard, deleteCard, moveCard, reorderColumn, resolveConflict, refresh } = useKanban();
  const [showAdd, setShowAdd] = useState(false);
  const [defaultColumn, setDefaultColumn] = useState('inbox');

  const getColumnCards = useCallback((columnId: string) =>
    cards.filter(c => c.column === columnId).sort((a, b) => a.order - b.order),
    [cards]
  );

  const handleAdd = (column: string) => { setDefaultColumn(column); setShowAdd(true); };
  const handleUpdate = useCallback(async (id: string, updates: Partial<KanbanCard>, version?: number) => {
    return updateCard(id, updates, version);
  }, [updateCard]);

  const handleDelete = useCallback(async (id: string) => { await deleteCard(id); }, [deleteCard]);

  if (loading) {
    return (
      <div className="flex gap-4 p-6 overflow-x-auto h-full">
        {DEFAULT_COLUMNS.map(col => (
          <div key={col.id} className="min-w-[300px] w-[300px] shrink-0">
            <Skeleton className="h-8 w-24 mb-4" />
            <div className="space-y-3"><Skeleton className="h-28 w-full rounded-lg" /><Skeleton className="h-28 w-full rounded-lg" /></div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <CardActionsContext.Provider value={{ onUpdate: handleUpdate, onDelete: handleDelete }}>
      <DndProvider cards={cards} onMoveCard={moveCard} onReorder={reorderColumn}>
        <div className="flex items-center gap-3 px-6 pt-4 pb-2 border-b">
          <FolderSync className="h-5 w-5 text-muted-foreground" />
          <h1 className="font-bold text-lg">TODO Kanban</h1>
          <span className="text-xs text-muted-foreground">{cards.length} задач</span>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={refresh}>
            <RotateCw className="h-3.5 w-3.5 mr-1" /> Обновить
          </Button>
        </div>
        <div className="flex gap-4 p-6 overflow-x-auto flex-1">
          {DEFAULT_COLUMNS.map(col => (
            <KanbanColumnComponent
              key={col.id}
              id={col.id}
              title={col.title}
              color={col.color}
              cards={getColumnCards(col.id)}
              onAddCard={() => handleAdd(col.id)}
            />
          ))}
        </div>
        <Button className="fixed bottom-6 right-6 h-12 w-12 rounded-full shadow-lg z-50" onClick={() => { setDefaultColumn('todo'); setShowAdd(true); }}>
          <Plus className="h-5 w-5" />
        </Button>
        <AddCardDialog open={showAdd} onOpenChange={setShowAdd} defaultColumn={defaultColumn} onCreate={createCard} />
        {conflict && <ConflictDialog conflict={conflict} onResolve={resolveConflict} />}
      </DndProvider>
    </CardActionsContext.Provider>
  );
}