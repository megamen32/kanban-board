'use client';

import { useState, useCallback, useEffect } from 'react';
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
import { useIsMobile } from '@/hooks/use-mobile';
import { TaskListView } from './task-list-view';
import { filterCards, getProjectOptions } from './view-model';
import { CardEditDialog } from './card-edit-dialog';

export function KanbanBoard() {
  const { cards, loading, conflict, createCard, updateCard, deleteCard, moveCard, reorderColumn, resolveConflict, refresh } = useKanban();
  const [showAdd, setShowAdd] = useState(false);
  const [defaultColumn, setDefaultColumn] = useState('inbox');
  const [view, setView] = useState<'kanban' | 'list'>('kanban');
  const [project, setProject] = useState('all');
  const [inboxOnly, setInboxOnly] = useState(false);
  const [selectedCard, setSelectedCard] = useState<KanbanCard | null>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    if (isMobile) setView('list');
  }, [isMobile]);

  const projectOptions = getProjectOptions(cards);
  const visibleCards = filterCards(cards, project).filter(card => !inboxOnly || card.column === 'inbox');

  const getColumnCards = useCallback((columnId: string) =>
    visibleCards.filter(c => c.column === columnId).sort((a, b) => a.order - b.order),
    [visibleCards]
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
      <DndProvider cards={visibleCards} onMoveCard={moveCard} onReorder={reorderColumn}>
        <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-6 pt-3 sm:pt-4 pb-2 border-b">
          <FolderSync className="h-5 w-5 text-muted-foreground" />
          <h1 className="font-bold text-lg">TODO Kanban</h1>
          <span className="text-xs text-muted-foreground">{visibleCards.length} задач</span>
          <div className="ml-2 flex items-center gap-1 rounded-md border p-0.5">
            <Button variant={view === 'kanban' ? 'secondary' : 'ghost'} size="sm" className="h-7 px-2 text-xs" onClick={() => setView('kanban')}>Kanban</Button>
            <Button variant={view === 'list' ? 'secondary' : 'ghost'} size="sm" className="h-7 px-2 text-xs" onClick={() => setView('list')}>Список</Button>
          </div>
          <select aria-label="Фильтр проекта" value={project} onChange={event => setProject(event.target.value)} className="h-8 max-w-[150px] rounded-md border bg-background px-2 text-xs">
            <option value="all">Все проекты</option>
            {projectOptions.map(option => <option key={option} value={option}>{option}</option>)}
          </select>
          <Button variant={inboxOnly ? 'secondary' : 'ghost'} size="sm" className="h-8 px-2 text-xs" onClick={() => setInboxOnly(value => !value)}>Inbox</Button>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={refresh}>
            <RotateCw className="h-3.5 w-3.5 mr-1" /> Обновить
          </Button>
        </div>
        {view === 'list' ? (
          <TaskListView cards={visibleCards} onStatusChange={(id, column, version) => updateCard(id, { column }, version)} onOpen={setSelectedCard} />
        ) : (
          <div className="flex gap-3 sm:gap-4 p-3 sm:p-6 overflow-x-auto overscroll-x-contain flex-1">
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
        )}
        <Button className="fixed bottom-6 right-6 h-12 w-12 rounded-full shadow-lg z-50" onClick={() => { setDefaultColumn('todo'); setShowAdd(true); }}>
          <Plus className="h-5 w-5" />
        </Button>
        <AddCardDialog open={showAdd} onOpenChange={setShowAdd} defaultColumn={defaultColumn} onCreate={createCard} />
        {selectedCard && <CardEditDialog card={selectedCard} open onOpenChange={open => { if (!open) setSelectedCard(null); }} onUpdate={handleUpdate} onDelete={handleDelete} />}
        {conflict && <ConflictDialog conflict={conflict} onResolve={resolveConflict} />}
      </DndProvider>
    </CardActionsContext.Provider>
  );
}
