'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useTheme } from 'next-themes';
import {
  Activity, ArrowDownUp, ArrowRight, ArrowUpRight, CalendarDays, Check, CheckCheck,
  ChevronDown, ChevronRight, Circle, CircleHelp, Clock3, Columns3, Command, Copy,
  ExternalLink, FileText, Flag, FolderKanban, FolderOpen, GitPullRequest, LayoutDashboard,
  ListChecks, LockKeyhole, Menu, MessageSquare, Moon, Plus, Radio, RefreshCw,
  Search, Server, ShieldCheck, Sparkles, Sun, Terminal, TriangleAlert,
  UserRound, Users, X,
} from 'lucide-react';
import { useKanban, type KanbanUpdateRequest } from '@/hooks/use-kanban';
import { useIsMobile } from '@/hooks/use-mobile';
import { AddCardDialog, createWithReviewGate } from '@/components/kanban/add-card-dialog';
import { CardEditDialog } from '@/components/kanban/card-edit-dialog';
import { ConflictDialog } from '@/components/kanban/conflict-dialog';
import { BoardDiagnosticsPanel } from '@/components/kanban/board-diagnostics-panel';
import { DEFAULT_COLUMNS, type KanbanCard, type KanbanCardUpdates, type KanbanColumn, type RoleDefinition } from '@/lib/kanban/types';
import type { HumanReviewAction } from '@/lib/kanban/transition-policy';
import { BoardMutationError, boardMutationRequest, mutationErrorMessage, readMutationResponse } from '@/lib/kanban/mutation-response';
import { recordDiagnostic } from '@/lib/kanban/board-diagnostics';
import { filterWorkspaceCards, getProjectOptions, isClosedCard, resolveInitialWorkspaceView, type WorkspaceView } from '@/components/kanban/view-model';
import { parseBoardUrlState } from '@/components/kanban/board-url-state';
import { UNKNOWN, filterCards, getActivity, getDecisions, getFilterOptions, getReleases, getSessions, safeExternalUrl, taskFacts, type KonturSession } from './kontur-model';
import { KonturCalendar, formatStamp, moscowDay } from './kontur-calendar';
import { KONTUR_SERVICES, LEGACY_PROJECT_SECTIONS, RECORD_TYPES, isRecordType, projectMatchesSection, recordTypeScreen, type ProjectSection, type RecordType } from './kontur-config';
import { UNKNOWN_TEAM_FILTER, buildProjectCatalog, buildTeamCatalog, filterCardsByTeam, legacySectionForProject, projectMatchesTeam, projectTeamLabel, readCatalogUrlState, resolveTeamFilter, writeCatalogUrlState, type KonturProject } from './kontur-catalog';
import './kontur.css';

type Screen = 'overview' | 'catalog' | 'kanban' | 'list' | 'calendar' | 'sessions' | 'blockers' | 'releases' | 'decisions' | 'activity';
type SessionFilter = 'all' | 'running' | 'waiting' | 'stalled' | 'stopped' | 'result' | 'unknown' | 'check';
type ErrorFilter = 'all' | 'ACL' | '429' | 'ENAMETOOLONG' | 'other';

const NAV = [
  { id: 'overview', label: 'Сводка', icon: LayoutDashboard, description: 'Что требует внимания и откуда продолжить.' },
  { id: 'catalog', label: 'Проекты и команды', icon: FolderKanban, description: 'Доступные проекты, команды и подтверждённые связи между ними.' },
  { id: 'kanban', label: 'Kanban', icon: Columns3, description: 'Задачи по состояниям. Завершение после проверки результата.' },
  { id: 'list', label: 'Список задач', icon: ListChecks, description: 'Вся работа, исполнители и сроки в одном списке.' },
  { id: 'calendar', label: 'Календарь', icon: CalendarDays, description: 'Сроки задач и связь с календарём Keeper.' },
  { id: 'sessions', label: 'Сессии агентов', icon: Radio, description: 'Сохранённые запуски и продолжения, связанные с задачами.' },
  { id: 'blockers', label: 'Блокеры и ошибки', icon: TriangleAlert, description: 'Что мешает продолжению и где нужен следующий шаг.' },
  { id: 'releases', label: 'PR и выкладки', icon: GitPullRequest, description: 'Ссылки на изменения из доказательств выполнения задач.' },
  { id: 'decisions', label: 'Журнал решений', icon: FileText, description: 'Приёмка, доработка и ответы на вопросы исполнителей.' },
  { id: 'activity', label: 'Последние действия', icon: Activity, description: 'История результатов, решений и работы агентов.' },
] as const;
const SCREENS = new Set<string>(NAV.map(item => item.id));
const PRIORITIES: Record<string, string> = { critical: 'Критический', high: 'Высокий', medium: 'Средний', low: 'Низкий' };
const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const SERVICE_ICONS = { messages: MessageSquare, agents: Radio, airlock: LockKeyhole, gptadmin: Server };
const SESSION_FILTERS = [
  ['all', 'Все записи'], ['running', 'Активные'], ['waiting', 'Ожидают'],
  ['stalled', 'Зависшие'], ['unknown', 'Неизвестно'], ['stopped', 'Остановлены'], ['result', 'С результатом'],
] as const;
const LIVE_SESSION_LABELS = { running: 'В работе', waiting: 'Ожидает', idle: 'Нет активного хода', stopped: 'Остановлена', error: 'Ошибка', unknown: UNKNOWN } as const;
type LiveSessionState = keyof typeof LIVE_SESSION_LABELS;
type SessionObservation = {
  cardVersion: number;
  sessionId: string | null;
  state: LiveSessionState;
  source: 'agent-herder:agent_info' | null;
  checkedAt: string | null;
  lastActivityAt: string | null;
  reason: string | null;
};

function observationDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
}

function sessionObservation(value: unknown, session: KonturSession): SessionObservation | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  const expectedId = session.sessionId === UNKNOWN ? null : session.sessionId;
  if (data.cardId !== session.cardId || data.operationId !== session.operationId || data.sessionId !== expectedId
    || !Number.isSafeInteger(data.cardVersion) || Number(data.cardVersion) < 0
    || typeof data.state !== 'string' || !Object.hasOwn(LIVE_SESSION_LABELS, data.state)) return null;
  const source = data.source === 'agent-herder:agent_info' ? data.source : null;
  const checkedAt = observationDate(data.checkedAt) ? data.checkedAt : null;
  if (data.state !== 'unknown' && (!source || !checkedAt)) return null;
  return { cardVersion: Number(data.cardVersion), sessionId: expectedId, state: data.state as LiveSessionState,
    source, checkedAt, lastActivityAt: observationDate(data.lastActivityAt) ? data.lastActivityAt : null,
    reason: typeof data.reason === 'string' ? data.reason.slice(0, 1000) : null };
}

function parseSessionFilter(value: string | null): SessionFilter | undefined {
  if (value === 'active') return 'running';
  if (value === 'stuck') return 'stalled';
  return value === 'check' || SESSION_FILTERS.some(([id]) => id === value) ? value as SessionFilter : undefined;
}

function hasRecordType(card: KanbanCard, type: RecordType) {
  switch (type) {
    case 'session': return getSessions([card]).length > 0;
    case 'pr': return getReleases([card]).some(release => release.kind === 'pr');
    case 'deployment': return getReleases([card]).some(release => release.kind === 'deployment');
    case 'decision': return getDecisions([card]).length > 0;
    case 'activity': return getActivity([card]).length > 0;
    default: return true;
  }
}

