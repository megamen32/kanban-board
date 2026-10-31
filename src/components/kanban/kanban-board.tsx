'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useKanban } from '@/hooks/use-kanban';
import { DndProvider } from './dnd-provider';
import { KanbanColumnComponent } from './kanban-column';
import { AddCardDialog } from './add-card-dialog';
import { ConflictDialog } from './conflict-dialog';
import { CardActionsContext } from './kanban-card';
import { DEFAULT_COLUMNS } from '@/lib/kanban/types';
import {
  Activity,
  Archive,
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Columns3,
  FolderSync,
  GitFork,
  Inbox,
  LayoutDashboard,
  ListTodo,
  Plus,
  RotateCw,
  Search,
  SlidersHorizontal,
  UserX,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { KanbanCard, KanbanCardUpdates, RoleDefinition } from '@/lib/kanban/types';
import { NIKITA_ACTOR, type HumanReviewAction } from '@/lib/kanban/transition-policy';
import { useIsMobile } from '@/hooks/use-mobile';
import { CardGraphView } from './card-graph-view';
import { TaskListView } from './task-list-view';
import { filterCards, filterWorkspaceCards, getAssigneeOptions, getProjectOptions, getPrimaryBoardLaneCards, searchCards, isClosedCard, getBoardCounts, filterAttentionCards, resolveInitialWorkspaceView, WORKSPACE_HINT, type AttentionFilter, type WorkspaceView } from './view-model';
import { CardEditDialog } from './card-edit-dialog';
import { NotificationSettings } from '@/components/notifications/notification-settings';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getPlanningRoleBalance, getPlanningTabCards, type PlanningTab } from './view-model';
import { PlanningCardList, RoleBalanceView, WeeklyPlanView } from './planning-views';
import { RolesDialog } from './roles-dialog';
import { InboxCapture } from './inbox-capture';
import { IntegratorTaskDashboard } from './integrator-task-dashboard';
import { parseBoardUrlState, serializeBoardUrlState, resolveBoardLayout, type BoardLayout, type ClosedKind } from './board-url-state';
import { describePlacement, automaticRevealScope, placeCreatedCard, type BoardScope } from './create-receipt';
import { mutationErrorMessage, readMutationResponse } from '../../lib/kanban/mutation-response';

