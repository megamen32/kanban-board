'use client';

import { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { X, Plus, Trash2 } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { DEFAULT_COLUMNS } from '@/lib/kanban/types';
import type { KanbanCard, Priority, KanbanColumn, PlanningType, RoleDefinition } from '@/lib/kanban/types';
import type { HumanReviewAction } from '@/lib/kanban/transition-policy';
import { CatalogLinkPanel } from './catalog-link-panel';
import { NoticeQuestionPanel } from './notice-question-panel';
import { BoardQuestionPanel } from './board-question-panel';
import { RolePicker } from './role-picker';
import { fromDateTimeLocalValue, toDateTimeLocalValue } from '@/lib/kanban/date-input';
import type { KanbanUpdateRequest } from '@/hooks/use-kanban';
import { initialPlanningMetadata } from './initial-planning';
import { mutationErrorMessage } from '../../lib/kanban/mutation-response';
import { ReviewActionGate, reviewActionAccess } from './review-action-gate';
import { CardExecutionOverview } from './card-execution-overview';
import { MarkdownText } from './markdown-text';
import { CardBriefPanel } from './card-brief-panel';
import { CardCalendarSection, type CalendarBridgeStatus } from './card-calendar-section';
import { TaskReferenceLinks } from './task-reference-links';
import { hasCardHistory } from './card-history';
import { CardHierarchyPanel } from './card-hierarchy-panel';
import { getEligibleParentCards } from './card-hierarchy';
import { canCompleteDirectly, canTakeOwnReview } from './card-completion';
import { ResultVerification } from './result-verification';
import { IntegratorTaskDashboard } from './integrator-task-dashboard';
import { isTaskActor, taskPersonLabel } from '@/lib/kanban/task-membership';
import { usesLegacyNoticeQuestion, shouldRefreshExecutionCard } from './card-question-visibility';

const MarkdownEditor = dynamic(() => import('./markdown-editor').then(module => module.MarkdownEditor), {
  ssr: false,
  loading: () => <div role="status" className="min-h-[45vh] rounded-md border p-4 text-sm text-muted-foreground">Загружаю редактор…</div>,
});

interface Props {
  card: KanbanCard;
  open: boolean;
  username?: string | null;
  onRefresh?: () => Promise<unknown> | void;
  roles?: RoleDefinition[];
  projectOptions?: string[];
  relatedCards?: KanbanCard[];
  breadcrumbCards?: KanbanCard[];
  onOpenChange: (open: boolean) => void;
  onDelete?: (id: string) => Promise<unknown>;
  onUpdate?: (id: string, updates: KanbanUpdateRequest, version?: number) => Promise<KanbanCard | null>;
  onReviewDecision?: (id: string, action: HumanReviewAction, note: string, version: number) => Promise<KanbanCard | null>;
  onSelectCard?: (card: KanbanCard) => void;
  /** Kontur requires a recorded human check before either completion path. */
  requireReviewBeforeDone?: boolean;
}

export interface PlanningMetadataForm {
  type: PlanningType | '';
  role: string;
  important: boolean;
  urgent: boolean;
  scheduledAt: string;
  todayRank: string;
  waitingFor: string;
  requiresApprovalFrom: string;
  suggestedAssignee: string;
  parent: string;
}

function splitPeople(value: string) {
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

/** Builds editable planning fields and keeps reassignment evidence separate from audit evidence. */
export function buildPlanningMetadataUpdates(card: KanbanCard, form: PlanningMetadataForm, nextAssignees: string[]) {
  const updates: Record<string, unknown> = {
    type: form.type || null,
    role: form.role || null,
    important: form.important,
    urgent: form.urgent,
    scheduledAt: form.scheduledAt ? fromDateTimeLocalValue(form.scheduledAt) : null,
    todayRank: form.todayRank ? Number(form.todayRank) as 1 | 2 | 3 : null,
    waitingFor: splitPeople(form.waitingFor),
    requiresApprovalFrom: splitPeople(form.requiresApprovalFrom),
    suggestedAssignee: form.suggestedAssignee.trim() || null,
    parent: form.parent.trim() || null,
    assignees: nextAssignees,
  };
  if (JSON.stringify(nextAssignees) !== JSON.stringify(card.assignees)) {
    updates.reassignmentIntent = 'direct-owner-command';
    updates.reassignmentEvidence = { source: 'owner-confirmation' };
  }
  return updates as KanbanUpdateRequest;
}

export function CardEditDialog({ card, open, onOpenChange, onDelete, onUpdate, onReviewDecision, onSelectCard, roles, projectOptions = [], relatedCards = [], breadcrumbCards = relatedCards, username, onRefresh, requireReviewBeforeDone = false }: Props) {
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);
  const [editingDescription, setEditingDescription] = useState(false);
  const [nextAction, setNextAction] = useState(card.nextAction ?? '');
  const [blockerReason, setBlockerReason] = useState(card.blockerReason ?? '');
  const [column, setColumn] = useState(card.column);
  const [priority, setPriority] = useState<Priority>(card.priority);
  const [tags, setTags] = useState<string[]>(card.tags);
  const [project, setProject] = useState(card.project);
  const [assignees, setAssignees] = useState(card.assignees.join(', '));
  const [reassignmentConfirmed, setReassignmentConfirmed] = useState(false);
  const [dueAt, setDueAt] = useState(toDateTimeLocalValue(card.dueAt));
  const [planning, setPlanning] = useState<PlanningMetadataForm>(() => initialPlanningMetadata(card));
  const [tagInput, setTagInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [reviewNote, setReviewNote] = useState('');
  const [verificationOpen, setVerificationOpen] = useState(false);
  const verificationRef = useRef<HTMLDivElement>(null);
  const [baseline, setBaseline] = useState(card);
  const [calendarStatus, setCalendarStatus] = useState<CalendarBridgeStatus | 'unavailable' | null>(null);
  const [calendarDuration, setCalendarDuration] = useState(60);
  const [calendarSyncing, setCalendarSyncing] = useState(false);
  const [calendarEventId, setCalendarEventId] = useState<string | null>(null);
  const [calendarMessage, setCalendarMessage] = useState<string | null>(null);
  const pollInFlight = useRef(false);

  useEffect(() => {
    setTitle(card.title);
    setDescription(card.description);
    setEditingDescription(false);
    setNextAction(card.nextAction ?? '');
    setBlockerReason(card.blockerReason ?? '');
    setColumn(card.column);
    setPriority(card.priority);
    setTags(card.tags);
    setProject(card.project);
    setAssignees(card.assignees.join(', '));
    setReassignmentConfirmed(false);
    setBaseline(card);
    setError(null);
    setReviewNote('');
    setVerificationOpen(false);
    setDueAt(toDateTimeLocalValue(card.dueAt));
    setPlanning(initialPlanningMetadata(card));
    // A remote update must not erase unsaved input or silently advance its CAS.
  }, [card.id, open]);

  useEffect(() => {
    if (verificationOpen) verificationRef.current?.scrollIntoView({block: 'center', behavior: 'smooth'});
  }, [verificationOpen]);

  // Calendar bridge state is per user and lives only while the dialog is open.
  useEffect(() => {
    if (!open || !card.dueAt) return;
    let active = true;
    setCalendarStatus(null);
    setCalendarEventId(null);
    setCalendarMessage(null);
    void (async () => {
      try {
        const [statusResponse, eventResponse] = await Promise.all([
          fetch('/api/kanban/calendar/status', { cache: 'no-store' }),
          fetch(`/api/kanban/cards/${encodeURIComponent(card.id)}/calendar`, { cache: 'no-store' }),
        ]);
        if (!active) return;
        setCalendarStatus(statusResponse.ok ? await statusResponse.json() as CalendarBridgeStatus : 'unavailable');
        if (eventResponse.ok) {
          const data = await eventResponse.json() as { event?: { eventId?: string } | null };
          setCalendarEventId(data.event?.eventId ?? null);
        }
      } catch {
        if (active) setCalendarStatus('unavailable');
      }
    })();
    return () => { active = false; };
  }, [card.id, card.dueAt, open]);

  const handleCalendarSync = async () => {
    if (calendarSyncing) return;
    setCalendarSyncing(true);
    setCalendarMessage(null);
    try {
      const response = await fetch(`/api/kanban/cards/${encodeURIComponent(card.id)}/calendar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ durationMinutes: calendarDuration }),
      });
      const data = await response.json().catch(() => null) as { event?: { eventId?: string }; error?: string } | null;
      if (response.ok && data?.event?.eventId) {
        setCalendarEventId(data.event.eventId);
        return;
      }
      if (response.status === 409 && (data?.error === 'keeper_not_connected' || data?.error === 'calendar_sync_pending')) {
        setCalendarMessage('Календарь не подключён или синхронизация ещё не подтверждена.');
        return;
      }
      if (response.status === 409 && data?.error === 'project_calendar_not_configured') {
        setCalendarMessage('Для проекта карточки календарь не настроен. Событие не создано.');
        return;
      }
      if (response.status === 409 && data?.error === 'calendar_rebind_manual_required') {
        setCalendarMessage('Проект или календарь изменился. Нужна ручная сверка существующего события в Keeper.');
        return;
      }
      setCalendarMessage('Не удалось создать событие. Попробуйте позже.');
    } catch {
      setCalendarMessage('Не удалось связаться с сервером календаря.');
    } finally {
      setCalendarSyncing(false);
    }
  };

  const watchExecution = shouldRefreshExecutionCard(card);
  useEffect(() => {
    if (!open || !onRefresh || !watchExecution) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'hidden' || pollInFlight.current) return;
      pollInFlight.current = true;
      void Promise.resolve().then(onRefresh).catch(() => undefined).finally(() => {
        pollInFlight.current = false;
      });
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [card.id, onRefresh, open, watchExecution]);

  const handleSave = async () => {
    if (!title.trim() || !project.trim() || !onUpdate || saving) return;
    if (requireReviewBeforeDone && column === 'done' && baseline.column !== 'done') {
      setError('Сначала сохраните правки задачи, затем нажмите «Завершить задачу» для проверки результата.');
      setColumn(baseline.column); return;
    }
    const nextAssignees = assignees.split(',').map(value => value.trim()).filter(Boolean);
    const assigneesChanged = JSON.stringify(nextAssignees) !== JSON.stringify(baseline.assignees);
    if (assigneesChanged && !reassignmentConfirmed) return;
    setSaving(true);
    setError(null);
    try {
    const updates: KanbanUpdateRequest = {
      title: title.trim(),
      description: description.trim(),
      ...(nextAction.trim() !== (baseline.nextAction ?? '') ? { nextAction: nextAction.trim() || null } : {}),
      blockerReason: blockerReason.trim() || null,
      column: column as KanbanColumn,
      priority,
      tags,
      project: project.trim(),
      assignees: nextAssignees,
      dueAt: fromDateTimeLocalValue(dueAt) || null,
      ...buildPlanningMetadataUpdates(baseline, planning, nextAssignees),
    };
    const saved = await onUpdate(card.id, updates, baseline.version);
    if (!saved) { setError('Карточка изменилась. Разрешите конфликт версий; ваш текст остался в форме.'); return; }
    onOpenChange(false);
    } catch (failure) { setError(mutationErrorMessage(failure)); }
    finally { setSaving(false); }
  };

  const hasUnsavedDraft = title !== baseline.title || description !== baseline.description
    || nextAction !== (baseline.nextAction ?? '') || blockerReason !== (baseline.blockerReason ?? '')
    || column !== baseline.column || priority !== baseline.priority || project !== baseline.project
    || assignees !== baseline.assignees.join(', ') || dueAt !== toDateTimeLocalValue(baseline.dueAt)
    || JSON.stringify(tags) !== JSON.stringify(baseline.tags) || !!tagInput.trim()
    || JSON.stringify(planning) !== JSON.stringify(initialPlanningMetadata(baseline));

  const cleanDraftForDecision = () => {
    if (hasUnsavedDraft) {
      setError('В форме есть несохранённые изменения. Сначала сохраните их, затем примите решение по результату.');
      return false;
    }
    if (baseline.version !== card.version) {
      setError('Карточка обновилась во время просмотра. Закройте её и откройте снова, чтобы проверить актуальную версию.');
      return false;
    }
    return true;
  };

  const handleComplete = async () => {
    if (!onUpdate || saving || !canCompleteDirectly(card, username)) return;
    if (!cleanDraftForDecision()) return;
    if (requireReviewBeforeDone) { setVerificationOpen(true); return; }
    setSaving(true);
    setError(null);
    try {
      // Completing a real task is a human action, not a synthetic automation update.
      // Without verified browser identity, the ordinary API would redirect "done" to review.
      const response = await fetch('/api/auth/session', { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) {
        setError('Чтобы завершить задачу, войдите в свой аккаунт доски.');
        return;
      }
      const session = await response.json() as { authenticated?: boolean; username?: string; scope?: string };
      const allowedActor = isTaskActor(card, session.username);
      if (!session.authenticated || session.scope !== 'work' || !allowedActor) {
        setError('Завершить задачу может только её подтверждённый владелец или исполнитель.');
        return;
      }
      // Only update the status: do not submit the whole form, reset unsaved fields,
      // change assignees or accidentally request another approval.
      const saved = await onUpdate(card.id, { column: 'done' }, card.version);
      if (!saved) { setError('Карточка изменилась. Обновите её перед завершением.'); return; }
      if (saved.column !== 'done') { setError('Завершение не подтверждено сервером.'); return; }
      onOpenChange(false);
    } catch (failure) { setError(mutationErrorMessage(failure)); }
    finally { setSaving(false); }
  };

  const handleTakeReview = async () => {
    if (!onUpdate || saving || !canTakeOwnReview(card, username)) return;
    if (!cleanDraftForDecision()) return;
    setSaving(true);
    setError(null);
    try {
      // Existing owner-only reviewer assignment: never overwrite a result or decide on behalf of another reviewer.
      const saved = await onUpdate(card.id, { requiresApprovalFrom: ['nikita'] }, card.version);
      if (!saved) { setError('Карточка изменилась. Обновите её перед назначением проверки.'); return; }
      setBaseline(saved);
      setPlanning(initialPlanningMetadata(saved));
      onSelectCard?.(saved);
    } catch (failure) { setError(mutationErrorMessage(failure)); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!onDelete || saving) return;
    setSaving(true); setError(null);
    try { await onDelete(card.id); onOpenChange(false); }
    catch (failure) { setError(mutationErrorMessage(failure)); }
    finally { setSaving(false); }
  };

  const handleReview = async (action: HumanReviewAction) => {
    if (!onReviewDecision || saving) return;
    if (!cleanDraftForDecision()) return;
    if (requireReviewBeforeDone && action === 'accept') { setVerificationOpen(true); return; }
    setSaving(true);
    setError(null);
    try {
      const saved = await onReviewDecision(card.id, action, reviewNote, card.version);
      if (!saved) { setError('Карточка изменилась. Обновите её и повторите решение.'); return; }
      onOpenChange(false);
    } catch (failure) { setError(mutationErrorMessage(failure)); }
    finally { setSaving(false); }
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTagInput('');
  };

  const executorAttempt = card.taskExecutionHistory?.at(-1);
  const hasLegacyNoticeQuestion = usesLegacyNoticeQuestion(card);
  const catalogLink = card.catalogLink;
  const reviewAccess = reviewActionAccess(card, username);
  const refreshExecution = async () => {
    if (!onRefresh || refreshing) return;
    setRefreshing(true);
    try { await onRefresh(); }
    catch (failure) { setError(mutationErrorMessage(failure)); }
    finally { setRefreshing(false); }
  };
  const parentChoices = getEligibleParentCards(card, relatedCards);
  const currentParentIsHidden = !!planning.parent && !parentChoices.some(item => item.id === planning.parent);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="fixed inset-0 left-0 top-0 flex h-dvh w-screen max-w-none min-w-0 translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:max-w-none">
        <DialogHeader className="shrink-0 border-b px-4 py-3 pr-14 text-left sm:px-6">
          <DialogTitle>Редактировать задачу</DialogTitle>
        </DialogHeader>
        {card && <TaskReferenceLinks card={card} />}

        <section aria-label="Быстрые настройки задачи" className="grid shrink-0 grid-cols-2 gap-2 border-b bg-muted/20 p-3 sm:grid-cols-3 lg:grid-cols-6 lg:gap-3 lg:px-6">
          <label className="min-w-0 space-y-1 text-xs text-muted-foreground">Проект
            <Input aria-label="Проект" list="kanban-edit-projects" value={project} onChange={e => setProject(e.target.value)} className="w-full min-w-0" />
            <datalist id="kanban-edit-projects">{projectOptions.map(name => <option key={name} value={name} />)}</datalist>
          </label>
          <label className="min-w-0 space-y-1 text-xs text-muted-foreground">Состояние
            <select aria-label="Состояние задачи" disabled={card.column === 'review' || card.needsReview} value={column} onChange={e => setColumn(e.target.value as KanbanColumn)} className="h-10 w-full min-w-0 rounded-md border bg-background px-2 text-sm text-foreground disabled:opacity-60">
              {DEFAULT_COLUMNS.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select>
          </label>
          <label className="min-w-0 space-y-1 text-xs text-muted-foreground">Приоритет
            <select aria-label="Приоритет задачи" value={priority} onChange={e => setPriority(e.target.value as Priority)} className="h-10 w-full min-w-0 rounded-md border bg-background px-2 text-sm text-foreground">
              <option value="critical">Срочный</option><option value="high">Высокий</option><option value="medium">Обычный</option><option value="low">Низкий</option>
            </select>
          </label>
          <label className="min-w-0 space-y-1 text-xs text-muted-foreground">Владелец
            <Input aria-label="Владелец карточки" value={(card.owner?.trim() ? taskPersonLabel(card.owner) : requireReviewBeforeDone ? 'неизвестно' : taskPersonLabel('nikita'))} readOnly className="w-full min-w-0 bg-muted/40" />
          </label>
          <div className="min-w-0 space-y-1 text-xs text-muted-foreground">Исполнитель(и)
            <Input aria-label="Исполнители" value={assignees} onChange={e => setAssignees(e.target.value)} placeholder="Не назначен" className="w-full min-w-0" />
            {JSON.stringify(assignees.split(',').map(value => value.trim()).filter(Boolean)) !== JSON.stringify(baseline.assignees) && (
              <label className="flex items-start gap-2 text-xs text-muted-foreground">
                <Checkbox checked={reassignmentConfirmed} onCheckedChange={value => setReassignmentConfirmed(value === true)} />
                <span>Подтвердить переназначение</span>
              </label>
            )}
          </div>
          <label className="min-w-0 space-y-1 text-xs text-muted-foreground">Срок
            <Input aria-label="Срок" aria-describedby="card-date-timezone" type="datetime-local" value={dueAt} onChange={e => setDueAt(e.target.value)} className="w-full min-w-0" />
          </label>
          <p id="card-date-timezone" className="col-span-2 text-xs text-muted-foreground sm:col-span-3 lg:col-span-6">Время вводится в часовом поясе браузера: {Intl.DateTimeFormat().resolvedOptions().timeZone || 'локальный'}. Календарь Контура показывает московское время.</p>
          <CardCalendarSection
            className="col-span-2 min-w-0 space-y-1 sm:col-span-3 lg:col-span-6"
            dueAt={card.dueAt}
            project={card.project}
            status={calendarStatus}
            durationMinutes={calendarDuration}
            onDurationChange={setCalendarDuration}
            onSync={() => void handleCalendarSync()}
            syncing={calendarSyncing}
            eventId={calendarEventId}
            message={calendarMessage}
            dueAtUnsaved={(fromDateTimeLocalValue(dueAt) || null) !== (card.dueAt ?? null)}
          />
          <label className="col-span-2 min-w-0 space-y-1 text-xs text-muted-foreground sm:col-span-1 lg:col-span-2">Следующий шаг
            <Input aria-label="Следующий шаг" value={nextAction} onChange={e => setNextAction(e.target.value)} maxLength={4000} placeholder="Например: запросить файл у поставщика" className="w-full min-w-0" />
          </label>
          {(column === 'blocked' || blockerReason) && <div className="col-span-2 min-w-0 space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 sm:col-span-3 lg:col-span-6">
            <label className="text-sm font-medium" htmlFor="kanban-blocker-reason">Что блокирует продолжение?</label>
            <Textarea id="kanban-blocker-reason" value={blockerReason} onChange={event => setBlockerReason(event.target.value)} rows={2} maxLength={2000} placeholder="Например: ждём файл от партнёра; ответственный и срок пока неизвестны." />
            <p className="text-xs text-muted-foreground">Эта причина сохраняется отдельно от описания задачи.</p>
          </div>}
        </section>

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-5">
        <div className="mx-auto w-full max-w-5xl min-w-0 space-y-4">
          <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.45fr)]">
          <section className="order-2 min-w-0 space-y-2 rounded-md border p-3 lg:order-2" aria-label="Жизненный цикл и результат">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Состояние</span>
              <Badge variant="outline">{DEFAULT_COLUMNS.find(item => item.id === card.column)?.title ?? card.column}</Badge>
              {card.needsReview && <Badge>Требуется приёмка</Badge>}
              <span className="text-xs text-muted-foreground">Владелец: {(card.owner?.trim() ? taskPersonLabel(card.owner) : requireReviewBeforeDone ? 'неизвестно' : taskPersonLabel('nikita'))}</span>
            </div>
            {card.nextAction && <p className="text-sm"><span className="font-medium">Следующий шаг:</span> {card.nextAction}</p>}
            {card.blockerReason && <p className="text-sm"><span className="font-medium">Что мешает:</span> {card.blockerReason}</p>}
            {card.column === 'blocked' && <p className="text-sm text-amber-700 dark:text-amber-300">Укажи причину блокировки ниже, чтобы было ясно, что нужно для продолжения.</p>}
            <CardExecutionOverview card={card} refreshing={refreshing} onRefresh={onRefresh ? () => { void refreshExecution(); } : undefined} />
            <div ref={verificationRef}>{verificationOpen && <ResultVerification card={card} onCancel={() => setVerificationOpen(false)} onSaved={saved => {
              onSelectCard?.(saved); void onRefresh?.(); onOpenChange(false);
            }} />}</div>
            {requireReviewBeforeDone && onRefresh && <details className="rounded-md border p-3" open>
              <summary className="cursor-pointer text-sm font-semibold">Работа агента</summary>
              <p className="my-2 text-xs text-muted-foreground">Запуск, продолжение и вопросы связаны с этой задачей. Результат проверяется отдельно.</p>
              <IntegratorTaskDashboard cards={[card]} onOpen={selected => onSelectCard?.(selected)} onRefresh={onRefresh}
                canAssignReviewer={username === 'nikita'}
                onAssignReviewer={async (id, reviewer, version) => onUpdate ? onUpdate(id, {requiresApprovalFrom: [reviewer]}, version) : null} />
            </details>}
            {card.pendingQuestion && <BoardQuestionPanel key={card.pendingQuestion.id} card={card} onAnswered={() => onRefresh?.()} />}
            {canTakeOwnReview(card, username) && onUpdate && (
              <div className="space-y-2 rounded-md border p-3">
                <p className="text-xs text-muted-foreground">
                  Ты владелец задачи, но проверка назначена другому. Сначала явно возьми проверку на себя, затем прими и закрой задачу.
                </p>
                <Button type="button" variant="outline" disabled={saving} onClick={() => void handleTakeReview()}>
                  Взять проверку
                </Button>
              </div>
            )}
            {reviewAccess !== 'not-awaiting-review' && <ReviewActionGate card={card} verifiedUsername={username}>
              {onReviewDecision && <div className="space-y-2 border-t pt-3">
                <p className="text-xs text-muted-foreground">{reviewAccess === 'owner-recovery' ? 'Укажите, что нужно исправить, чтобы вернуть задачу в работу.' : reviewAccess === 'owner-review' ? 'Вы можете принять и закрыть свою задачу или вернуть её в работу.' : 'Решение доступно назначенному проверяющему.'}</p>
                <Textarea aria-label="Комментарий к доработке" placeholder="Что нужно исправить" value={reviewNote} onChange={event => setReviewNote(event.target.value)} rows={2} />
                <div className="flex flex-wrap gap-2">
                  {(reviewAccess === 'authorized' || reviewAccess === 'owner-review') && <Button disabled={saving} onClick={() => void handleReview('accept')}>Принять и закрыть</Button>}
                  <Button variant="outline" disabled={saving || !reviewNote.trim()} onClick={() => void handleReview(reviewAccess === 'owner-recovery' ? 'recover-rework' : 'rework')}>Вернуть на доработку</Button>
                </div>
              </div>}
            </ReviewActionGate>}
            {hasCardHistory(card) && <details className="border-t pt-2">
              <summary className="cursor-pointer text-sm font-medium">История и связи</summary>
              <div className="mt-3 space-y-3">
            {(card.resultHistory ?? []).length > 0 && <div className="space-y-2">
              <h3 className="text-sm font-medium">Результаты исполнителя</h3>
              {[...(card.resultHistory ?? [])].reverse().map((result, index) => <article key={`${result.submittedAt}-${index}`} className="rounded border p-2 text-sm">
                <MarkdownText text={result.summary} />
                <p className="mt-1 text-xs text-muted-foreground">{result.submittedBy} · {new Date(result.submittedAt).toLocaleString()}</p>
                {result.runRef && <p className="break-all text-xs">Запуск: {result.runRef}</p>}
                {result.evidenceRefs.length > 0 && <div className="mt-1 text-xs"><span className="font-medium">Ссылки на подтверждения:</span><ul className="list-disc pl-5">{result.evidenceRefs.map((ref, refIndex) => <li key={`${ref}-${refIndex}`} className="break-all">{ref}</li>)}</ul></div>}
              </article>)}
            </div>}
            {(card.reviewHistory ?? []).length > 0 && <div className="space-y-1 text-xs">
              <h3 className="font-medium">Решения по результату</h3>
              {[...(card.reviewHistory ?? [])].reverse().map((review, index) => <p key={`${review.decidedAt}-${index}`}>
                {review.decision === 'accepted' ? 'Принято' : 'На доработку'} · {review.actor} · {new Date(review.decidedAt).toLocaleString()}{review.note ? ` · ${review.note}` : ''}
              </p>)}
            </div>}
              </div>
            </details>}
          </section>
          <div className="order-1 min-w-0 space-y-4 lg:order-1">
            <CardHierarchyPanel card={card} relatedCards={relatedCards} breadcrumbCards={breadcrumbCards} onSelectCard={onSelectCard} />
            <div className="min-w-0 space-y-2">
              <label className="text-sm font-medium" htmlFor="kanban-edit-title">Название задачи</label>
              <Input id="kanban-edit-title" value={title} onChange={e => setTitle(e.target.value)} className="w-full min-w-0 text-base" />
            </div>
            <CardBriefPanel autoSummarize card={{
              ...card,
              title: title === card.title ? card.title : title,
              description: description === card.description ? card.description : description,
              assignees: assignees === card.assignees.join(', ') ? card.assignees : splitPeople(assignees),
              dueAt: dueAt === toDateTimeLocalValue(card.dueAt) ? card.dueAt : dueAt ? new Date(dueAt).toISOString() : undefined,
              nextAction: nextAction === (card.nextAction ?? '') ? card.nextAction ?? null : nextAction.trim() || null,
              column: column === card.column ? card.column : column,
            }} />
            <details className="min-w-0 rounded-md border p-3">
              <summary className="cursor-pointer text-sm font-medium">Описание и ожидаемый результат</summary>
              <div className="mt-3 space-y-3">{editingDescription ? <MarkdownEditor value={description} onChange={setDescription} /> : <MarkdownText text={description} />}
                <Button type="button" size="sm" variant="outline" onClick={() => setEditingDescription(value => !value)}>{editingDescription ? 'Готово' : 'Редактировать описание'}</Button>
              </div>
            </details>
            <details className="min-w-0 rounded-md border p-3">
              <summary className="cursor-pointer text-sm font-medium">Планирование и дополнительные настройки</summary>
              <div className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-muted-foreground">Тип<select className="mt-1 h-9 w-full rounded-md border bg-transparent px-2 text-sm" value={planning.type} onChange={e => setPlanning({ ...planning, type: e.target.value as PlanningType | '' })}><option value="">Не выбран</option><option value="action">Действие</option><option value="outcome">Результат</option></select></label>
              <label className="text-xs text-muted-foreground">Роль<RolePicker roles={roles} value={planning.role} onChange={role => setPlanning({ ...planning, role })} /></label>
            </div>
            <div className="flex flex-wrap gap-4 text-sm"><label className="flex items-center gap-2"><Checkbox checked={planning.important} onCheckedChange={value => setPlanning({ ...planning, important: value === true })} /> Важно</label><label className="flex items-center gap-2"><Checkbox checked={planning.urgent} onCheckedChange={value => setPlanning({ ...planning, urgent: value === true })} /> Срочно</label></div>
            <div className="grid grid-cols-2 gap-3"><label className="text-xs text-muted-foreground">Планировать на дату<Input className="mt-1" type="datetime-local" value={planning.scheduledAt} onChange={e => setPlanning({ ...planning, scheduledAt: e.target.value })} /></label><label className="text-xs text-muted-foreground">Ранг Today<select className="mt-1 h-9 w-full rounded-md border bg-transparent px-2 text-sm" value={planning.todayRank} onChange={e => setPlanning({ ...planning, todayRank: e.target.value })}><option value="">Нет</option><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></label></div>
            <Input placeholder="Ждём от (ID через запятую)" value={planning.waitingFor} onChange={e => setPlanning({ ...planning, waitingFor: e.target.value })} />
            <Input placeholder="Требует согласования от (ID через запятую)" value={planning.requiresApprovalFrom} onChange={e => setPlanning({ ...planning, requiresApprovalFrom: e.target.value })} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input placeholder="Предложенный исполнитель" value={planning.suggestedAssignee} onChange={e => setPlanning({ ...planning, suggestedAssignee: e.target.value })} />
              <label className="text-xs text-muted-foreground">Родительская задача
                <select aria-label="Родительская задача" value={planning.parent} onChange={e => setPlanning({ ...planning, parent: e.target.value })} className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm text-foreground">
                  <option value="">Без родителя</option>
                  {currentParentIsHidden && <option value={planning.parent} disabled>Текущая связь недоступна в этом списке</option>}
                  {parentChoices.map(parentCard => <option key={parentCard.id} value={parentCard.id}>{parentCard.title}</option>)}
                </select>
              </label>
            </div>
              </div>
            </details>
            {hasLegacyNoticeQuestion && <NoticeQuestionPanel key={card.id} card={card} open={open} username={username ?? null} onRefresh={onRefresh} />}
            {catalogLink && <details className="min-w-0 rounded-md border p-3"><summary className="cursor-pointer text-sm font-medium">Источник и ссылки</summary><div className="mt-3"><CatalogLinkPanel link={catalogLink} /></div></details>}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Теги</label>
            <div className="flex flex-wrap gap-1 mb-2">
              {tags.map(tag => (
                <Badge key={tag} variant="secondary" className="gap-1">
                  {tag}
                  <X className="h-3 w-3 cursor-pointer" onClick={() => setTags(tags.filter(t => t !== tag))} />
                </Badge>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="Новый тег"
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag())}
                className="h-8"
              />
              <Button variant="outline" size="sm" onClick={addTag}><Plus className="h-3 w-3" /></Button>
            </div>
          </div>

          <div className="text-[10px] text-muted-foreground/60">
            ID: {card.id} · Файл: {card.fileName} · Версия: {card.version}
          </div>
          </div>
          </div>
        </div>
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t bg-background px-4 py-2 sm:px-6">
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex w-full items-center justify-between gap-2">
            {onDelete ? (
              <Button variant="destructive" size="sm" disabled={saving} onClick={handleDelete}>
                <Trash2 className="mr-1 h-3.5 w-3.5" /> Удалить
              </Button>
            ) : <span />}
            <div className="flex gap-2">
              {canCompleteDirectly(card, username) && onUpdate && <Button type="button" variant="outline" disabled={saving}
                className="border-emerald-600/40 text-emerald-700 dark:text-emerald-300" onClick={() => void handleComplete()}>Завершить задачу</Button>}
              <Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
              <Button onClick={handleSave} disabled={!title.trim() || !project.trim() || saving}>Сохранить</Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
