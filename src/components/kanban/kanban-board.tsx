'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useKanban } from '@/hooks/use-kanban';
import { DndProvider } from './dnd-provider';
import { KanbanColumnComponent } from './kanban-column';
import { AddCardDialog } from './add-card-dialog';
import { ConflictDialog } from './conflict-dialog';
import { CardActionsContext } from './kanban-card';
import { DEFAULT_COLUMNS } from '@/lib/kanban/types';
import { Plus, FolderSync, RotateCw, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { KanbanCard, KanbanCardUpdates, RoleDefinition } from '@/lib/kanban/types';
import type { HumanReviewAction } from '@/lib/kanban/transition-policy';
import { useIsMobile } from '@/hooks/use-mobile';
import { TaskListView } from './task-list-view';
import { filterCards, filterWorkspaceCards, getAssigneeOptions, getPeople, getProjectOptions, searchCards, isClosedCard, getBoardCounts, filterAttentionCards, type AttentionFilter, type WorkspaceView } from './view-model';
import { CardEditDialog } from './card-edit-dialog';
import { NotificationSettings } from '@/components/notifications/notification-settings';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getPlanningRoleBalance, getPlanningTabCards, type PlanningTab } from './view-model';
import { PlanningCardList, RoleBalanceView, WeeklyPlanView } from './planning-views';
import { getExecutionColumnCards } from './planning-views';
import { RolesDialog } from './roles-dialog';
import { InboxCapture } from './inbox-capture';
import { IntegratorTaskDashboard } from './integrator-task-dashboard';
import { parseBoardUrlState, serializeBoardUrlState, type BoardLayout, type ClosedKind } from './board-url-state';
import { describePlacement, automaticRevealScope, placeCreatedCard, type BoardScope } from './create-receipt';
import { mutationErrorMessage, readMutationResponse } from '../../lib/kanban/mutation-response';