const PRIMARY_BOARD_COLUMNS = [
  { ...DEFAULT_COLUMNS.find(column => column.id === 'todo')!, title: 'Входящие' },
  { ...DEFAULT_COLUMNS.find(column => column.id === 'in-progress')!, title: 'В работе' },
  { ...DEFAULT_COLUMNS.find(column => column.id === 'review')!, title: 'На проверке' },
] as const;

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
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>('mine');
  const [showRoles, setShowRoles] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
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
    if (isMobile) setView(current => resolveBoardLayout(current, true));
  }, [isMobile]);

  useEffect(() => {
    fetch('/api/auth/session')
      .then(response => response.ok ? response.json() : null)
      .then(data => {
        const actor = data?.username ?? null;
        setUsername(actor);
        setPerson(actor ?? 'nikita');
        if (actor !== NIKITA_ACTOR) setWorkspaceView('mine');
      })
      .catch(() => { setUsername(null); setPerson('nikita'); setWorkspaceView('mine'); })
      .finally(() => setIdentityChecked(true));
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
    if (!identityChecked) return;
    const initial = parseBoardUrlState(new URLSearchParams(window.location.search));
    if (initial.project) setProject(initial.project);
    if (initial.assignee) setAssignee(initial.assignee);
    if (initial.search) setSearch(initial.search);
    setWorkspaceView(resolveInitialWorkspaceView(window.location.hostname, username, initial.workspaceView));
    if (initial.layout) setView(resolveBoardLayout(initial.layout, isMobile));
    if (initial.tab && (initial.tab !== 'balance' || username === NIKITA_ACTOR)) setPlanningTab(initial.tab);
    if (initial.attention) setAttention(initial.attention);
    if (initial.closedKind) setClosedKind(initial.closedKind);
    if (initial.inboxOnly) setInboxOnly(true);
    if (initial.tab === 'week') void fetchWeeklyDraft();
    setUrlReady(true);
  }, [fetchWeeklyDraft, identityChecked, isMobile, username]);

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
  const scopedCards = searchCards(filterWorkspaceCards(filterCards(cards, project, assignee), person, workspaceView), search);
  const counts = getBoardCounts(scopedCards);
  const closedCards = getPlanningTabCards(scopedCards, 'closed').filter(card => closedKind === 'all' || card.column === closedKind);
  const visibleCards = filterAttentionCards(scopedCards.filter(card => !isClosedCard(card)), attention)
    .filter(card => !inboxOnly || ['inbox', 'todo', 'someday'].includes(card.column));

  useEffect(() => {
    if (!loading && assignee !== 'all' && !assigneeOptions.includes(assignee)) setAssignee('all');
  }, [assignee, assigneeOptions, loading]);

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

  const handleAssignReviewer = useCallback(async (id: string, reviewer: string, version: number) => {
    return updateCard(id, { requiresApprovalFrom: [reviewer] }, version);
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

  const isSuperAdmin = username === NIKITA_ACTOR;
  const identityLabel = username ?? 'Локальный просмотр';
  const workspaceSwitcher = (
    <div aria-label="Область задач" className="flex shrink-0 rounded-md border p-0.5">
      {([['mine', 'Моё'], ['shared', 'Общее'], ['all', 'Всё']] as const).map(([value, label]) => <Button key={value} title={WORKSPACE_HINT[value]} aria-label={`${label}: ${WORKSPACE_HINT[value]}`} variant={workspaceView === value ? 'secondary' : 'ghost'} size="sm" className="h-6 px-2 text-[11px]" onClick={() => setWorkspaceView(value)}>{label}</Button>)}
    </div>
  );
  const projectFilter = (
    <select aria-label="Фильтр проекта" title="Проект" value={project} onChange={event => setProject(event.target.value)} className="h-7 min-w-0 max-w-36 rounded-md border bg-background px-2 text-xs">
      <option value="all">Все проекты</option>
      {projectOptions.map(option => <option key={option} value={option}>{option}</option>)}
    </select>
  );
  const assigneeFilter = (
    <select aria-label="Фильтр по ответственному" title="Показывать карточки исполнителя" value={assignee} onChange={event => setAssignee(event.target.value)} className="h-7 w-full min-w-0 rounded-md border bg-background px-2 text-xs">
      <option value="all">Все карточки</option>
      {assigneeOptions.map(option => <option key={option} value={option}>{option}</option>)}
    </select>
  );
  const renderAttentionFilters = () => planningTab !== 'closed' && (
    <div className="flex items-center gap-1">
      <Button aria-label={`Активные: ${counts.active}`} title={`Активные: ${counts.active}`} variant={attention === 'all' ? 'secondary' : 'ghost'} size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => setAttention('all')}><Activity aria-hidden className="h-3.5 w-3.5" /><span>{counts.active}</span></Button>
      <Button aria-label={`Блокеры: ${counts.blocked}`} title={`Блокеры: ${counts.blocked}`} variant={attention === 'blocked' ? 'secondary' : 'ghost'} size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => { setAttention('blocked'); setInboxOnly(false); setPlanningTab('execution'); }}><CircleAlert aria-hidden className="h-3.5 w-3.5" /><span>{counts.blocked}</span></Button>
      <Button aria-label={`Без ответственного: ${counts.unassigned}`} title={`Без ответственного: ${counts.unassigned}`} variant={attention === 'unassigned' ? 'secondary' : 'ghost'} size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => { setAttention('unassigned'); setInboxOnly(false); setPlanningTab('execution'); }}><UserX aria-hidden className="h-3.5 w-3.5" /><span>{counts.unassigned}</span></Button>
    </div>
  );

  const handlePlanningTabChange = (value: string) => {
    const next = value as PlanningTab;
    setPlanningTab(next);
    setFiltersOpen(false);
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
    <CardActionsContext.Provider value={{ onUpdate: handleUpdate, onDelete: handleDelete, roles, username, refresh, highlightCardId, relatedCards: visibleCards, breadcrumbCards: scopedCards, onSelectCard: setSelectedCard }}>
      <DndProvider cards={visibleCards} onMoveCard={moveCard} onReorder={reorderColumn}>
        <div className="relative z-20 shrink-0 border-b px-2 py-1.5 sm:px-4">
          <div className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap">
            <div className="flex shrink-0 items-center gap-1.5">
              <FolderSync aria-hidden className="h-4 w-4 text-muted-foreground" />
              <h1 className="text-sm font-semibold">Задачи</h1>
              <span className="hidden text-[11px] text-muted-foreground sm:inline" aria-live="polite">{planningTab === 'closed' ? closedCards.length : visibleCards.length}</span>
            </div>
            <label className="relative order-last w-full min-w-0 sm:order-none sm:flex-1">
              <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input type="search" aria-label="Поиск задач" placeholder="Найти задачу или человека" value={search} onChange={event => setSearch(event.target.value)} className="h-8 w-full min-w-0 rounded-md border bg-background pl-8 pr-2 text-sm" />
            </label>
            <div className="ml-auto flex shrink-0 items-center gap-0.5">
              <div className="hidden items-center gap-0.5 md:flex">{renderAttentionFilters()}</div>
              {planningTab !== 'execution' && (
                <Button aria-label="Открыть граф задач" title="Открыть граф задач" variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => { handlePlanningTabChange('execution'); setView('graph'); }}>
                  <GitFork aria-hidden className="h-4 w-4" />Граф
                </Button>
              )}
              {planningTab === 'execution' && <div className="flex items-center gap-0.5 rounded-md border p-0.5">
                {!isMobile && <Button aria-label="Канбан" title="Канбан" aria-pressed={view === 'kanban'} variant={view === 'kanban' ? 'secondary' : 'ghost'} size="sm" className="h-7 w-7 p-0" onClick={() => setView('kanban')}><Columns3 aria-hidden className="h-4 w-4" /></Button>}
                <Button aria-label="Список" title="Список" aria-pressed={view === 'list'} variant={view === 'list' ? 'secondary' : 'ghost'} size="sm" className="h-7 w-7 p-0" onClick={() => setView('list')}><ListTodo aria-hidden className="h-4 w-4" /></Button>
                <Button aria-label="Граф" title="Граф" aria-pressed={view === 'graph'} variant={view === 'graph' ? 'secondary' : 'ghost'} size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => setView('graph')}><GitFork aria-hidden className="h-4 w-4" />Граф</Button>
              </div>}
              <Button aria-label="Обновить" title="Обновить" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={refresh}><RotateCw aria-hidden className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
            <div className="hidden min-w-0 items-center gap-1 sm:flex">
              {identityChecked && <span className="max-w-24 truncate px-1 text-xs text-muted-foreground" title={username ? `Вы вошли как ${username}` : 'Локальный просмотр без входа'}>{identityLabel}</span>}
              {isSuperAdmin && workspaceSwitcher}
              {projectFilter}
              {project !== 'all' && <span role="status" className="max-w-44 truncate rounded bg-amber-500/10 px-2 py-1 text-[11px] text-amber-800 dark:text-amber-300" title={`Остальные проекты скрыты: ${project}`}>Фильтр проекта: {project}</span>}
              {project !== 'all' && <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => setProject('all')}>Показать все проекты</Button>}
            </div>
            <div className="relative shrink-0">
              <Button aria-label="Дополнительные фильтры" aria-controls="board-additional-filters" aria-expanded={filtersOpen} title="Фильтры" variant="ghost" size="sm" className="h-7 gap-1 border px-2 text-xs" onClick={() => setFiltersOpen(value => !value)}>
                <SlidersHorizontal aria-hidden className="h-3.5 w-3.5" /><span className="sm:hidden">Фильтры</span>
              </Button>
              {filtersOpen && <div id="board-additional-filters" role="region" aria-label="Дополнительные фильтры" className="absolute left-0 top-full z-50 mt-1 grid max-h-[70vh] w-72 max-w-[calc(100vw-1rem)] gap-2 overflow-y-auto rounded-md border bg-popover p-3 text-popover-foreground shadow-lg">
                <div className="grid gap-2 sm:hidden">{projectFilter}</div>
                <label className="grid gap-1 text-xs text-muted-foreground"><span>Ответственный</span>{assigneeFilter}</label>
                <div className="flex flex-wrap items-center gap-1">
                  {isSuperAdmin && <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setShowRoles(true)}><Users aria-hidden className="mr-1 h-3.5 w-3.5" />Роли</Button>}
                  <Button aria-pressed={inboxOnly} variant={inboxOnly ? 'secondary' : 'ghost'} size="sm" className="h-7 px-2 text-xs" onClick={() => { setInboxOnly(value => !value); setPlanningTab('execution'); }}><Inbox aria-hidden className="mr-1 h-3.5 w-3.5" />Входящие</Button>
                  <NotificationSettings />
                </div>
                <div className="md:hidden">{renderAttentionFilters()}</div>
              </div>}
            </div>
            {identityChecked && <span className="max-w-24 shrink truncate px-1 text-xs text-muted-foreground sm:hidden" title={username ? `Вы вошли как ${username}` : 'Локальный просмотр без входа'}>{identityLabel}</span>}
            {isSuperAdmin && <div className="flex shrink-0 items-center gap-1 sm:hidden">{workspaceSwitcher}</div>}
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
        <Tabs value={planningTab} onValueChange={handlePlanningTabChange} orientation={isMobile ? 'horizontal' : 'vertical'} className="flex min-h-0 flex-1 flex-col gap-0 md:flex-row">
          <div className="order-2 mt-auto w-full shrink-0 border-t px-1 py-1 md:order-1 md:mt-0 md:h-full md:w-40 md:overflow-y-auto md:border-t-0 md:border-r md:px-2 md:py-3">
            <TabsList aria-label="Разделы доски" className="mx-auto h-14 min-h-0 w-full max-w-5xl min-w-0 flex-nowrap justify-between gap-0 rounded-none bg-transparent p-0 md:h-auto md:flex-col md:items-stretch md:justify-start md:gap-1">
              <TabsTrigger aria-label="Обзор" title="Обзор" value="dashboard" className="h-12 min-w-0 flex-1 flex-col gap-0.5 px-0 text-[10px] sm:text-xs md:h-10 md:flex-none md:flex-row md:justify-start md:gap-2 md:px-3 md:text-sm"><LayoutDashboard aria-hidden className="h-4 w-4" /><span>Обзор</span><span className="sr-only">Обзор</span></TabsTrigger>
              <TabsTrigger aria-label="Активные" title="Активные" value="execution" className="h-12 min-w-0 flex-1 flex-col gap-0.5 px-0 text-[10px] sm:text-xs md:h-10 md:flex-none md:flex-row md:justify-start md:gap-2 md:px-3 md:text-sm"><ListTodo aria-hidden className="h-4 w-4" /><span className="md:hidden">Актив</span><span className="hidden md:inline">Активные</span><span className="sr-only">Активные</span></TabsTrigger>
              <TabsTrigger aria-label="Входящие" title="Входящие" value="inbox" className="h-12 min-w-0 flex-1 flex-col gap-0.5 px-0 text-[10px] sm:text-xs md:h-10 md:flex-none md:flex-row md:justify-start md:gap-2 md:px-3 md:text-sm"><Inbox aria-hidden className="h-4 w-4" /><span className="md:hidden">Вход</span><span className="hidden md:inline">Входящие</span><span className="sr-only">Входящие</span></TabsTrigger>
              <TabsTrigger aria-label="Неделя" title="Неделя" value="week" className="h-12 min-w-0 flex-1 flex-col gap-0.5 px-0 text-[10px] sm:text-xs md:h-10 md:flex-none md:flex-row md:justify-start md:gap-2 md:px-3 md:text-sm"><CalendarDays aria-hidden className="h-4 w-4" /><span>Неделя</span><span className="sr-only">Неделя</span></TabsTrigger>
              <TabsTrigger aria-label="Сегодня" title="Сегодня" value="today" className="h-12 min-w-0 flex-1 flex-col gap-0.5 px-0 text-[10px] sm:text-xs md:h-10 md:flex-none md:flex-row md:justify-start md:gap-2 md:px-3 md:text-sm"><CalendarCheck aria-hidden className="h-4 w-4" /><span>Сегодня</span><span className="sr-only">Сегодня</span></TabsTrigger>
              {isSuperAdmin && <TabsTrigger aria-label="Баланс ролей" title="Баланс ролей" value="balance" className="h-12 min-w-0 flex-1 flex-col gap-0.5 px-0 text-[10px] sm:text-xs md:h-10 md:flex-none md:flex-row md:justify-start md:gap-2 md:px-3 md:text-sm"><Users aria-hidden className="h-4 w-4" /><span className="md:hidden">Роли</span><span className="hidden md:inline">Баланс ролей</span><span className="sr-only">Баланс ролей</span></TabsTrigger>}
              <TabsTrigger aria-label={`Закрытые: ${counts.done + counts.archived}`} title={`Закрытые: ${counts.done + counts.archived}`} value="closed" className="h-12 min-w-0 flex-1 flex-col gap-0.5 px-0 text-[10px] sm:text-xs md:h-10 md:flex-none md:flex-row md:justify-start md:gap-2 md:px-3 md:text-sm"><Archive aria-hidden className="h-4 w-4" /><span className="md:hidden">Архив</span><span className="hidden md:inline">Закрытые</span><span className="sr-only">Закрытые ({counts.done + counts.archived})</span></TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="dashboard" className="order-1 md:order-2 min-h-0 min-w-0 overflow-y-auto">
            <IntegratorTaskDashboard cards={derivedCards} onOpen={setSelectedCard} onRefresh={refresh} canAssignReviewer={isSuperAdmin} onAssignReviewer={handleAssignReviewer} />
          </TabsContent>
          <TabsContent value="execution" className="order-1 md:order-2 min-h-0 min-w-0 overflow-y-auto">
            {view === 'graph' ? (
              <CardGraphView cards={visibleCards} onOpen={setSelectedCard} workspaceView={workspaceView} onWorkspaceViewChange={setWorkspaceView} />
            ) : view === 'list' ? (
              <TaskListView cards={getPlanningTabCards(visibleCards, 'execution')} authoritativeCards={cards} breadcrumbCards={scopedCards} highlightCardId={highlightCardId} username={username} onRefresh={refresh} onStatusChange={(id, column, version) => updateCard(id, { column }, version)} onOpen={setSelectedCard} />
            ) : (
          <div className="flex gap-3 sm:gap-4 p-3 sm:p-6 overflow-x-auto overscroll-x-contain flex-1">
              {PRIMARY_BOARD_COLUMNS.map((col, index) => (
              <KanbanColumnComponent
                key={col.id}
                id={col.id}
                title={col.title}
                color={col.color}
                  cards={getPrimaryBoardLaneCards(visibleCards, index === 0 ? 'incoming' : index === 1 ? 'in-progress' : 'review')}
                  onAddCard={index === 2 ? undefined : () => handleAdd(col.id)}
              />
            ))}
          </div>
            )}
          </TabsContent>
          <TabsContent value="inbox" className="order-1 md:order-2 min-h-0 overflow-y-auto space-y-3 p-3 sm:p-6"><InboxCapture owner={person} onCaptured={refresh} /><PlanningCardList cards={derivedCards} roles={roles} onOpen={setSelectedCard} empty="Входящих задач пока нет" /></TabsContent>
          <TabsContent value="week" className="order-1 md:order-2 min-h-0 overflow-y-auto p-3 sm:p-6"><WeeklyPlanView cards={visibleCards} roles={roles} draft={weeklyDraft} loading={weeklyLoading} error={weeklyError} canAccept={username === NIKITA_ACTOR} onLoad={() => void fetchWeeklyDraft()} onAccept={ids => acceptWeeklyPlan(ids)} onOpen={setSelectedCard} /></TabsContent>
          <TabsContent value="today" className="order-1 md:order-2 min-h-0 overflow-y-auto p-3 sm:p-6"><PlanningCardList cards={derivedCards} roles={roles} onOpen={setSelectedCard} empty="На сегодня задач нет" /></TabsContent>
          <TabsContent value="balance" className="order-1 md:order-2 min-h-0 overflow-y-auto p-3 sm:p-6">{roleError && <p role="alert" className="text-sm text-destructive">{roleError}</p>}<RoleBalanceView balance={roleBalance} roles={roles} /></TabsContent>
          <TabsContent value="closed" className="order-1 md:order-2 min-h-0 overflow-y-auto">
            <div className="flex flex-wrap items-center gap-2 px-3 pt-3 sm:px-6">
              <p className="text-sm text-muted-foreground">Карточки сохранены. Отмена не считается выполнением.</p>
              <select aria-label="Фильтр закрытых задач" value={closedKind} onChange={event => setClosedKind(event.target.value as typeof closedKind)} className="h-9 rounded-md border bg-background px-2 text-sm">
                <option value="all">Все закрытые</option>
                <option value="done">Готово ({counts.done})</option>
                <option value="archived">Не планируется ({counts.archived})</option>
              </select>
            </div>
            <TaskListView cards={closedCards} authoritativeCards={cards} breadcrumbCards={scopedCards} highlightCardId={highlightCardId} username={username} onRefresh={refresh} onStatusChange={(id, column, version) => updateCard(id, { column }, version)} onOpen={setSelectedCard} />
          </TabsContent>
        </Tabs>
        <Button className="fixed bottom-20 right-4 z-50 h-12 w-12 rounded-full shadow-lg md:bottom-6 md:right-6" aria-label="Новая задача" title="Новая задача" onClick={() => { setDefaultColumn('todo'); setShowAdd(true); }}>
          <Plus className="h-5 w-5" />
        </Button>
        <AddCardDialog projectOptions={projectOptions} relatedCards={visibleCards} defaultProject={project === 'all' ? '' : project} ownerPreview={identityChecked ? username ?? 'nikita' : null} roles={roles} open={showAdd} onOpenChange={setShowAdd} defaultColumn={defaultColumn} onCreate={handleCreate} />
        {selectedCard && <CardEditDialog projectOptions={projectOptions} relatedCards={visibleCards} breadcrumbCards={scopedCards} roles={roles} card={selectedCard} username={username} onRefresh={refresh} open onOpenChange={open => { if (!open) setSelectedCard(null); }} onUpdate={handleUpdate} onDelete={handleDelete} onReviewDecision={handleReviewDecision} onSelectCard={setSelectedCard} />}
        {conflict && <ConflictDialog conflict={conflict} onResolve={resolveConflict} />}
        {isSuperAdmin && <RolesDialog owner={person} open={showRoles} onOpenChange={setShowRoles} onSaved={() => setRoleRefresh(value => value + 1)} />}
      </DndProvider>
    </CardActionsContext.Provider>
  );
}