function statusLabel(status: string) { return DEFAULT_COLUMNS.find(column => column.id === status)?.title ?? UNKNOWN; }
function projectTone(project: string) { return [...project].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 4; }
function ProjectMark({ project, small = false }: { project: string; small?: boolean }) {
  return <span className={`k-project-mark${small ? ' is-small' : ''}`} data-tone={projectTone(project)} aria-hidden="true">{project === UNKNOWN ? '?' : project.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase() || '?'}</span>;
}
function StatusBadge({ status }: { status: string }) { return <span className="k-status" data-status={status}><i />{statusLabel(status)}</span>; }
function PriorityBadge({ priority }: { priority: string }) { return <span className="k-priority" data-priority={priority}><Flag size={11} />{PRIORITIES[priority] ?? UNKNOWN}</span>; }
function known(value: string | null | undefined) { return Boolean(value?.trim()) && value !== UNKNOWN; }
function hasBlocker(card: KanbanCard) { return card.column === 'blocked' || known(taskFacts(card).blocker); }
function errorKind(card: KanbanCard): ErrorFilter {
  const blocker = taskFacts(card).blocker;
  if (/ENAMETOOLONG/i.test(blocker)) return 'ENAMETOOLONG';
  if (/\b429\b/.test(blocker)) return '429';
  if (/\bACL\b|\bEACCES\b|permission denied/i.test(blocker)) return 'ACL';
  return 'other';
}
function hasAcceptedReview(card: KanbanCard) { return card.column === 'done' && card.reviewHistory?.at(-1)?.decision === 'accepted'; }
function attentionOrder(a: KanbanCard, b: KanbanCard) {
  return Number(b.column === 'review' || b.needsReview) - Number(a.column === 'review' || a.needsReview)
    || Number(hasBlocker(b)) - Number(hasBlocker(a))
    || (PRIORITY_ORDER[a.priority] ?? 4) - (PRIORITY_ORDER[b.priority] ?? 4)
    || (Date.parse(a.dueAt ?? '') || Infinity) - (Date.parse(b.dueAt ?? '') || Infinity)
    || a.order - b.order;
}
function Empty({ title, children, clear }: { title: string; children: ReactNode; clear?: () => void }) {
  return <div className="k-empty"><FolderOpen size={30} strokeWidth={1.4} /><h3>{title}</h3><p>{children}</p>{clear && <button type="button" className="k-button k-button-small" onClick={clear}>Сбросить фильтры</button>}</div>;
}
function Evidence({ refs }: { refs: string[] }) {
  if (!refs.length) return <span className="k-unknown">{UNKNOWN}</span>;
  return <ul className="k-evidence-list">{refs.map((reference, index) => {
    const href = safeExternalUrl(reference);
    return <li key={`${reference}-${index}`}>{href ? <a href={href} target="_blank" rel="noopener noreferrer">{reference}<ExternalLink size={11} /></a> : <code>{reference}</code>}</li>;
  })}</ul>;
}
function ServiceLinks() {
  return <div className="k-service-links">{KONTUR_SERVICES.map(service => {
    const Icon = SERVICE_ICONS[service.id];
    return <div className="k-service-item" key={service.id}>
      <a href={service.href} target="_blank" rel="noopener noreferrer" aria-label={`Открыть сайт ${service.name}: ${service.host}`}><span className="k-service-icon"><Icon size={16} /></span><span><strong>{service.name}</strong><small>{service.host}</small></span><ArrowUpRight size={14} /></a>
      <div className="k-service-detail"><span>Доступ MCP: неизвестно</span><a href={service.mcpHref} target="_blank" rel="noopener noreferrer" title={service.mcpHref} aria-label={`Открыть MCP ${service.name}: ${service.mcpHref}`}>API / MCP<ArrowUpRight size={12} /></a></div>
    </div>;
  })}<p className="k-services-note">Сайт и API открываются отдельно. Содержимое интеграций здесь не подставляется.</p></div>;
}
function continuation(card: KanbanCard, projectInfo?: KonturProject) {
  const facts = taskFacts(card);
  return [`Задача: ${facts.title}`, `ID: ${card.id}; версия: ${card.version}`, `Проект: ${facts.project}`, `Команды проекта: ${projectTeamLabel(projectInfo)}`, `Состояние: ${statusLabel(card.column)}`, `Владелец: ${facts.owner}`, `Машина: ${facts.machine}`, '', `Что сделано: ${facts.done}`, `Что осталось: ${facts.remaining}`, `Следующий шаг: ${facts.nextStep}`, `Доказательство: ${facts.evidence.join('\n') || UNKNOWN}`, `Блокер: ${facts.blocker}`, `Команда/ссылка: ${facts.command}`, '', 'Сохранить незавершённую цель. Закрывать задачу только после проверки результата человеком.'].join('\n');
}
function CardFacts({ card, projectInfo, onCopy }: { card: KanbanCard; projectInfo?: KonturProject; onCopy: (text: string, label: string) => void }) {
  const facts = taskFacts(card);
  const commandUrl = safeExternalUrl(facts.command);
  return <div className="k-card-facts">
    <dl>
      <div><dt>Команды проекта</dt><dd className={!projectInfo?.teams.length ? 'k-unknown' : undefined}>{projectTeamLabel(projectInfo)}</dd></div>
      <div><dt>Что сделано</dt><dd className={!known(facts.done) ? 'k-unknown' : undefined}>{facts.done}</dd></div>
      <div><dt>Что осталось</dt><dd className={!known(facts.remaining) ? 'k-unknown' : undefined}>{facts.remaining}</dd></div>
      <div><dt>Следующий шаг</dt><dd className={!known(facts.nextStep) ? 'k-unknown' : undefined}>{facts.nextStep}</dd></div>
      <div><dt>Доказательство</dt><dd><Evidence refs={facts.evidence} /></dd></div>
      <div><dt>Блокер</dt><dd className={!known(facts.blocker) ? 'k-unknown' : undefined}>{facts.blocker}</dd></div>
      <div><dt>Команда/ссылка</dt><dd>{commandUrl ? <a href={commandUrl} target="_blank" rel="noopener noreferrer">{facts.command}<ExternalLink size={12} /></a> : <code className={!known(facts.command) ? 'k-unknown' : undefined}>{facts.command}</code>}{known(facts.command) && <button type="button" className="k-copy-inline" aria-label="Скопировать команду или ссылку" onClick={() => onCopy(facts.command, 'Команда или ссылка скопирована')}><Copy size={13} /></button>}</dd></div>
    </dl>
    <button type="button" className="k-text-button" onClick={() => onCopy(continuation(card, projectInfo), 'Контекст для продолжения скопирован')}><Copy size={13} />Контекст для продолжения</button>
  </div>;
}
function TaskCard({ card, projectInfo, onOpen, onCopy, onDragStart, onDragEnd, busy }: {
  card: KanbanCard; projectInfo?: KonturProject; onOpen: (card: KanbanCard) => void; onCopy: (text: string, label: string) => void;
  onDragStart?: (event: DragEvent<HTMLElement>, card: KanbanCard) => void; onDragEnd?: () => void; busy?: boolean;
}) {
  const facts = taskFacts(card);
  const overdue = !isClosedCard(card) && card.dueAt && Date.parse(card.dueAt) < Date.now();
  return <article className={`k-task-card${busy ? ' is-saving' : ''}`} draggable={Boolean(onDragStart) && !busy} onDragStart={event => onDragStart?.(event, card)} onDragEnd={onDragEnd}>
    <div className="k-task-top"><span className="k-project-label"><ProjectMark project={facts.project} small />{facts.project}</span><PriorityBadge priority={card.priority} /></div>
    <p className="k-task-team"><Users size={11} /><span>Команды проекта: {projectTeamLabel(projectInfo)}</span></p>
    <button type="button" className="k-task-title" onClick={() => onOpen(card)}>{card.title}<ArrowUpRight size={14} /></button>
    <p className="k-task-next"><span>Следующий шаг</span>{facts.nextStep}</p>
    {hasBlocker(card) && <div className="k-card-blocker"><TriangleAlert size={12} /><span>{facts.blocker}</span></div>}
    <div className="k-task-meta"><span><UserRound size={12} />{facts.owner}</span><span><Server size={12} />{facts.machine}</span></div>
    <div className="k-task-bottom"><span className={overdue ? 'k-overdue' : ''}><CalendarDays size={12} />{card.dueAt ? formatStamp(card.dueAt, true) : 'Срок неизвестен'}</span><span title={`Версия ${card.version}`}>v{card.version}</span></div>
    <details className="k-task-context"><summary>Контекст и доказательства<ChevronDown size={13} /></summary><CardFacts card={card} projectInfo={projectInfo} onCopy={onCopy} /></details>
  </article>;
}