export function KanbanBoard() {
  const { cards, projects, loading, conflict, createCard, updateCard, deleteCard, moveCard, reorderColumn, resolveConflict, refresh, weeklyDraft, weeklyLoading, weeklyError, fetchWeeklyDraft, acceptWeeklyPlan } = useKanban();
  const [showAdd, setShowAdd] = useState(false);
  const [defaultColumn, setDefaultColumn] = useState('inbox');
  const [view, setView] = useState<BoardLayout>('list');
  const [project, setProject] = useState('all');
  const [assignee, setAssignee] = useState('all');
  const [inboxOnly, setInboxOnly] = useState(false);
  const [selectedCard, setSelectedCard] = useState<KanbanCard | null>(null);
  const [planningTab, setPlanningTab] = useState<PlanningTab>('dashboard');
  const [username, setUsername] = useState<string | null>(null);
  const [identityChecked, setIdentityChecked] = useState(false);
  const [person, setPerson] = useState('nikita');
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>('shared');
  const [showWelcome, setShowWelcome] = useState(false);
  const [showRoles, setShowRoles] = useState(false);
  const [roles, setRoles] = useState<RoleDefinition[] | undefined>();
  const [roleError, setRoleError] = useState<string | null>(null);
  const [roleRefresh, setRoleRefresh] = useState(0);
  const [search, setSearch] = useState('');
  const [attention, setAttention] = useState<AttentionFilter>('all');
  const [closedKind, setClosedKind] = useState<ClosedKind>('all');
  const [receipt, setReceipt] = useState<{ card: KanbanCard; text: string } | null>(null);
  const [highlightCardId, setHighlightCardId] = useState<string | null>(null);
  const [urlReady, setUrlReady] = useState(false);
  const isMobile = useIsMobile();

  useEffect(() => {
    if (isMobile) setView('list');
  }, [isMobile]);

  useEffect(() => {
    fetch('/api/auth/session').then(response => response.ok ? response.json() : null).then(data => setUsername(data?.username ?? null)).catch(() => setUsername(null)).finally(() => setIdentityChecked(true));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setRoles(undefined); setRoleError(null);
    fetch(`/api/kanban/roles?owner=${encodeURIComponent(person)}`, { signal: controller.signal })
      .then(response => readMutationResponse(response))
      .then(data => { if (data.roles) setRoles(data.roles); })
      .catch(failure => { if (!controller.signal.aborted) setRoleError(mutationErrorMessage(failure)); });
    return () => controller.abort();
  }, [person, roleRefresh]);

  useEffect(() => {
    const savedPerson = window.localStorage.getItem('kanban-person');
    const welcomed = window.localStorage.getItem('kanban-welcomed');
    if (savedPerson) setPerson(savedPerson);
    else setShowWelcome(true);
    if (!welcomed) setShowWelcome(true);
  }, []);

  useEffect(() => {
    const initial = parseBoardUrlState(new URLSearchParams(window.location.search));
    if (initial.project) setProject(initial.project);
    if (initial.assignee) setAssignee(initial.assignee);
    if (initial.person) {
      setPerson(initial.person);
      setShowWelcome(false);
    }
    if (initial.search) setSearch(initial.search);
    if (initial.workspaceView) setWorkspaceView(initial.workspaceView);
    if (initial.layout) setView(initial.layout);
    if (initial.tab) setPlanningTab(initial.tab);
    if (initial.attention) setAttention(initial.attention);
    if (initial.closedKind) setClosedKind(initial.closedKind);
    if (initial.inboxOnly) setInboxOnly(true);
    if (initial.tab === 'week') void fetchWeeklyDraft();
    setUrlReady(true);
  }, [fetchWeeklyDraft]);

  useEffect(() => {
    if (!urlReady) return;
    const params = serializeBoardUrlState({
      project, workspaceView, layout: view, tab: planningTab, assignee, person,
      search, attention, closedKind, inboxOnly,
    });
    const next = window.location.pathname + '?' + params.toString() + window.location.hash;
    const current = window.location.pathname + window.location.search + window.location.hash;
    if (next !== current) window.history.replaceState(window.history.state, '', next);
  }, [assignee, attention, closedKind, inboxOnly, person, planningTab, project, search, urlReady, view, workspaceView]);

  const projectOptions = getProjectOptions(cards, projects);
  const assigneeOptions = useMemo(() => getAssigneeOptions(cards), [cards]);
  const people = useMemo(() => getPeople(cards), [cards]);
  const scopedCards = searchCards(filterWorkspaceCards(filterCards(cards, project, assignee), person, workspaceView), search);
  const counts = getBoardCounts(scopedCards);
  const closedCards = getPlanningTabCards(scopedCards, 'closed').filter(card => closedKind === 'all' || card.column === closedKind);
  const visibleCards = filterAttentionCards(scopedCards.filter(card => !isClosedCard(card)), attention).filter(card => !inboxOnly || card.column === 'inbox');

  useEffect(() => {
    if (!loading && assignee !== 'all' && !assigneeOptions.includes(assignee)) setAssignee('all');
  }, [assignee, assigneeOptions, loading]);

  const getColumnCards = useCallback((columnId: string) =>
    getExecutionColumnCards(visibleCards, columnId as KanbanCard['column']).sort((a, b) => a.order - b.order),
    [visibleCards]
  );

  const handleAdd = (column: string) => { setDefaultColumn(column); setShowAdd(true); };

  // The scope the board shows right now. A create can resolve after the user
  // changed a filter, so the receipt must read the live scope, not a closure.
  const scopeRef = useRef<BoardScope>({ workspaceView, person, project, assignee, attention, inboxOnly, planningTab });
  useEffect(() => {
    scopeRef.current = { workspaceView, person, project, assignee, attention, inboxOnly, planningTab };
  }, [assignee, attention, inboxOnly, person, planningTab, project, workspaceView]);

  // The workspace view is a filter, not an access rule: «Всё» can expose cards the
  // current view hides. The board therefore only narrows into the matching owner
  // or shared view, and never widens a filter on its own.
  const revealCreatedCard = useCallback((card: KanbanCard) => {
    const scope = scopeRef.current;
    const placement = placeCreatedCard(card, scope);
    const automatic = automaticRevealScope(card, scope, placement);
    const viewChange = automatic.workspaceView !== scope.workspaceView
      ? { from: scope.workspaceView, to: automatic.workspaceView }
      : undefined;
    if (automatic.workspaceView !== scope.workspaceView) setWorkspaceView(automatic.workspaceView);
    if (automatic.planningTab !== scope.planningTab) setPlanningTab(automatic.planningTab);
    const after = placeCreatedCard(card, automatic);
    setHighlightCardId(after.visibleNow ? card.id : null);
    setReceipt({ card, text: describePlacement(card, after, viewChange) });
  }, []);

  const handleCreate = useCallback(async (
    title: string,
    description: string,
    column: string,
    priority: string,
    tags: string[],
    cardProject: string,
    cardAssignees: string[],
    dueAt?: string,
    planning?: KanbanCardUpdates,
  ) => {
    const saved = await createCard(title, description, column, priority, tags, cardProject, cardAssignees, dueAt, planning);
    if (saved) revealCreatedCard(saved);
    return saved;
  }, [createCard, revealCreatedCard]);

  const handleUpdate = useCallback(async (id: string, updates: KanbanCardUpdates, version?: number) => {
    return updateCard(id, updates, version);
  }, [updateCard]);

  const handleDelete = useCallback(async (id: string) => deleteCard(id), [deleteCard]);
  const handleReviewDecision = useCallback(async (id: string, action: HumanReviewAction, note: string, version: number) => {
    const response = await fetch(`/api/kanban/cards/${encodeURIComponent(id)}/review`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, note, expectedVersion: version }),
    });
    const data = await readMutationResponse(response, true);
    if (data.conflict) return null;
    await refresh();
    return data.card ?? null;
  }, [refresh]);
  const now = new Date();
  const derivedCards = useMemo(() => getPlanningTabCards(visibleCards, planningTab, now), [planningTab, visibleCards]);
  const roleBalance = useMemo(() => getPlanningRoleBalance(visibleCards, now, roles), [visibleCards, roles]);

  const handlePlanningTabChange = (value: string) => {
    const next = value as PlanningTab;
    setPlanningTab(next);
    setAttention('all');
    if (next === 'closed') setInboxOnly(false);
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
    <CardActionsContext.Provider value={{ onUpdate: handleUpdate, onDelete: handleDelete, roles, username, refresh, highlightCardId }}>
      <DndProvider cards={visibleCards} onMoveCard={moveCard} onReorder={reorderColumn}>
        <div className="px-3 sm:px-6 pt-3 sm:pt-4 pb-2 border-b">
          <div className="flex items-center gap-2 sm:gap-3">
            <FolderSync className="h-5 w-5 shrink-0 text-muted-foreground" />
            <h1 className="font-bold text-lg">Задачи</h1>
            <span className="text-xs text-muted-foreground" aria-live="polite">{planningTab === 'closed' ? closedCards.length : visibleCards.length} задач</span>
            <div className="ml-auto flex shrink-0 items-center gap-1 rounded-md border p-0.5">
              <Button variant={view === 'kanban' ? 'secondary' : 'ghost'} size="sm" className="h-7 px-2 text-xs" onClick={() => setView('kanban')}>Доска</Button>
              <Button variant={view === 'list' ? 'secondary' : 'ghost'} size="sm" className="h-7 px-2 text-xs" onClick={() => setView('list')}>Блокнот</Button>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select aria-label="Фильтр по человеку" value={person} onChange={event => { setPerson(event.target.value); window.localStorage.setItem('kanban-person', event.target.value); }} className="h-8 max-w-[130px] rounded-md border bg-background px-2 text-xs">
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
              <span className="whitespace-nowrap">Ответственный:</span>
              <select aria-label="Фильтр по ответственному" title="Показывать карточки исполнителя" value={assignee} onChange={event => setAssignee(event.target.value)} className="h-8 min-w-0 max-w-[150px] rounded-md border bg-background px-2 text-xs text-foreground">
                <option value="all">Все карточки</option>
                {assigneeOptions.map(option => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <Button variant={inboxOnly ? 'secondary' : 'ghost'} size="sm" className="h-8 px-2 text-xs" onClick={() => { setInboxOnly(value => !value); setPlanningTab('execution'); }}>Входящие</Button>
            <NotificationSettings />
            <Button variant="ghost" size="sm" className="h-8 px-2 text-xs sm:ml-auto" onClick={refresh}>
              <RotateCw className="h-3.5 w-3.5 sm:mr-1" /> <span className="hidden sm:inline">Обновить</span>
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 pb-2">
            <input type="search" aria-label="Поиск задач" placeholder="Найти задачу, человека или источник" value={search} onChange={event => setSearch(event.target.value)} className="h-9 min-w-0 flex-1 basis-64 rounded-md border bg-background px-3 text-sm" />
            {planningTab !== 'closed' && <div className="flex flex-wrap gap-1">
              <Button variant={attention === 'all' ? 'secondary' : 'ghost'} size="sm" className="h-8 text-xs" onClick={() => setAttention('all')}>Активные: {counts.active}</Button>
              <Button variant={attention === 'blocked' ? 'secondary' : 'ghost'} size="sm" className="h-8 text-xs" onClick={() => { setAttention('blocked'); setInboxOnly(false); setPlanningTab('execution'); }}>Блокеры: {counts.blocked}</Button>
              <Button variant={attention === 'unassigned' ? 'secondary' : 'ghost'} size="sm" className="h-8 text-xs" onClick={() => { setAttention('unassigned'); setInboxOnly(false); setPlanningTab('execution'); }}>Без ответственного: {counts.unassigned}</Button>
            </div>}
          </div>
        </div>
        {receipt && (
          <div role="status" className="flex flex-wrap items-center gap-2 border-b border-emerald-600/30 bg-emerald-600/10 px-3 py-2 text-sm sm:px-6">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
            <p className="min-w-0 flex-1">{receipt.text}</p>
            <div className="flex shrink-0 items-center gap-1">
              <Button size="sm" variant="outline" onClick={() => setSelectedCard(receipt.card)}>Открыть</Button>
              <Button size="sm" variant="ghost" onClick={() => setReceipt(null)}>Понятно</Button>
            </div>
          </div>
        )}
        <Tabs value={planningTab} onValueChange={handlePlanningTabChange} className="flex min-h-0 flex-1">
          <div className="overflow-x-auto border-b px-3 py-2 sm:px-6">
            <TabsList className="h-auto min-h-10 w-full flex-wrap justify-start gap-1 bg-transparent p-0 sm:h-10 sm:min-w-max sm:flex-nowrap sm:gap-0">
              <TabsTrigger value="dashboard">Обзор</TabsTrigger>
              <TabsTrigger value="execution">Активные</TabsTrigger>
              <TabsTrigger value="inbox">Входящие</TabsTrigger>
              <TabsTrigger value="week">Неделя</TabsTrigger>
              <TabsTrigger value="today">Сегодня</TabsTrigger>
              <TabsTrigger value="balance">Баланс ролей</TabsTrigger>
              <TabsTrigger value="closed">Закрытые ({counts.done + counts.archived})</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="dashboard" className="min-h-0 overflow-y-auto">
            <IntegratorTaskDashboard cards={derivedCards} onOpen={setSelectedCard} onRefresh={refresh} />
          </TabsContent>
          <TabsContent value="execution" className="min-h-0 overflow-y-auto">
            {view === 'list' ? (
          <TaskListView cards={getPlanningTabCards(visibleCards, 'execution')} authoritativeCards={cards} highlightCardId={highlightCardId} onStatusChange={(id, column, version) => updateCard(id, { column }, version)} onOpen={setSelectedCard} />
            ) : (
          <div className="flex gap-3 sm:gap-4 p-3 sm:p-6 overflow-x-auto overscroll-x-contain flex-1">
            {DEFAULT_COLUMNS.filter(col => col.id !== 'archived' && col.id !== 'done').map(col => (
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
          <TabsContent value="inbox" className="min-h-0 overflow-y-auto space-y-3 p-3 sm:p-6"><InboxCapture owner={person} onCaptured={refresh} /><PlanningCardList cards={derivedCards} roles={roles} onOpen={setSelectedCard} empty="Входящих задач пока нет" /></TabsContent>
          <TabsContent value="week" className="min-h-0 overflow-y-auto p-3 sm:p-6"><WeeklyPlanView cards={visibleCards} roles={roles} draft={weeklyDraft} loading={weeklyLoading} error={weeklyError} canAccept={username === 'nikita'} onLoad={() => void fetchWeeklyDraft()} onAccept={ids => acceptWeeklyPlan(ids)} onOpen={setSelectedCard} /></TabsContent>
          <TabsContent value="today" className="min-h-0 overflow-y-auto p-3 sm:p-6"><PlanningCardList cards={derivedCards} roles={roles} onOpen={setSelectedCard} empty="На сегодня задач нет" /></TabsContent>
          <TabsContent value="balance" className="min-h-0 overflow-y-auto p-3 sm:p-6">{roleError && <p role="alert" className="text-sm text-destructive">{roleError}</p>}<RoleBalanceView balance={roleBalance} roles={roles} /></TabsContent>
          <TabsContent value="closed" className="min-h-0 overflow-y-auto">
            <div className="flex flex-wrap items-center gap-2 px-3 pt-3 sm:px-6">
              <p className="text-sm text-muted-foreground">Карточки сохранены. Отмена не считается выполнением.</p>
              <select aria-label="Фильтр закрытых задач" value={closedKind} onChange={event => setClosedKind(event.target.value as typeof closedKind)} className="h-9 rounded-md border bg-background px-2 text-sm">
                <option value="all">Все закрытые</option>
                <option value="done">Готово ({counts.done})</option>
                <option value="archived">Не планируется ({counts.archived})</option>
              </select>
            </div>
            <TaskListView cards={closedCards} authoritativeCards={cards} highlightCardId={highlightCardId} onStatusChange={(id, column, version) => updateCard(id, { column }, version)} onOpen={setSelectedCard} />
          </TabsContent>
        </Tabs>
        <Button className="fixed bottom-6 right-6 h-12 w-12 rounded-full shadow-lg z-50" aria-label="Новая задача" title="Новая задача" onClick={() => { setDefaultColumn('todo'); setShowAdd(true); }}>
          <Plus className="h-5 w-5" />
        </Button>
        <AddCardDialog projectOptions={projectOptions} defaultProject={project === 'all' ? '' : project} ownerPreview={identityChecked ? username ?? 'nikita' : null} roles={roles} open={showAdd} onOpenChange={setShowAdd} defaultColumn={defaultColumn} onCreate={handleCreate} />
        {selectedCard && <CardEditDialog projectOptions={projectOptions} relatedCards={cards} roles={roles} card={selectedCard} username={username} onRefresh={refresh} open onOpenChange={open => { if (!open) setSelectedCard(null); }} onUpdate={handleUpdate} onDelete={handleDelete} onReviewDecision={handleReviewDecision} />}
        {conflict && <ConflictDialog conflict={conflict} onResolve={resolveConflict} />}
        <Dialog open={showWelcome} onOpenChange={setShowWelcome}>
          <DialogContent className="sm:max-w-md" showCloseButton={false}>
            <DialogHeader><DialogTitle>Какой список открыть?</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">Выберите профиль, чтобы отфильтровать личные задачи, или откройте общие задачи команды. Профиль меняет только список на экране, а не владельца новой карточки. Завершённые и отменённые карточки доступны в разделе «Закрытые».</p>
            <select aria-label="Профиль для личного фильтра" value={person} onChange={event => setPerson(event.target.value)} className="h-10 rounded-md border bg-background px-3">
              {people.length === 0 && <option value="nikita">nikita</option>}
              {people.map(item => <option key={item} value={item}>{item}</option>)}
            </select>
            <DialogFooter>
              <Button variant="outline" onClick={() => { window.localStorage.setItem('kanban-person', person); window.localStorage.setItem('kanban-welcomed', '1'); setWorkspaceView('shared'); setShowWelcome(false); }}>Общая доска</Button>
              <Button onClick={() => { window.localStorage.setItem('kanban-person', person); window.localStorage.setItem('kanban-welcomed', '1'); setWorkspaceView('mine'); setShowWelcome(false); }}>Мои задачи</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <RolesDialog owner={person} open={showRoles} onOpenChange={setShowRoles} onSaved={() => setRoleRefresh(value => value + 1)} />
      </DndProvider>
    </CardActionsContext.Provider>
  );
}
