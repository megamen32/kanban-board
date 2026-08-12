'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
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
import type { KanbanCard, KanbanCardUpdates } from '@/lib/kanban/types';
import { useIsMobile } from '@/hooks/use-mobile';
import { TaskListView } from './task-list-view';
import { filterCards, filterWorkspaceCards, getAssigneeOptions, getPeople, getProjectOptions, type WorkspaceView } from './view-model';
import { CardEditDialog } from './card-edit-dialog';
import { NotificationSettings } from '@/components/notifications/notification-settings';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getPlanningRoleBalance, getPlanningTabCards, type PlanningTab } from './view-model';
import { PlanningCardList, RoleBalanceView, WeeklyPlanView } from './planning-views';
import { getExecutionColumnCards } from './planning-views';
import { RolesDialog } from './roles-dialog';
import { InboxCapture } from './inbox-capture';

export function KanbanBoard() {
  const { cards, loading, conflict, createCard, updateCard, deleteCard, moveCard, reorderColumn, resolveConflict, refresh, weeklyDraft, weeklyLoading, weeklyError, fetchWeeklyDraft, acceptWeeklyPlan } = useKanban();
  const [showAdd, setShowAdd] = useState(false);
  const [defaultColumn, setDefaultColumn] = useState('inbox');
  const [view, setView] = useState<'kanban' | 'list'>('kanban');
  const [project, setProject] = useState('all');
  const [assignee, setAssignee] = useState('all');
  const [inboxOnly, setInboxOnly] = useState(false);
  const [selectedCard, setSelectedCard] = useState<KanbanCard | null>(null);
  const [planningTab, setPlanningTab] = useState<PlanningTab>('execution');
  const [username, setUsername] = useState<string | null>(null);
  const [person, setPerson] = useState('nikita');
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>('mine');
  const [showWelcome, setShowWelcome] = useState(false);
  const [showRoles, setShowRoles] = useState(false);
  const isMobile = useIsMobile();

  useEffect(() => {
    if (isMobile) setView('list');
  }, [isMobile]);

  useEffect(() => {
    fetch('/api/auth/session').then(response => response.ok ? response.json() : null).then(data => setUsername(data?.username ?? null)).catch(() => setUsername(null));
  }, []);

  useEffect(() => {
    const savedPerson = window.localStorage.getItem('kanban-person');
    const welcomed = window.localStorage.getItem('kanban-welcomed');
    if (savedPerson) setPerson(savedPerson);
    else setShowWelcome(true);
    if (!welcomed) setShowWelcome(true);
  }, []);

  const projectOptions = getProjectOptions(cards);
  const assigneeOptions = useMemo(() => getAssigneeOptions(cards), [cards]);
  const people = useMemo(() => getPeople(cards), [cards]);
  const visibleCards = filterWorkspaceCards(filterCards(cards, project, assignee), person, workspaceView).filter(card => !inboxOnly || card.column === 'inbox');

  useEffect(() => {
    if (assignee !== 'all' && !assigneeOptions.includes(assignee)) setAssignee('all');
  }, [assignee, assigneeOptions]);

  const getColumnCards = useCallback((columnId: string) =>
    getExecutionColumnCards(visibleCards, columnId as KanbanCard['column']).sort((a, b) => a.order - b.order),
    [visibleCards]
  );

  const handleAdd = (column: string) => { setDefaultColumn(column); setShowAdd(true); };
  const handleUpdate = useCallback(async (id: string, updates: KanbanCardUpdates, version?: number) => {
    return updateCard(id, updates, version);
  }, [updateCard]);

  const handleDelete = useCallback(async (id: string) => { await deleteCard(id); }, [deleteCard]);
  const now = new Date();
  const derivedCards = useMemo(() => getPlanningTabCards(visibleCards, planningTab, now), [planningTab, visibleCards]);
  const roleBalance = useMemo(() => getPlanningRoleBalance(visibleCards, now), [visibleCards]);

  const handlePlanningTabChange = (value: string) => {
    const next = value as PlanningTab;
    setPlanningTab(next);
    if (next === 'week' && !weeklyDraft) void fetchWeeklyDraft();
  };

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
        <div className="px-3 sm:px-6 pt-3 sm:pt-4 pb-2 border-b">
          <div className="flex items-center gap-2 sm:gap-3">
            <FolderSync className="h-5 w-5 shrink-0 text-muted-foreground" />
            <h1 className="font-bold text-lg">My Kanban</h1>
            <span className="text-xs text-muted-foreground">{visibleCards.length} задач</span>
            <div className="ml-auto flex shrink-0 items-center gap-1 rounded-md border p-0.5">
              <Button variant={view === 'kanban' ? 'secondary' : 'ghost'} size="sm" className="h-7 px-2 text-xs" onClick={() => setView('kanban')}>Kanban</Button>
              <Button variant={view === 'list' ? 'secondary' : 'ghost'} size="sm" className="h-7 px-2 text-xs" onClick={() => setView('list')}>Список</Button>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select aria-label="Кто вы" value={person} onChange={event => { setPerson(event.target.value); window.localStorage.setItem('kanban-person', event.target.value); }} className="h-8 max-w-[130px] rounded-md border bg-background px-2 text-xs">
              {people.length === 0 && <option value="nikita">nikita</option>}
              {people.map(item => <option key={item} value={item}>{item}</option>)}
            </select>
            <div className="flex rounded-md border p-0.5">
              {([['mine', 'Моё'], ['shared', 'Общее'], ['all', 'Всё']] as const).map(([value, label]) => <Button key={value} variant={workspaceView === value ? 'secondary' : 'ghost'} size="sm" className="h-7 px-2 text-xs" onClick={() => setWorkspaceView(value)}>{label}</Button>)}
            </div>
            <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => setShowRoles(true)}>Роли</Button>
            <select aria-label="Фильтр проекта" value={project} onChange={event => setProject(event.target.value)} className="h-8 min-w-0 max-w-[150px] rounded-md border bg-background px-2 text-xs">
              <option value="all">Все проекты</option>
              {projectOptions.map(option => <option key={option} value={option}>{option}</option>)}
            </select>
            <label className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
              <span className="whitespace-nowrap">Моя роль:</span>
              <select aria-label="Фильтр по роли" title="Показывать карточки по роли" value={assignee} onChange={event => setAssignee(event.target.value)} className="h-8 min-w-0 max-w-[150px] rounded-md border bg-background px-2 text-xs text-foreground">
                <option value="all">Все карточки</option>
                {assigneeOptions.map(option => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <Button variant={inboxOnly ? 'secondary' : 'ghost'} size="sm" className="h-8 px-2 text-xs" onClick={() => setInboxOnly(value => !value)}>Inbox</Button>
            <NotificationSettings />
            <Button variant="ghost" size="sm" className="h-8 px-2 text-xs sm:ml-auto" onClick={refresh}>
              <RotateCw className="h-3.5 w-3.5 sm:mr-1" /> <span className="hidden sm:inline">Обновить</span>
            </Button>
          </div>
        </div>
        <Tabs value={planningTab} onValueChange={handlePlanningTabChange} className="flex min-h-0 flex-1">
          <div className="overflow-x-auto border-b px-3 py-2 sm:px-6">
            <TabsList className="h-10 w-full min-w-max justify-start bg-transparent p-0">
              <TabsTrigger value="execution">Execution</TabsTrigger>
              <TabsTrigger value="inbox">Inbox</TabsTrigger>
              <TabsTrigger value="week">Week</TabsTrigger>
              <TabsTrigger value="today">Today</TabsTrigger>
              <TabsTrigger value="balance">Role balance</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="execution" className="min-h-0">
            {view === 'list' ? (
          <TaskListView cards={getPlanningTabCards(visibleCards, 'execution')} onStatusChange={(id, column, version) => updateCard(id, { column }, version)} onOpen={setSelectedCard} />
            ) : (
          <div className="flex gap-3 sm:gap-4 p-3 sm:p-6 overflow-x-auto overscroll-x-contain flex-1">
            {DEFAULT_COLUMNS.filter(col => col.id !== 'archived').map(col => (
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
          </TabsContent>
          <TabsContent value="inbox" className="min-h-0 overflow-y-auto space-y-3 p-3 sm:p-6"><InboxCapture owner={person} onCaptured={refresh} /><PlanningCardList cards={derivedCards} onOpen={setSelectedCard} empty="Inbox пока пуст" /></TabsContent>
          <TabsContent value="week" className="min-h-0 overflow-y-auto p-3 sm:p-6"><WeeklyPlanView cards={visibleCards} draft={weeklyDraft} loading={weeklyLoading} error={weeklyError} canAccept={username === 'nikita'} onLoad={() => void fetchWeeklyDraft()} onAccept={ids => acceptWeeklyPlan(ids)} onOpen={setSelectedCard} /></TabsContent>
          <TabsContent value="today" className="min-h-0 overflow-y-auto p-3 sm:p-6"><PlanningCardList cards={derivedCards} onOpen={setSelectedCard} empty="На сегодня задач нет" /></TabsContent>
          <TabsContent value="balance" className="min-h-0 overflow-y-auto p-3 sm:p-6"><RoleBalanceView balance={roleBalance} /></TabsContent>
        </Tabs>
        <Button className="fixed bottom-6 right-6 h-12 w-12 rounded-full shadow-lg z-50" onClick={() => { setDefaultColumn('todo'); setShowAdd(true); }}>
          <Plus className="h-5 w-5" />
        </Button>
        <AddCardDialog open={showAdd} onOpenChange={setShowAdd} defaultColumn={defaultColumn} onCreate={createCard} />
        {selectedCard && <CardEditDialog card={selectedCard} open onOpenChange={open => { if (!open) setSelectedCard(null); }} onUpdate={handleUpdate} onDelete={handleDelete} />}
        {conflict && <ConflictDialog conflict={conflict} onResolve={resolveConflict} />}
        <Dialog open={showWelcome} onOpenChange={setShowWelcome}>
          <DialogContent className="sm:max-w-md" showCloseButton={false}>
            <DialogHeader><DialogTitle>Ты кто?</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">Списки дел быстро становятся свалкой. Выбирай до трёх действий на сегодня; остальное — Inbox, неделя или Someday.</p>
            <select aria-label="Выберите себя" value={person} onChange={event => setPerson(event.target.value)} className="h-10 rounded-md border bg-background px-3">
              {people.length === 0 && <option value="nikita">nikita</option>}
              {people.map(item => <option key={item} value={item}>{item}</option>)}
            </select>
            <DialogFooter><Button onClick={() => { window.localStorage.setItem('kanban-person', person); window.localStorage.setItem('kanban-welcomed', '1'); setWorkspaceView('mine'); setShowWelcome(false); }}>Показать мои задачи</Button></DialogFooter>
          </DialogContent>
        </Dialog>
        <RolesDialog owner={person} open={showRoles} onOpenChange={setShowRoles} />
      </DndProvider>
    </CardActionsContext.Provider>
  );
}