export function KonturBoard() {
  const { cards, projects, teamCatalog, loading, error, refreshing, lastLoadedAt, conflict, createCard, updateCard, deleteCard, moveCard, resolveConflict, refresh } = useKanban();
  const { resolvedTheme, setTheme } = useTheme();
  const isMobile = useIsMobile();
  const [mounted, setMounted] = useState(false);
  const [screen, setScreen] = useState<Screen>('overview');
  const [project, setProject] = useState('all');
  const [team, setTeam] = useState('all');
  const [catalogView, setCatalogView] = useState<'projects' | 'teams'>('projects');
  const [projectSection, setProjectSection] = useState<ProjectSection>('all');
  const [recordType, setRecordType] = useState<RecordType>('all');
  const [server, setServer] = useState('all');
  const [status, setStatus] = useState('all');
  const [priority, setPriority] = useState('all');
  const [search, setSearch] = useState('');
  const [workspace, setWorkspace] = useState<WorkspaceView>('mine');
  const [username, setUsername] = useState<string | null>(null);
  const [identityReady, setIdentityReady] = useState(false);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [identityAttempt, setIdentityAttempt] = useState(0);
  const [roles, setRoles] = useState<RoleDefinition[] | undefined>();
  const [rolesError, setRolesError] = useState<string | null>(null);
  const [rolesAttempt, setRolesAttempt] = useState(0);
  const [urlReady, setUrlReady] = useState(false);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [defaultColumn, setDefaultColumn] = useState('inbox');
  const [mobileMenu, setMobileMenu] = useState(false);
  const [daily, setDaily] = useState(false);
  const [includeClosed, setIncludeClosed] = useState(false);
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>('all');
  const [sessionObservations, setSessionObservations] = useState<Record<string, SessionObservation>>({});
  const [checkingSessions, setCheckingSessions] = useState<Set<string>>(new Set());
  const [blockerFilter, setBlockerFilter] = useState<ErrorFilter>('all');
  const [listSort, setListSort] = useState<'priority' | 'updated' | 'due'>('priority');
  const [listLimit, setListLimit] = useState(60);
  const [columnLimit, setColumnLimit] = useState<Record<string, number>>({});
  const [journalLimit, setJournalLimit] = useState(50);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropColumn, setDropColumn] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestedWorkspace = useRef<WorkspaceView | undefined>(undefined);
  const sessionRequests = useRef(new Map<string, AbortController>());

  const notify = useCallback((message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(''), 6500);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
  useEffect(() => () => {
    for (const controller of sessionRequests.current.values()) controller.abort();
    sessionRequests.current.clear();
  }, []);

  useEffect(() => {
    setMounted(true);
    const params = new URLSearchParams(window.location.search);
    const legacy = parseBoardUrlState(params);
    const requestedScreen = params.get('screen');
    if (requestedScreen && SCREENS.has(requestedScreen)) setScreen(requestedScreen as Screen);
    else if (legacy.attention === 'blocked') setScreen('blockers');
    else if (legacy.tab === 'closed' || legacy.layout === 'list') setScreen('list');
    else if (legacy.layout === 'kanban' || legacy.tab === 'execution') setScreen('kanban');
    if (legacy.project) setProject(legacy.project);
    const requestedSection = params.get('section');
    const requestedType = params.get('recordType');
    const requestedSession = parseSessionFilter(params.get('sessionState'));
    setProjectSection(legacySectionForProject(legacy.project, requestedSection));
    const catalogUrl = readCatalogUrlState(params);
    setTeam(catalogUrl.team);
    setCatalogView(catalogUrl.view);
    if (isRecordType(requestedType)) {
      setRecordType(requestedType);
      const typeScreen = recordTypeScreen(requestedType);
      if ((!requestedScreen || !SCREENS.has(requestedScreen)) && typeScreen) setScreen(typeScreen);
    }
    if (requestedSession) setSessionFilter(requestedSession);
    if (legacy.search) setSearch(legacy.search);
    const requestedServer = params.get('server');
    const requestedStatus = params.get('status');
    const requestedPriority = params.get('priority');
    if (requestedServer) setServer(requestedServer.slice(0, 512));
    if (requestedStatus && (requestedStatus === 'all' || DEFAULT_COLUMNS.some(column => column.id === requestedStatus))) setStatus(requestedStatus);
    if (requestedPriority && Object.hasOwn(PRIORITIES, requestedPriority)) setPriority(requestedPriority);
    if (legacy.tab === 'closed' && !requestedStatus) { setStatus(legacy.closedKind === 'archived' ? 'archived' : 'done'); setIncludeClosed(true); }
    if (params.get('closed-visible') === '1') setIncludeClosed(true);
    if (params.get('daily') === '1') setDaily(true);
    const cardId = params.get('card');
    if (cardId?.trim()) setSelectedCardId(cardId.trim().slice(0, 512));
    requestedWorkspace.current = legacy.workspaceView;
    setUrlReady(true);
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setIdentityError(null);
    void fetch('/api/auth/session', { cache: 'no-store', signal: controller.signal, credentials: 'same-origin' })
      .then(async response => {
        const identity = await response.json().catch(() => null) as { authenticated?: boolean; username?: string } | null;
        if (!response.ok || !identity?.authenticated || !identity.username?.trim()) throw new Error('Вход в доску не подтверждён. Войди в свой аккаунт, чтобы работать с задачами.');
        if (controller.signal.aborted) return;
        setUsername(identity.username);
        setWorkspace(resolveInitialWorkspaceView(window.location.hostname, identity.username, requestedWorkspace.current ?? 'all'));
      })
      .catch(failure => { if (!controller.signal.aborted) { setUsername(null); setIdentityError(failure instanceof Error ? failure.message : 'Не удалось подтвердить вход в доску.'); } })
      .finally(() => { if (!controller.signal.aborted) setIdentityReady(true); });
    return () => controller.abort();
  }, [identityAttempt]);

  useEffect(() => {
    if (!username) return;
    const controller = new AbortController();
    setRolesError(null);
    void fetch(`/api/kanban/roles?owner=${encodeURIComponent(username)}`, { signal: controller.signal, cache: 'no-store' })
      .then(response => readMutationResponse(response))
      .then(data => { if (!controller.signal.aborted) setRoles(data.roles); })
      .catch(() => { if (!controller.signal.aborted) setRolesError('Список ролей не загружен. Остальные поля задачи доступны.'); });
    return () => controller.abort();
  }, [username, rolesAttempt]);

  useEffect(() => {
    if (!urlReady || !identityReady) return;
    const params = new URLSearchParams(window.location.search);
    params.set('screen', screen); params.set('view', workspace);
    for (const [key, value] of [['project', project], ['section', projectSection], ['recordType', recordType], ['sessionState', sessionFilter], ['server', server], ['status', status], ['priority', priority], ['search', search.trim()]] as const) {
      if (value && value !== 'all') params.set(key, value); else params.delete(key);
    }
    writeCatalogUrlState(params, { team, view: catalogView }, screen === 'catalog');
    if (daily) params.set('daily', '1'); else params.delete('daily');
    if (includeClosed) params.set('closed-visible', '1'); else params.delete('closed-visible');
    if (selectedCardId) params.set('card', selectedCardId); else params.delete('card');
    const next = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
    if (next !== window.location.pathname + window.location.search + window.location.hash) window.history.replaceState(window.history.state, '', next);
  }, [screen, project, team, catalogView, projectSection, recordType, sessionFilter, server, status, priority, search, workspace, selectedCardId, daily, includeClosed, identityReady, urlReady]);

  useEffect(() => { setListLimit(60); setJournalLimit(50); setColumnLimit({}); }, [project, team, projectSection, recordType, server, status, priority, search, workspace, screen]);

  useEffect(() => {
    if (!mobileMenu || !isMobile) return;
    const sidebar = sidebarRef.current;
    const elements = () => Array.from(sidebar?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], select, input') ?? [])
      .filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length > 0 && getComputedStyle(element).visibility === 'visible');
    // Focus only once the opening transition makes a control focusable.
    // Two fixed frames can still land while CSS visibility is hidden.
    let focusFrame = 0;
    const focusDeadline = performance.now() + 1000;
    const focusMenu = () => {
      if (!sidebar || sidebar.contains(document.activeElement)) return;
      elements()[0]?.focus({ preventScroll: true });
      if (!sidebar.contains(document.activeElement) && performance.now() < focusDeadline) {
        focusFrame = requestAnimationFrame(focusMenu);
      }
    };
    focusFrame = requestAnimationFrame(focusMenu);
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setMobileMenu(false); return; }
      if (event.key !== 'Tab') return;
      const items = elements(); const first = items[0]; const last = items.at(-1);
      if (!sidebar?.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keyboard);
    return () => { cancelAnimationFrame(focusFrame); document.removeEventListener('keydown', keyboard); menuRef.current?.focus(); };
  }, [mobileMenu, isMobile]);

  const projectCatalog = useMemo(() => buildProjectCatalog(cards, projects, teamCatalog), [cards, projects, teamCatalog]);
  const teams = useMemo(() => buildTeamCatalog(projectCatalog), [projectCatalog]);
  const projectsByName = useMemo(() => new Map(projectCatalog.map(item => [item.name, item])), [projectCatalog]);
  const activeTeam = resolveTeamFilter(team, teamCatalog);
  const scopedCards = useMemo(() => username ? filterWorkspaceCards(cards, username, workspace) : [], [cards, username, workspace]);
  const filterOptions = useMemo(() => getFilterOptions(scopedCards), [scopedCards]);
  const projectOptions = useMemo(() => getProjectOptions(cards, projects), [cards, projects]);
  const allProjects = useMemo(() => projectCatalog.map(item => item.name), [projectCatalog]);
  const sectionCards = useMemo(() => scopedCards.filter(card => projectMatchesSection(taskFacts(card).project, projectSection)), [scopedCards, projectSection]);
  const teamCards = useMemo(() => filterCardsByTeam(sectionCards, projectCatalog, activeTeam), [sectionCards, projectCatalog, activeTeam]);
  const typedCards = useMemo(() => teamCards.filter(card => hasRecordType(card, recordType)), [teamCards, recordType]);
  const filteredCards = useMemo(() => filterCards(typedCards, { project, server: screen === 'sessions' ? 'all' : server, status, priority, search }), [typedCards, project, server, status, priority, search, screen]);
  const cardsById = useMemo(() => new Map(cards.map(card => [card.id, card])), [cards]);
  const unresolved = useMemo(() => filteredCards.filter(card => !isClosedCard(card)), [filteredCards]);
  const blockers = useMemo(() => unresolved.filter(hasBlocker), [unresolved]);
  const reviewCards = useMemo(() => unresolved.filter(card => card.column === 'review' || card.needsReview), [unresolved]);
  const sessions = useMemo(() => getSessions(filteredCards).filter(session => server === 'all' || session.machine === server).map(session => {
    const parent = cardsById.get(session.cardId);
    return { ...session, owner: parent ? taskFacts(parent).owner : UNKNOWN, priority: parent?.priority ?? UNKNOWN };
  }), [filteredCards, server, cardsById]);
  const serverOptions = useMemo(() => [...new Set([...filterOptions.servers, ...getSessions(scopedCards).map(session => session.machine)])].sort((a, b) => a.localeCompare(b, 'ru', { numeric: true })), [filterOptions.servers, scopedCards]);
  const activity = useMemo(() => getActivity(filteredCards), [filteredCards]);
  const decisions = useMemo(() => getDecisions(filteredCards), [filteredCards]);
  const releases = useMemo(() => getReleases(filteredCards).filter(release => recordType !== 'pr' && recordType !== 'deployment' || release.kind === recordType), [filteredCards, recordType]);
  const attentionCards = useMemo(() => [...unresolved].sort(attentionOrder), [unresolved]);
  const selectedCard = selectedCardId ? cards.find(card => card.id === selectedCardId) : undefined;
  const currentNav = NAV.find(item => item.id === screen)!;
  const hasFilters = project !== 'all' || team !== 'all' || projectSection !== 'all' || recordType !== 'all' || sessionFilter !== 'all' || server !== 'all' || status !== 'all' || priority !== 'all' || Boolean(search.trim());
  const selectedSection = LEGACY_PROJECT_SECTIONS.find(item => item.id === projectSection);
  const selectedTeam = teams.find(item => item.id === team);
  const selectedTeamLabel = team === UNKNOWN_TEAM_FILTER ? 'неизвестно' : selectedTeam?.name ?? 'недоступна';
  const selectedType = RECORD_TYPES.find(item => item.id === recordType)!;
  const matchingProjectNames = allProjects.filter(name => projectMatchesSection(name, projectSection) && name !== UNKNOWN);
  const defaultProject = project !== 'all' && project !== UNKNOWN ? project : projectSection !== 'all' && matchingProjectNames.length === 1 ? matchingProjectNames[0] : '';
  const closedCount = filteredCards.filter(isClosedCard).length;
  const ready = !loading && identityReady && Boolean(username) && (!error || cards.length > 0);
  const dark = !mounted || resolvedTheme !== 'light';
  const today = mounted ? moscowDay(new Date()) : null;
  const dueSoon = unresolved.filter(card => moscowDay(card.dueAt) && (!today || moscowDay(card.dueAt)! >= today)).sort((a, b) => Date.parse(a.dueAt!) - Date.parse(b.dueAt!)).slice(0, 4);

  const clearFilters = () => { setProject('all'); setTeam('all'); setProjectSection('all'); setRecordType('all'); setServer('all'); setStatus('all'); setPriority('all'); setSearch(''); setSessionFilter('all'); setBlockerFilter('all'); };
  const navigate = (next: Screen) => { setScreen(next); setMobileMenu(false); };
  const chooseRecordType = (next: RecordType) => {
    setRecordType(next);
    const nextScreen = recordTypeScreen(next);
    if (nextScreen) navigate(nextScreen);
  };
  const chooseProject = (name: string) => { setProject(name); setProjectSection('all'); };
  const openCatalog = (view: 'projects' | 'teams' = 'projects') => { setCatalogView(view); navigate('catalog'); };
  const checkSession = async (session: KonturSession) => {
    if (sessionRequests.current.has(session.id) || session.operationId === UNKNOWN) return;
    const controller = new AbortController();
    sessionRequests.current.set(session.id, controller);
    setCheckingSessions(previous => new Set(previous).add(session.id));
    const timeout = setTimeout(() => controller.abort(), 25_000);
    let observation: SessionObservation;
    try {
      const response = await fetch(`/api/kanban/cards/${encodeURIComponent(session.cardId)}/execution?session=status&operationId=${encodeURIComponent(session.operationId)}`, {
        method: 'GET', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
      });
      const data: unknown = response.headers.get('content-type')?.toLowerCase().includes('application/json') ? await response.json().catch(() => null) : null;
      const checked = sessionObservation(data, session);
      if (!response.ok || !checked) {
        const failure = data && typeof data === 'object' ? data as Record<string, unknown> : null;
        const message = typeof failure?.error === 'string' ? failure.error.slice(0, 1000)
          : checked?.reason || (response.ok ? 'Ответ не подтверждает состояние этой сессии.' : `Состояние не получено. HTTP ${response.status}.`);
        throw new Error(message);
      }
      observation = checked;
    } catch (failure) {
      observation = { cardVersion: session.cardVersion, sessionId: session.sessionId === UNKNOWN ? null : session.sessionId,
        state: 'unknown', source: null, checkedAt: null, lastActivityAt: null,
        reason: controller.signal.aborted ? 'Проверка не завершилась за 25 секунд. Состояние неизвестно.' : failure instanceof Error ? failure.message : 'Проверка не удалась. Состояние неизвестно.' };
    } finally { clearTimeout(timeout); }
    if (sessionRequests.current.get(session.id) !== controller) return;
    sessionRequests.current.delete(session.id);
    setSessionObservations(previous => ({ ...previous, [session.id]: observation }));
    setCheckingSessions(previous => { const next = new Set(previous); next.delete(session.id); return next; });
  };
  const openCard = (card: KanbanCard) => setSelectedCardId(card.id);
  const newTask = (column: string = 'inbox') => { setDefaultColumn(column); setShowAdd(true); };
  const copy = useCallback((text: string, label: string) => {
    void (async () => {
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(text);
        notify(label);
      } catch { notify('Не удалось скопировать. Проверь разрешение браузера на буфер обмена.'); }
    })();
  }, [notify]);
  const handleCreate = useCallback(async (title: string, description: string, column: string, cardPriority: string, tags: string[], cardProject: string, assignees: string[], dueAt?: string, planning?: KanbanCardUpdates) => {
    if (column === 'done' || planning?.column === 'done') {
      recordDiagnostic('create', 0, 'verification_result_evidence_confirmation_required');
      throw new BoardMutationError('Новую задачу нельзя сразу создать завершённой. Выбери незавершённое состояние, сохрани задачу и проверь результат в её карточке. Введённые данные остались в форме.');
    }
    const saved = await createWithReviewGate(planning?.column ?? column, true, () => createCard(title, description, column, cardPriority, tags, cardProject, assignees, dueAt, planning));
    if (saved) { setSelectedCardId(saved.id); notify('Задача создана. Открыта сохранённая карточка.'); }
    return saved;
  }, [createCard, notify]);
  const handleUpdate = useCallback(async (id: string, updates: KanbanUpdateRequest, version?: number) => {
    if (updates.column === 'done' && cards.find(card => card.id === id)?.column !== 'done') {
      recordDiagnostic('update', 0, 'verification_result_evidence_confirmation_required');
      throw new BoardMutationError('Для завершения укажи результат и доказательство в блоке ручной проверки карточки. Обычное сохранение не закрывает задачу. Введённые данные остались в форме.');
    }
    const saved = await updateCard(id, updates, version);
    if (saved) notify('Изменения сохранены');
    return saved;
  }, [cards, updateCard, notify]);
  const handleReview = useCallback(async (id: string, action: HumanReviewAction, note: string, version: number) => {
    const response = await boardMutationRequest(`/api/kanban/cards/${encodeURIComponent(id)}/review`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, note, expectedVersion: version }),
    }, 'review');
    const data = await readMutationResponse(response, true, 'review');
    if (data.conflict) { await refresh(); return null; }
    if (!data.card) throw new BoardMutationError('Сервер не подтвердил решение. Обнови карточку перед повтором.');
    await refresh();
    notify(action === 'accept' ? 'Результат принят. Решение записано.' : 'Задача возвращена на доработку. Цель сохранена.');
    return data.card;
  }, [refresh, notify]);
  const handleDelete = useCallback(async (id: string) => { const saved = await deleteCard(id); if (saved) notify('Удаление подтверждено сервером'); return saved; }, [deleteCard, notify]);
  const startDrag = (event: DragEvent<HTMLElement>, card: KanbanCard) => {
    event.dataTransfer.setData('application/x-kontur-card-id', card.id); event.dataTransfer.effectAllowed = 'move'; setDragId(card.id);
  };
  const endDrag = () => { setDragId(null); setDropColumn(null); };
  const dropTask = async (event: DragEvent<HTMLElement>, column: KanbanColumn) => {
    event.preventDefault();
    const id = dragId; endDrag();
    if (!id || movingId) return;
    const card = cards.find(item => item.id === id);
    if (!card || card.column === column) return;
    if (column === 'done' || card.column === 'review' || card.needsReview) {
      openCard(card); notify(column === 'done' ? 'Открой результат и доказательства. Завершение доступно после ручной проверки.' : 'Сначала прими результат или верни задачу на доработку в карточке.'); return;
    }
    setMovingId(id);
    try { const saved = await moveCard(id, column); if (saved) notify(`Состояние сохранено: ${statusLabel(saved.column)}`); }
    catch (failure) { notify(mutationErrorMessage(failure)); }
    finally { setMovingId(null); }
  };
  const toggleRow = (id: string) => setExpandedRows(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const listCards = [...filteredCards].sort((a, b) => listSort === 'updated'
    ? (Date.parse(b.updated) || 0) - (Date.parse(a.updated) || 0)
    : listSort === 'due' ? (Date.parse(a.dueAt ?? '') || Infinity) - (Date.parse(b.dueAt ?? '') || Infinity) || attentionOrder(a, b) : attentionOrder(a, b));
  const observedSessionState = (session: KonturSession) => {
    const observation = sessionObservations[session.id];
    if (!observation) return session.state;
    if (observation.cardVersion !== session.cardVersion || observation.sessionId !== (session.sessionId === UNKNOWN ? null : session.sessionId)) return 'unknown';
    return observation.state;
  };
  const visibleSessions = sessions.filter(session => sessionFilter === 'all'
    || (sessionFilter === 'check' ? !sessionObservations[session.id] || observedSessionState(session) === 'unknown'
      : sessionFilter !== 'stalled' && observedSessionState(session) === sessionFilter));
  const visibleBlockers = blockers.filter(card => blockerFilter === 'all' || errorKind(card) === blockerFilter);
  const columns = DEFAULT_COLUMNS.filter(column => (status === 'all' || status === column.id) && (includeClosed || status === column.id || !['done', 'archived'].includes(column.id)));

  const cardButton = (card: KanbanCard, extra?: ReactNode) => {
    const facts = taskFacts(card);
    return <button type="button" key={card.id} className="k-attention-row" onClick={() => openCard(card)}>
      <ProjectMark project={facts.project} /><span className="k-attention-copy"><small>{facts.project} · {facts.machine}</small><strong>{card.title}</strong><span>{facts.nextStep}</span></span>
      <span className="k-attention-tail">{extra ?? <StatusBadge status={card.column} />}<ChevronRight size={16} /></span>
    </button>;
  };
  const projectCounts = projectCatalog.filter(item => (project === 'all' || item.name === project) && projectMatchesSection(item.name, projectSection) && projectMatchesTeam(item, activeTeam)).map(item => ({ ...item, cards: unresolved.filter(card => taskFacts(card).project === item.name), visibleTaskCount: filteredCards.filter(card => taskFacts(card).project === item.name).length }));
  const catalogTeams = buildTeamCatalog(projectCounts).filter(item => activeTeam === 'all' || activeTeam === item.id);
  const unknownTeamProjects = projectCounts.filter(item => item.teamUnknown);
  const navCount = (id: Screen) => id === 'blockers' ? scopedCards.filter(card => !isClosedCard(card) && hasBlocker(card)).length : id === 'sessions' ? getSessions(scopedCards).length : id === 'kanban' ? scopedCards.filter(card => !isClosedCard(card)).length : undefined;

  return <div className={`kontur-shell${mobileMenu ? ' menu-open' : ''}`} data-theme={dark ? 'dark' : 'light'}>
    <a className="k-skip" href="#kontur-main">Перейти к содержимому</a>
    {mobileMenu && <button type="button" className="k-sidebar-backdrop" onClick={() => setMobileMenu(false)} aria-label="Закрыть меню" tabIndex={-1} />}
    <aside className="k-sidebar" ref={sidebarRef} aria-label="Основная навигация" inert={Boolean(isMobile && !mobileMenu) || undefined}>
      <div className="k-brand-row"><button type="button" className="k-brand" onClick={() => navigate('overview')} aria-label="Контур, сводка"><span className="k-logo">К<span /></span><span><strong>контур<span>.</span></strong><small>РАБОЧЕЕ ПРОСТРАНСТВО</small></span></button><button type="button" className="k-icon-button k-mobile-close" onClick={() => setMobileMenu(false)} aria-label="Закрыть меню"><X size={18} /></button></div>
      <span className="k-nav-label">ОБЗОР РАБОТЫ</span>
      <nav className="k-navigation">{NAV.map(({ id, label, icon: Icon }) => <button type="button" key={id} className={screen === id ? 'is-active' : ''} aria-current={screen === id ? 'page' : undefined} onClick={() => navigate(id)}><Icon size={17} strokeWidth={1.7} /><span>{label}</span>{navCount(id) !== undefined && <span className="k-nav-count">{loading || !identityReady ? '…' : ready ? navCount(id) : UNKNOWN}</span>}</button>)}</nav>
      <div className="k-sidebar-project-head"><span className="k-nav-label">ПРОЕКТЫ</span><button type="button" onClick={() => openCatalog()}>Каталог<ArrowUpRight size={12} /></button></div>
      <p className="k-sidebar-project-note">Все доступные · {ready ? allProjects.length : loading || !identityReady ? '…' : UNKNOWN}</p>
      <div className="k-project-navigation" aria-label="Проекты">
        <button type="button" className={project === 'all' && projectSection === 'all' ? 'is-selected' : ''} aria-pressed={project === 'all' && projectSection === 'all'} onClick={() => { chooseProject('all'); navigate('kanban'); }}><FolderOpen size={13} /><span>Все проекты</span><small>{ready ? scopedCards.filter(card => !isClosedCard(card)).length : loading || !identityReady ? '…' : UNKNOWN}</small></button>
        {allProjects.map(name => <button type="button" key={name} className={project === name && projectSection === 'all' ? 'is-selected' : ''} aria-pressed={project === name && projectSection === 'all'} onClick={() => { chooseProject(name); navigate('kanban'); }} title={`${name}. Открытые задачи в выбранном представлении`}><span className="k-project-dot" data-tone={projectTone(name)} /><span>{name}</span><small>{ready ? scopedCards.filter(card => taskFacts(card).project === name && !isClosedCard(card)).length : loading || !identityReady ? '…' : UNKNOWN}</small></button>)}
        {!allProjects.length && <p className="k-sidebar-empty">{loading || !identityReady ? 'Загружаю проекты…' : 'Проекты пока неизвестны'}</p>}
      </div>
      <div className="k-sidebar-bottom"><a className="k-classic-link" href="/classic"><Columns3 size={14} />Классическая доска<ArrowUpRight size={13} /></a><div className="k-user"><span className="k-user-avatar"><UserRound size={17} /></span><span><strong>{username ?? UNKNOWN}</strong><small>Твой аккаунт доски</small></span><LockKeyhole size={13} /></div></div>
    </aside>

    <div className="k-workspace" inert={Boolean(isMobile && mobileMenu) || undefined}>
      <header className="k-topbar"><div className="k-breadcrumb"><button type="button" ref={menuRef} className="k-icon-button k-mobile-menu" aria-label="Открыть меню" aria-expanded={mobileMenu} onClick={() => setMobileMenu(true)}><Menu size={20} /></button><span>Рабочее пространство</span><ChevronRight size={13} /><strong>{currentNav.label}</strong></div><div className="k-topbar-actions"><details className="k-services-menu" onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }}><summary aria-label="Связанные сервисы"><ExternalLink size={15} /><span>Сервисы</span></summary><div className="k-services-dropdown"><ServiceLinks /></div></details><span className={`k-read-status${error ? ' is-stale' : ''}`} title={lastLoadedAt ? `Доска прочитана ${formatStamp(lastLoadedAt)} по Москве` : 'Последнее успешное чтение неизвестно'}><i />{refreshing ? 'Обновляю' : error ? 'Нужно обновить' : lastLoadedAt ? 'Данные доски' : 'Загрузка'}</span><button type="button" className="k-icon-button" aria-label={dark ? 'Включить светлую тему' : 'Включить тёмную тему'} onClick={() => setTheme(dark ? 'light' : 'dark')}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button></div></header>
      <main id="kontur-main" className="k-main" tabIndex={-1}>
        <div className="k-page-heading"><div><div className="k-eyebrow"><span className="k-lime-dot" />ЕДИНАЯ ТОЧКА ПРОДОЛЖЕНИЯ</div><h1>{currentNav.label}</h1><p>{currentNav.description}</p></div><div className="k-heading-actions">{screen === 'overview' && <button type="button" className={`k-button${daily ? ' is-selected' : ''}`} aria-pressed={daily} onClick={() => setDaily(value => !value)}><Sparkles size={15} />На каждый день</button>}<button type="button" className="k-button" disabled={loading || refreshing} onClick={() => void refresh()} aria-label="Обновить данные доски"><RefreshCw size={15} className={refreshing ? 'k-spin' : ''} /><span className="k-refresh-label">Обновить</span></button><button type="button" className="k-button k-button-primary" disabled={!username || loading} onClick={() => newTask()}><Plus size={17} /><span>Новая задача</span></button></div></div>

        <div className="k-filter-bar"><div className="k-filter-selects">
          <label className="k-select"><FolderKanban size={14} /><select aria-label="Фильтр по проекту" value={project} onChange={event => chooseProject(event.target.value)}><option value="all">Все проекты</option>{allProjects.map(name => <option key={name} value={name}>{name}</option>)}{project !== 'all' && !allProjects.includes(project) && <option value={project}>{project}</option>}</select><ChevronDown size={12} /></label>
          <label className="k-select"><Users size={14} /><select aria-label="Фильтр по команде" aria-describedby={teamCatalog.status !== 'ready' ? 'team-catalog-status' : undefined} value={team} disabled={teamCatalog.status === 'unavailable'} onChange={event => setTeam(event.target.value)}><option value="all">Все команды</option>{teams.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}<option value={UNKNOWN_TEAM_FILTER}>Команда неизвестна</option>{team !== 'all' && team !== UNKNOWN_TEAM_FILTER && !selectedTeam && <option value={team}>Команда из ссылки недоступна</option>}</select><ChevronDown size={12} /></label>
          <label className="k-select"><Server size={14} /><select aria-label="Фильтр по серверу или машине" value={server} onChange={event => setServer(event.target.value)}><option value="all">Все машины</option>{serverOptions.map(name => <option key={name} value={name}>{name}</option>)}{server !== 'all' && !serverOptions.includes(server) && <option value={server}>{server}</option>}</select><ChevronDown size={12} /></label>
          <label className="k-select"><Circle size={12} /><select aria-label="Фильтр по статусу задачи" value={status} onChange={event => setStatus(event.target.value)}><option value="all">Все статусы</option>{DEFAULT_COLUMNS.map(column => <option key={column.id} value={column.id}>{column.title}</option>)}</select><ChevronDown size={12} /></label>
          <label className="k-select"><Flag size={13} /><select aria-label="Фильтр по приоритету" value={priority} onChange={event => setPriority(event.target.value)}><option value="all">Приоритет</option>{Object.entries(PRIORITIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><ChevronDown size={12} /></label>
          <label className="k-select"><FileText size={13} /><select aria-label="Фильтр по типу записи" value={recordType} onChange={event => chooseRecordType(event.target.value as RecordType)}>{RECORD_TYPES.map(type => <option key={type.id} value={type.id}>{type.label}</option>)}</select><ChevronDown size={12} /></label>
          {hasFilters && <button type="button" className="k-reset-filters" title="Сбросить фильтры" aria-label="Сбросить фильтры" onClick={clearFilters}><X size={14} /></button>}
        </div><label className="k-search"><Search size={15} /><input ref={searchRef} aria-label="Поиск по задачам и контексту" value={search} onChange={event => setSearch(event.target.value)} placeholder="Поиск по задачам" /><kbd>⌘ K</kbd></label></div>
        {(selectedSection || project !== 'all' || team !== 'all' || recordType !== 'all') && <div className="k-filter-context" role="status">{selectedSection && <button type="button" onClick={() => setProjectSection('all')} aria-label={`Убрать фильтр старой ссылки ${selectedSection.name}`}>Старая ссылка: {selectedSection.name}<X size={11} /></button>}{project !== 'all' && <button type="button" onClick={() => chooseProject('all')} aria-label="Убрать фильтр проекта">Проект: {project}<X size={11} /></button>}{team !== 'all' && <button type="button" onClick={() => setTeam('all')} aria-label="Убрать фильтр команды">Команда: {selectedTeamLabel}<X size={11} /></button>}{recordType !== 'all' && <button type="button" onClick={() => setRecordType('all')} aria-label="Убрать фильтр типа записи">Тип: {selectedType.label}<X size={11} /></button>}{recordType !== 'all' && <span>В других представлениях показаны связанные задачи и записи.</span>}</div>}
        <div className="k-scope-row"><div className="k-responsibility"><span>Ответственность</span><div className="k-segmented k-scope-switch" aria-label="Ответственность за задачи">{([['mine', 'Моё', 'Задачи, где вы исполнитель или владелец без назначенного исполнителя'], ['shared', 'Общее', 'Общие задачи и задачи с несколькими участниками'], ['all', 'Всё', 'Все задачи, доступные вашему аккаунту']] as const).map(([value, label, hint]) => <button type="button" key={value} title={hint} aria-pressed={workspace === value} onClick={() => setWorkspace(value)}><UserRound size={12} />{label}</button>)}</div></div><span>{lastLoadedAt ? <>Прочитано <time dateTime={lastLoadedAt}>{formatStamp(lastLoadedAt)}</time> · МСК</> : 'Время успешного чтения неизвестно'}</span></div>
        {ready && teamCatalog.status !== 'ready' && <div id="team-catalog-status" className="k-notice" role="status"><Users size={16} /><p>{teamCatalog.status === 'unavailable' ? team === 'all' ? 'Связи с командами пока неизвестны. Проекты и задачи доступны.' : 'Связи с командами пока неизвестны. Фильтр команды временно не применяется, задачи доступны.' : 'Часть связей с командами неизвестна. Подтверждённые связи доступны в каталоге.'}</p><button type="button" className="k-text-button" onClick={() => openCatalog('teams')}>Команды<ArrowUpRight size={13} /></button></div>}

        {ready && selectedSection && matchingProjectNames.length === 0 && <div className="k-notice"><CircleHelp size={16} /><p>Раздел «{selectedSection.name}» из старой ссылки не сопоставлен ни одному доступному проекту. Выбери точный проект в каталоге.</p><button type="button" className="k-text-button" onClick={() => { setProjectSection('all'); openCatalog(); }}>Каталог проектов<ArrowUpRight size={13} /></button></div>}
        {error && <div className="k-alert" role="alert"><TriangleAlert size={18} /><div><strong>Не удалось обновить доску</strong><p>{error}</p>{cards.length > 0 && <small>Ниже сохранён последний успешно загруженный результат.</small>}</div><button type="button" className="k-button k-button-small" onClick={() => void refresh()} disabled={refreshing}>Повторить чтение</button></div>}
        {identityError && <div className="k-alert" role="alert"><LockKeyhole size={18} /><div><strong>Нужно подтвердить вход</strong><p>{identityError}</p></div><a className="k-button k-button-small" href="/auth/login">Войти</a><button type="button" className="k-text-button" onClick={() => setIdentityAttempt(value => value + 1)}>Проверить вход</button></div>}
        {rolesError && <div className="k-notice"><CircleHelp size={15} /><p>{rolesError}</p><button type="button" className="k-text-button" onClick={() => setRolesAttempt(value => value + 1)}>Повторить</button></div>}
        {selectedCardId && !selectedCard && !loading && !error && username && <div className="k-notice" role="status"><CircleHelp size={16} /><p>Карточка по ссылке не найдена среди доступных задач.</p><button type="button" className="k-text-button" onClick={() => setSelectedCardId(null)}>Закрыть</button></div>}
        {(loading || !identityReady) && <div className="k-loading" role="status"><RefreshCw size={21} className="k-spin" /><span>Загружаю задачи и подтверждаю доступ…</span><div className="k-loading-grid"><i /><i /><i /><i /></div></div>}

        {ready && screen === 'catalog' && <section className="k-catalog" aria-label="Каталог проектов и команд">
          <div className="k-section-toolbar"><div className="k-segmented" aria-label="Представление каталога"><button type="button" aria-pressed={catalogView === 'projects'} onClick={() => setCatalogView('projects')}><FolderKanban size={14} />Проекты<span>{projectCatalog.length}</span></button><button type="button" aria-pressed={catalogView === 'teams'} onClick={() => setCatalogView('teams')}><Users size={14} />Команды<span>{teamCatalog.status === 'unavailable' ? UNKNOWN : teams.length}</span></button></div><span className="k-catalog-coverage">Доступные вашему аккаунту</span></div>
          <p className="k-catalog-explainer">Проект задаёт направление работы, команда объединяет участников. Показываем связи, подтверждённые рабочими сервисами. У проекта может быть несколько команд.</p>
          {catalogView === 'projects' ? <><div className="k-catalog-grid">{projectCounts.map(item => <article className="k-panel k-catalog-card" key={item.name}>
            <header><ProjectMark project={item.name} /><div><h2>{item.name}</h2><p>{item.taskCount ? `${item.taskCount} доступных задач` : 'Пока без задач'}</p></div></header>
            <dl><dt>Команды проекта</dt><dd className="k-catalog-tags">{item.teams.map(linked => <button type="button" key={linked.id} onClick={() => { setTeam(linked.id); setCatalogView('teams'); }}><Users size={12} />{linked.name}</button>)}{item.teamUnknown && <span className="k-unknown">неизвестно</span>}</dd></dl>
            <div className="k-catalog-counts"><span><strong>{item.openTaskCount}</strong> открытых всего</span><span><strong>{item.visibleTaskCount}</strong> задач по фильтрам</span></div>
            <button type="button" className="k-catalog-open" onClick={() => { chooseProject(item.name); navigate('kanban'); }}>Задачи проекта<ArrowRight size={14} /></button>
          </article>)}</div>{!projectCounts.length && <Empty title="Проекты по фильтрам не найдены" clear={hasFilters ? clearFilters : undefined}>Каталог включает доступные проекты и проекты из задач, в том числе без открытых целей.</Empty>}</> : <><div className="k-catalog-grid">{catalogTeams.map(item => <article className="k-panel k-catalog-card" key={item.id}>
            <header><span className="k-team-mark"><Users size={20} /></span><div><h2>{item.name}</h2><p>{item.projects.length} связанных проектов</p></div></header>
            <dl><dt>Проекты команды</dt><dd className="k-catalog-tags">{item.projects.map(linked => <button type="button" key={linked.name} onClick={() => { chooseProject(linked.name); navigate('kanban'); }}><FolderKanban size={12} />{linked.name}</button>)}</dd></dl>
            <div className="k-catalog-counts"><span><strong>{item.openTaskCount}</strong> открытых всего</span><span><strong>{filteredCards.filter(card => item.projects.some(linked => linked.name === taskFacts(card).project)).length}</strong> задач по фильтрам</span></div>
            <button type="button" className="k-catalog-open" onClick={() => { setTeam(item.id); navigate('kanban'); }}>Задачи команды<ArrowRight size={14} /></button>
          </article>)}</div>{!catalogTeams.length && <Empty title={teamCatalog.status === 'unavailable' ? 'Команды пока неизвестны' : 'Команды по фильтрам не найдены'} clear={hasFilters ? clearFilters : undefined}>Название проекта и состав исполнителей сами по себе не подтверждают команду.</Empty>}{unknownTeamProjects.length > 0 && <div className="k-notice"><CircleHelp size={16} /><p>Связь с командой неизвестна у {unknownTeamProjects.length} проектов.</p><button type="button" className="k-text-button" onClick={() => { setTeam(UNKNOWN_TEAM_FILTER); setCatalogView('projects'); }}>Показать проекты<ArrowRight size={13} /></button></div>}</>}
        </section>}

        {ready && screen === 'overview' && <>
          <div className="k-overview-date"><span>{mounted ? new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' }).format(new Date()) : ''}</span><span>{daily ? 'Короткий ежедневный обзор' : `${filteredCards.length} задач по текущим фильтрам`}</span></div>
          <section className="k-stats" aria-label="Сводные показатели">
            <button type="button" className="k-stat" onClick={() => { navigate('kanban'); setStatus('all'); }}><span>Открытые цели<FolderOpen size={17} /></span><strong>{unresolved.length}<small>в {new Set(unresolved.map(card => taskFacts(card).project)).size} проектах</small></strong><span className="k-stat-foot"><i />Сохранены для продолжения<ArrowUpRight size={13} /></span></button>
            <button type="button" className="k-stat" onClick={() => { navigate('list'); setStatus('review'); }}><span>На проверке<ShieldCheck size={17} /></span><strong>{reviewCards.length}<small>ждут решения</small></strong><span className="k-stat-foot k-violet"><i />Результат принимает человек<ArrowUpRight size={13} /></span></button>
            <button type="button" className="k-stat" onClick={() => navigate('blockers')}><span>Блокеры<TriangleAlert size={17} /></span><strong>{blockers.length}<small>открытых задач</small></strong><span className="k-stat-foot k-amber"><i />По сохранённым карточкам<ArrowUpRight size={13} /></span></button>
            <button type="button" className="k-stat" onClick={() => navigate('sessions')}><span>Агентские записи<Radio size={17} /></span><strong>{sessions.length}<small>связей с задачами</small></strong><span className="k-stat-foot"><i />Последнее известное состояние<ArrowUpRight size={13} /></span></button>
          </section>
          <div className="k-overview-grid"><div className="k-overview-primary">
            <section className="k-panel"><div className="k-panel-head"><div><h2><span className="k-focus-dot" />В фокусе сегодня</h2><p>Приёмка, блокеры и ближайшие следующие шаги</p></div><button type="button" className="k-text-button" onClick={() => navigate('list')}>Все задачи<ArrowRight size={14} /></button></div>{attentionCards.length ? attentionCards.slice(0, daily ? 6 : 5).map(card => cardButton(card)) : <Empty title="Открытых целей по фильтрам нет" clear={hasFilters ? clearFilters : undefined}>Завершённые задачи и история доступны в списке.</Empty>}</section>
            {!daily && <section className="k-panel"><div className="k-panel-head"><div><h2>Проекты<span className="k-count">{projectCounts.length}</span></h2><p>Открытые цели по текущим фильтрам</p></div><button type="button" className="k-text-button" onClick={() => openCatalog()}>Каталог<ArrowUpRight size={14} /></button></div><div className="k-project-table"><div className="k-project-table-header"><span>Проект</span><span>Открыто</span><span>Требует внимания</span></div>{projectCounts.map(item => <button type="button" key={item.name} className="k-project-row" onClick={() => { chooseProject(item.name); navigate('kanban'); }}><span><ProjectMark project={item.name} /><span className="k-project-identity"><strong>{item.name}</strong><small>Команды: {projectTeamLabel(item)}</small></span></span><span>{item.cards.length}<small>целей</small></span><span>{item.cards.some(hasBlocker) ? <><TriangleAlert size={13} />Есть блокеры</> : item.cards.some(card => card.column === 'review') ? <><ShieldCheck size={13} />Есть результат</> : <><Circle size={10} />{item.cards.length ? 'В работе с целями' : 'Нет открытых целей'}</>}<ArrowUpRight size={14} /></span></button>)}{!projectCounts.length && <Empty title="Проекты не найдены" clear={hasFilters ? clearFilters : undefined}>Каталог включает доступные проекты, в том числе пока без задач.</Empty>}</div></section>}
            {daily && <section className="k-panel"><div className="k-panel-head"><div><h2>Последние результаты</h2><p>Открой доказательства перед приёмкой</p></div><ShieldCheck size={18} /></div>{reviewCards.length ? reviewCards.slice(0, 4).map(card => cardButton(card, <span className="k-text-violet">Проверить</span>)) : <Empty title="Результатов на проверке нет">Новые результаты появятся после работы исполнителя.</Empty>}</section>}
          </div><aside className="k-overview-secondary">
            <section className="k-panel k-next-dates"><div className="k-panel-head"><div><h2><CalendarDays size={16} />Ближайшие сроки</h2><p>По Москве</p></div><button type="button" className="k-icon-button" aria-label="Открыть календарь" onClick={() => navigate('calendar')}><ArrowUpRight size={17} /></button></div>{dueSoon.length ? dueSoon.map(card => <button type="button" key={card.id} onClick={() => openCard(card)}><span className="k-date-chip">{new Intl.DateTimeFormat('ru', { day: 'numeric', timeZone: 'Europe/Moscow' }).format(new Date(card.dueAt!))}<small>{new Intl.DateTimeFormat('ru', { month: 'short', timeZone: 'Europe/Moscow' }).format(new Date(card.dueAt!))}</small></span><span><strong>{card.title}</strong><small>{taskFacts(card).project}</small></span></button>) : <p className="k-section-note">Ближайшие сроки неизвестны. Их можно указать в карточках.</p>}<button type="button" className="k-panel-footer-link" onClick={() => navigate('calendar')}>Весь календарь<ArrowRight size={14} /></button></section>
            <section className="k-panel k-services"><div className="k-panel-head"><h2>Рабочие сервисы</h2><ExternalLink size={15} /></div><ServiceLinks /></section>
            <section className="k-continuation"><Command size={23} /><span className="k-eyebrow">КОНТЕКСТ СОХРАНЁН</span><h2>Продолжить<br />с того же места.</h2><p>Результат, остаток работы и следующий шаг остаются в карточке задачи.</p><button type="button" onClick={() => navigate('kanban')}>Открыть незавершённое<ArrowRight size={15} /></button></section>
            {!daily && <section className="k-panel"><div className="k-panel-head"><h2>Последние действия</h2><Clock3 size={16} /></div><div className="k-mini-timeline">{activity.slice(0, 4).map(item => <button type="button" key={item.id} onClick={() => { const card = cards.find(candidate => candidate.id === item.cardId); if (card) openCard(card); }}><span className="k-timeline-dot" /><span><small>{formatStamp(item.at)}</small><strong>{item.title}</strong><p>{item.cardTitle}</p></span></button>)}{!activity.length && <p className="k-section-note">В доступных карточках пока нет записей о действиях.</p>}</div><button type="button" className="k-panel-footer-link" onClick={() => navigate('activity')}>Вся история<ArrowRight size={14} /></button></section>}
          </aside></div>
        </>}

        {ready && screen === 'kanban' && <section aria-label="Доска Kanban"><div className="k-section-toolbar"><div className="k-segmented"><button type="button" aria-pressed={status === 'all'} onClick={() => setStatus('all')}>Все состояния<span>{filteredCards.length}</span></button><button type="button" aria-pressed={status === 'review'} onClick={() => setStatus(status === 'review' ? 'all' : 'review')}>На проверке</button></div><label className="k-checkbox-label"><input type="checkbox" checked={includeClosed} onChange={event => setIncludeClosed(event.target.checked)} />Закрытые<span className="k-count">{closedCount}</span></label></div><div className="k-kanban-board">{columns.map(column => {
          const columnCards = filteredCards.filter(card => card.column === column.id).sort((a, b) => a.order - b.order);
          const limit = columnLimit[column.id] ?? 10;
          return <section key={column.id} className={`k-kanban-column${dropColumn === column.id ? ' is-drop-target' : ''}`} aria-label={`${column.title}: ${columnCards.length}`} onDragOver={event => { if (dragId) { event.preventDefault(); setDropColumn(column.id); } }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropColumn(null); }} onDrop={event => void dropTask(event, column.id)}><div className="k-column-head"><span className="k-column-dot" data-status={column.id} /><h2>{column.title}</h2><span>{columnCards.length}</span>{!['done', 'archived'].includes(column.id) && <button type="button" className="k-icon-button" aria-label={`Добавить задачу: ${column.title}`} onClick={() => newTask(column.id)}><Plus size={14} /></button>}</div><div className="k-column-body">{columnCards.slice(0, limit).map(card => <TaskCard key={card.id} card={card} projectInfo={projectsByName.get(taskFacts(card).project)} onOpen={openCard} onCopy={copy} onDragStart={startDrag} onDragEnd={endDrag} busy={movingId === card.id} />)}{!columnCards.length && <div className="k-column-empty">{column.id === 'done' ? <ShieldCheck size={22} /> : <Plus size={18} />}<p>{column.id === 'done' ? 'Здесь будут задачи с завершённой проверкой' : 'Задач в этом состоянии нет'}</p></div>}{columnCards.length > limit && <button type="button" className="k-load-more" onClick={() => setColumnLimit(value => ({ ...value, [column.id]: limit + 15 }))}>Ещё {columnCards.length - limit} задач</button>}</div></section>;
        })}</div><p className="k-section-note"><ShieldCheck size={14} />Карточки можно перетаскивать. Для завершения откроется ручная проверка. С клавиатуры меняй состояние в карточке.</p></section>}

        {ready && screen === 'list' && <section><div className="k-section-toolbar"><h2 className="k-section-title">Задачи<span className="k-count">{listCards.length}</span></h2><label className="k-select k-sort"><ArrowDownUp size={14} /><select value={listSort} aria-label="Сортировка списка" onChange={event => setListSort(event.target.value as typeof listSort)}><option value="priority">По вниманию и приоритету</option><option value="updated">По последнему изменению</option><option value="due">По сроку</option></select><ChevronDown size={12} /></label></div><div className="k-panel k-task-table-wrap">{listCards.length ? <table className="k-task-table"><thead><tr><th aria-label="Проверка" /><th>Задача</th><th>Состояние</th><th>Владелец / машина</th><th>Приоритет</th><th>Срок · МСК</th><th aria-label="Контекст" /></tr></thead><tbody>{listCards.slice(0, listLimit).map(card => {
          const facts = taskFacts(card); const expanded = expandedRows.has(card.id);
          return <Fragment key={card.id}><tr><td><button type="button" className={`k-review-open${hasAcceptedReview(card) ? ' is-verified' : ''}`} aria-label={`Открыть результат и проверку: ${card.title}`} title={hasAcceptedReview(card) ? 'Сохранено решение о приёмке' : 'Открыть результат и проверку'} onClick={() => openCard(card)}>{hasAcceptedReview(card) ? <CheckCheck size={17} /> : card.column === 'done' ? <Check size={17} /> : <Circle size={17} />}</button></td><td><button type="button" className="k-table-title" onClick={() => openCard(card)}><small><ProjectMark project={facts.project} small />{facts.project}</small><strong>{card.title}</strong><span>{facts.nextStep}</span></button></td><td><StatusBadge status={card.column} /></td><td><span className="k-table-person">{facts.owner}</span><small className="k-table-machine"><Server size={11} />{facts.machine}</small></td><td><PriorityBadge priority={card.priority} /></td><td className="k-table-date">{card.dueAt ? formatStamp(card.dueAt) : UNKNOWN}</td><td><button type="button" className="k-icon-button" aria-expanded={expanded} aria-label={`${expanded ? 'Свернуть' : 'Показать'} контекст: ${card.title}`} onClick={() => toggleRow(card.id)}><ChevronDown size={15} className={expanded ? 'k-rotate' : ''} /></button></td></tr>{expanded && <tr className="k-table-detail"><td colSpan={7}><CardFacts card={card} projectInfo={projectsByName.get(facts.project)} onCopy={copy} /></td></tr>}</Fragment>;
        })}</tbody></table> : <Empty title="Задачи не найдены" clear={hasFilters ? clearFilters : undefined}>Измени фильтры или создай новую задачу.</Empty>}{listCards.length > listLimit && <button type="button" className="k-load-more" onClick={() => setListLimit(value => value + 60)}>Показать ещё · осталось {listCards.length - listLimit}</button>}</div><p className="k-section-note"><ShieldCheck size={14} />Кнопка проверки открывает задачу. Закрытие требует результата, доказательства и подтверждения человека.</p></section>}

        {ready && screen === 'calendar' && <KonturCalendar cards={filteredCards} onOpen={openCard} />}

        {ready && screen === 'sessions' && <section>
          <div className="k-section-toolbar"><div className="k-scroll-tabs">{SESSION_FILTERS.map(([value, label]) => <button type="button" key={value} aria-pressed={sessionFilter === value} onClick={() => setSessionFilter(value)}>{label}</button>)}</div><span className="k-count" aria-label={sessionFilter === 'stalled' ? 'Количество зависших сессий неизвестно' : undefined}>{sessionFilter === 'stalled' ? UNKNOWN : visibleSessions.length}</span></div>
          <div className="k-notice"><CircleHelp size={17} /><p>Показаны сессии, связанные с карточками. Вкладки используют последнюю проверку, а до неё сохранённую запись. Это не непрерывный мониторинг. Давность записи не означает зависание.</p></div>
          <div className="k-session-grid">{visibleSessions.map(session => {
            const observation = sessionObservations[session.id];
            const changed = Boolean(observation && (observation.cardVersion !== session.cardVersion || observation.sessionId !== (session.sessionId === UNKNOWN ? null : session.sessionId)));
            const liveState = changed ? 'unknown' : observation?.state ?? 'unknown';
            const checking = checkingSessions.has(session.id);
            return <article className="k-panel k-session-card" key={session.id}>
              <div className="k-session-head"><ProjectMark project={session.project} /><span className="k-session-state" data-state={session.state}><i />{session.stateLabel}</span></div>
              <span className="k-eyebrow">{session.project}</span><h2>{session.cardTitle}</h2>
              <div className="k-session-owner"><span title="Владелец связанной задачи"><UserRound size={13} />{session.owner}</span><PriorityBadge priority={session.priority} /></div>
              <div className="k-session-facts"><span><Terminal size={13} />{session.harness}</span><span><Server size={13} />{session.machine}</span></div>
              <dl className="k-session-ids">
                <div><dt>Сессия</dt><dd>{session.sessionId}</dd></div>
                <div><dt>По проверке</dt><dd className={`k-session-observed${liveState === 'unknown' ? ' k-unknown' : ''}`} data-state={liveState}>{LIVE_SESSION_LABELS[liveState]}</dd></div>
                <div><dt>Проверено</dt><dd>{observation?.checkedAt ? formatStamp(observation.checkedAt) : UNKNOWN}</dd></div>
                {observation?.lastActivityAt && <div><dt>Последняя активность</dt><dd>{formatStamp(observation.lastActivityAt)}</dd></div>}
              </dl>
              <p className="k-session-time"><Clock3 size={12} />Сохранённая запись от {formatStamp(session.updatedAt)}</p>
              {observation?.source && <p className="k-session-source">Источник проверки: Agent Herder</p>}
              {changed ? <p className="k-session-check-note">После проверки карточка изменилась. Проверь состояние ещё раз.</p> : observation?.reason ? <p className="k-session-check-note">{observation.reason}</p> : !observation && <p className="k-session-source">Текущее состояние ещё не проверено.</p>}
              <div className="k-session-actions">
                <button type="button" className="k-button k-button-small" onClick={() => { const card = cardsById.get(session.cardId); if (card) openCard(card); }}>Открыть задачу<ArrowRight size={13} /></button>
                <button type="button" className="k-button k-button-small" disabled={checking || session.operationId === UNKNOWN} onClick={() => void checkSession(session)} aria-label={`Проверить состояние сессии задачи ${session.cardTitle}`}><RefreshCw size={12} className={checking ? 'k-spin' : ''} />{checking ? 'Проверяю' : 'Проверить состояние'}</button>
                {session.href && <a className="k-text-button" href={session.href} target="_blank" rel="noopener noreferrer">Сессия<ArrowUpRight size={14} /></a>}
              </div>
            </article>;
          })}</div>
          {!visibleSessions.length && <Empty title={sessionFilter === 'stalled' ? 'Подтверждённых зависших сессий нет' : 'Записи о сессиях не найдены'} clear={hasFilters || sessionFilter !== 'all' ? clearFilters : undefined}>{sessionFilter === 'stalled' ? 'Источник не сообщает подтверждённое зависание. Наличие зависших сессий неизвестно; возраст записи не используется как доказательство.' : 'По выбранным фильтрам нет сохранённых привязок. Сессии вне доступных карточек и их текущее состояние неизвестны.'}</Empty>}
        </section>}

        {ready && screen === 'blockers' && <section><div className="k-error-filters">{([['all', 'Все блокеры'], ['ACL', 'Доступ · ACL'], ['429', 'Квоты · 429'], ['ENAMETOOLONG', 'Файлы · ENAMETOOLONG'], ['other', 'Другие']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={blockerFilter === value} onClick={() => setBlockerFilter(value)}>{label}<span>{blockers.filter(card => value === 'all' || errorKind(card) === value).length}</span></button>)}</div><div className="k-notice"><Clock3 size={16} /><p>Блокеры взяты из открытых карточек. Последнее изменение указано рядом; оно не подтверждает, что ошибка воспроизводится сейчас.</p></div><div className="k-blocker-list">{visibleBlockers.map(card => { const facts = taskFacts(card); return <article className="k-panel k-blocker-card" key={card.id}><span className="k-blocker-icon"><TriangleAlert size={21} /></span><div><div className="k-blocker-meta"><span>{facts.project}</span><span>·</span><span>{facts.machine}</span>{errorKind(card) !== 'other' && <span className="k-error-tag">{errorKind(card)}</span>}</div><button type="button" className="k-blocker-title" onClick={() => openCard(card)}>{card.title}</button><p>{facts.blocker}</p><div className="k-blocker-next"><ArrowRight size={13} /><span>{facts.nextStep}</span></div></div><div className="k-blocker-tail"><StatusBadge status={card.column} /><small>{formatStamp(card.updated)}</small><button type="button" className="k-text-button" onClick={() => openCard(card)}>Открыть<ArrowUpRight size={14} /></button></div></article>; })}</div>{!visibleBlockers.length && <Empty title="Блокеры по фильтрам не найдены" clear={hasFilters || blockerFilter !== 'all' ? clearFilters : undefined}>Здесь появятся задачи с указанным блокером или состоянием «Заблокировано».</Empty>}</section>}

        {ready && screen === 'releases' && <section><div className="k-section-toolbar"><h2 className="k-section-title">Сохранённые ссылки<span className="k-count">{releases.length}</span></h2></div><div className="k-notice"><GitPullRequest size={17} /><p>Ссылки взяты из доказательств задач. Наличие ссылки не подтверждает слияние PR или успешную выкладку; актуальный статус неизвестен.</p></div><div className="k-release-grid">{releases.slice(0, journalLimit).map(release => <article className="k-panel k-release-card" key={release.id}><div className="k-release-top"><span><GitPullRequest size={15} />{release.kind === 'pr' ? 'Pull request' : release.kind === 'commit' ? 'Коммит' : release.kind === 'deployment' ? 'Выкладка' : release.kind === 'release' ? 'Релиз' : 'Ссылка'}</span><span>{release.project}</span></div><h2>{release.title}</h2><code>{release.reference}</code><p>Статус: <span className="k-unknown">{release.state}</span></p><button type="button" className="k-release-source" onClick={() => { const card = cards.find(item => item.id === release.cardId); if (card) openCard(card); }}><FileText size={13} /><span>{release.cardTitle}</span><ChevronRight size={13} /></button><div className="k-release-footer"><small>{formatStamp(release.at)}</small>{release.href && <a className="k-text-button" href={release.href} target="_blank" rel="noopener noreferrer">Открыть<ArrowUpRight size={14} /></a>}</div></article>)}</div>{!releases.length && <Empty title="Ссылок на PR и выкладки пока нет" clear={hasFilters ? clearFilters : undefined}>Добавь ссылку в доказательство результата задачи. Неизвестные релизы не создаются автоматически.</Empty>}{releases.length > journalLimit && <button type="button" className="k-load-more" onClick={() => setJournalLimit(value => value + 50)}>Показать ещё · осталось {releases.length - journalLimit}</button>}</section>}

        {ready && screen === 'decisions' && <section><div className="k-section-toolbar"><h2 className="k-section-title">Решения по задачам<span className="k-count">{decisions.length}</span></h2><span className="k-subtle">Автор и время сохранены в карточке</span></div><div className="k-decision-list">{decisions.slice(0, journalLimit).map((decision, index) => <article className="k-panel k-decision-card" key={decision.id}><span className="k-decision-index">{String(index + 1).padStart(2, '0')}</span><div className="k-decision-copy"><div className="k-entry-meta"><span>{decision.project}</span><span>·</span><span>{formatStamp(decision.at)}</span></div><h2>{decision.title}</h2><p>{decision.note || UNKNOWN}</p><small><UserRound size={12} />{decision.actor || UNKNOWN}</small><Evidence refs={decision.refs} /><button type="button" className="k-text-button" onClick={() => { const card = cards.find(item => item.id === decision.cardId); if (card) openCard(card); }}>{decision.cardTitle}<ArrowUpRight size={14} /></button></div><span className="k-decision-kind" data-decision={decision.decision}>{decision.decision === 'accepted' ? <ShieldCheck size={18} /> : decision.decision === 'rework' ? <RefreshCw size={18} /> : <MessageSquare size={18} />}</span></article>)}</div>{!decisions.length && <Empty title="Решений по фильтрам пока нет" clear={hasFilters ? clearFilters : undefined}>Приёмка, возврат на доработку и ответы исполнителям записываются через карточку задачи.</Empty>}{decisions.length > journalLimit && <button type="button" className="k-load-more" onClick={() => setJournalLimit(value => value + 50)}>Показать ещё · осталось {decisions.length - journalLimit}</button>}</section>}

        {ready && screen === 'activity' && <section><div className="k-section-toolbar"><h2 className="k-section-title">История работы<span className="k-count">{activity.length}</span></h2><span className="k-subtle">Время по Москве</span></div><div className="k-panel k-activity-list">{activity.slice(0, journalLimit).map(item => <details key={item.id} className="k-activity-entry"><summary><span className="k-activity-icon"><Activity size={16} /></span><span className="k-activity-summary"><small>{item.project} · {formatStamp(item.at)}</small><strong>{item.title}</strong><span>{item.cardTitle}</span></span><ChevronDown size={15} /></summary><div className="k-activity-detail"><p>{item.detail || UNKNOWN}</p><small>Автор: {item.actor || UNKNOWN}</small><Evidence refs={item.refs} /><button type="button" className="k-text-button" onClick={() => { const card = cards.find(candidate => candidate.id === item.cardId); if (card) openCard(card); }}>Открыть задачу<ArrowRight size={14} /></button></div></details>)}{!activity.length && <Empty title="История по фильтрам не найдена" clear={hasFilters ? clearFilters : undefined}>Новые результаты, решения и записи выполнения появятся здесь.</Empty>}{activity.length > journalLimit && <button type="button" className="k-load-more" onClick={() => setJournalLimit(value => value + 50)}>Показать ещё · осталось {activity.length - journalLimit}</button>}</div></section>}

        <div className="k-native-diagnostics" hidden={screen !== 'blockers'}><BoardDiagnosticsPanel identity={username} /></div>
        <footer className="k-footer"><span><LockKeyhole size={12} />{username ? ready ? `${filteredCards.length} задач в выбранной области` : 'Количество задач неизвестно' : 'Доступ к доске проверяется'}<span className="k-footer-dot">·</span>Цели и история сохраняются</span><button type="button" className="k-text-button" onClick={() => copy(window.location.href, 'Ссылка на текущее представление скопирована')}><Copy size={12} />Ссылка на вид</button></footer>
      </main>
    </div>

    <AddCardDialog requireReviewBeforeDone projectOptions={projectOptions} relatedCards={scopedCards} defaultProject={defaultProject} ownerPreview={username} roles={roles} open={showAdd} onOpenChange={setShowAdd} defaultColumn={defaultColumn} onCreate={handleCreate} />
    {selectedCard && <CardEditDialog requireReviewBeforeDone projectOptions={projectOptions} relatedCards={scopedCards} breadcrumbCards={scopedCards} roles={roles} card={selectedCard} username={username} onRefresh={refresh} open onOpenChange={open => { if (!open) setSelectedCardId(null); }} onUpdate={handleUpdate} onDelete={handleDelete} onReviewDecision={handleReview} onSelectCard={openCard} />}
    {conflict && <ConflictDialog conflict={conflict} onResolve={async useServer => {
      if (!useServer && conflict.clientCard.column === 'done' && conflict.serverCard.column !== 'done') {
        recordDiagnostic('update', 0, 'verification_result_evidence_confirmation_required');
        throw new BoardMutationError('На сервере задача больше не завершена. Выбери серверную версию и пройди ручную проверку результата; старый статус «Готово» не переносится автоматически.');
      }
      const resolved = await resolveConflict(useServer);
      // An explicit conflict choice ends this edit session. Ordinary remote
      // updates must keep the user's draft and its original CAS baseline.
      if (resolved) setSelectedCardId(null);
      return resolved;
    }} />}
    {toast && <div className="k-toast" role="status"><span className="k-lime-dot" /><span>{toast}</span><button type="button" className="k-icon-button" aria-label="Закрыть уведомление" onClick={() => setToast('')}><X size={14} /></button></div>}
  </div>;
}
