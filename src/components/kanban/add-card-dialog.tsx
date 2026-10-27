'use client';

import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, X, Plus } from 'lucide-react';
import { DEFAULT_COLUMNS } from '@/lib/kanban/types';
import type { KanbanCard, Priority, PlanningType, RoleDefinition } from '@/lib/kanban/types';
import { RolePicker } from './role-picker';
import { fromDateTimeLocalValue } from '@/lib/kanban/date-input';
import { mutationErrorMessage } from '../../lib/kanban/mutation-response';
import { ASSIGNEE_AUTHORIZATION_NOTICE, createFailureMessage, isAssigneeAuthorizationFailure } from './create-form-errors';

export interface PlanningMetadataForm {
  type: PlanningType;
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

/** Converts the editable planning controls into the server-facing card fields. */
export function buildPlanningMetadataCreate(form: PlanningMetadataForm) {
  return {
    type: form.type,
    ...(form.role ? { role: form.role } : {}),
    important: form.important,
    urgent: form.urgent,
    ...(form.scheduledAt ? { scheduledAt: fromDateTimeLocalValue(form.scheduledAt) } : {}),
    ...(form.todayRank ? { todayRank: Number(form.todayRank) as 1 | 2 | 3 } : {}),
    waitingFor: splitPeople(form.waitingFor),
    requiresApprovalFrom: splitPeople(form.requiresApprovalFrom),
    ...(form.suggestedAssignee.trim() ? { suggestedAssignee: form.suggestedAssignee.trim() } : {}),
    ...(form.parent.trim() ? { parent: form.parent.trim() } : {}),
  };
}

function splitPeople(value: string) {
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultColumn: string;
  defaultProject?: string;
  ownerPreview?: string | null;
  roles?: RoleDefinition[];
  projectOptions?: string[];
  onCreate: (title: string, description: string, column: string, priority: string, tags: string[], project: string, assignees: string[], dueAt?: string, planning?: ReturnType<typeof buildPlanningMetadataCreate>) => Promise<KanbanCard | undefined>;
}

export function AddCardDialog({ open, onOpenChange, defaultColumn, defaultProject = '', ownerPreview = 'nikita', onCreate, roles, projectOptions = [] }: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [column, setColumn] = useState(defaultColumn);
  const [priority, setPriority] = useState<Priority>('medium');
  const [tags, setTags] = useState<string[]>([]);
  const [project, setProject] = useState('');
  const [assignees, setAssignees] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [planning, setPlanning] = useState<PlanningMetadataForm>({ type: 'action', role: '', important: false, urgent: false, scheduledAt: '', todayRank: '', waitingFor: '', requiresApprovalFrom: '', suggestedAssignee: '', parent: '' });
  const [tagInput, setTagInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [assigneeBlocked, setAssigneeBlocked] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const alertRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { if (open) { setColumn(defaultColumn); setProject(defaultProject); setError(null); setAssigneeBlocked(false); setAdvancedOpen(false); } }, [open, defaultColumn, defaultProject]);

  // A refusal has to reach the user without hunting for it under the fold.
  useEffect(() => {
    if (!error) return;
    alertRef.current?.focus();
    alertRef.current?.scrollIntoView({ block: 'start' });
  }, [error]);

  const typedAssignees = () => assignees.split(',').map(value => value.trim()).filter(Boolean);

  const submit = async (withoutAssignees = false) => {
    if (!title.trim() || !project.trim() || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    setAssigneeBlocked(false);
    const requestedAssignees = typedAssignees();
    try {
    const saved = await onCreate(title.trim(), description.trim(), column, priority, tags, project.trim(), withoutAssignees ? [] : requestedAssignees, fromDateTimeLocalValue(dueAt), buildPlanningMetadataCreate(planning));
    if (!saved) { setError('Создание не подтверждено. Введённые данные остались в форме.'); return; }
    setTitle('');
    setDescription('');
    setTags([]);
    setProject('');
    setAssignees('');
    setDueAt('');
    setTagInput('');
    setAdvancedOpen(false);
    setPlanning({ type: 'action', role: '', important: false, urgent: false, scheduledAt: '', todayRank: '', waitingFor: '', requiresApprovalFrom: '', suggestedAssignee: '', parent: '' });
    onOpenChange(false);
    } catch (failure) {
      const message = mutationErrorMessage(failure);
      const blocked = requestedAssignees.length > 0 && isAssigneeAuthorizationFailure(message);
      setAssigneeBlocked(blocked);
      setError(createFailureMessage(message, requestedAssignees.length > 0));
    }
    finally { submittingRef.current = false; setSubmitting(false); }
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTagInput('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid-rows-[auto_minmax(0,1fr)_auto] max-h-[calc(100dvh-2rem)] overflow-hidden p-4 sm:max-w-[520px] sm:p-6">
        <DialogHeader>
          <DialogTitle>Новая задача</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Название, проект, ответственные и описание видны сразу. Дополнительные поля — по запросу.{' '}
            {ownerPreview
              ? `Владелец новой задачи — ${ownerPreview}; профиль доски — только фильтр.`
              : 'Владелец определяется серверной учётной записью; профиль доски — только фильтр.'}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain pr-1">
          {error && (
            <div
              ref={alertRef}
              role="alert"
              tabIndex={-1}
              className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive focus:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
            >
              <p className="font-medium">Задача не создана</p>
              <p className="mt-1">{error}</p>
              {assigneeBlocked && (
                <div className="mt-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => void submit(true)} disabled={submitting}>
                    Создать без ответственного
                  </Button>
                </div>
              )}
            </div>
          )}

          <div>
            <label htmlFor="create-title" className="mb-1 block text-xs text-muted-foreground">Название *</label>
            <Input
              id="create-title"
              placeholder="Что нужно сделать"
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } }}
              autoFocus
            />
          </div>

          <div>
            <label htmlFor="create-project" className="mb-1 block text-xs text-muted-foreground">Проект *</label>
            <Input id="create-project" aria-label="Проект" list="kanban-create-projects" placeholder="UX QA 2026-10-26" value={project} onChange={e => setProject(e.target.value)} />
            <datalist id="kanban-create-projects">{projectOptions.map(name => <option key={name} value={name} />)}</datalist>
          </div>

          <div>
            <label htmlFor="create-assignees" className="mb-1 block text-xs text-muted-foreground">Ответственные</label>
            <Input
              id="create-assignees"
              placeholder="через запятую"
              value={assignees}
              onChange={e => setAssignees(e.target.value)}
              aria-invalid={assigneeBlocked || undefined}
              aria-describedby={assigneeBlocked ? 'create-assignees-error' : 'create-assignees-hint'}
            />
            {assigneeBlocked ? (
              <p id="create-assignees-error" className="mt-1 text-xs text-destructive">{ASSIGNEE_AUTHORIZATION_NOTICE}</p>
            ) : (
              <p id="create-assignees-hint" className="mt-1 text-xs text-muted-foreground">
                Кому выполнять. Назначить другого человека может только владелец доски.
              </p>
            )}
          </div>

          <div>
            <label htmlFor="create-description" className="mb-1 block text-xs text-muted-foreground">Описание</label>
            <Textarea
              id="create-description"
              placeholder="Причина, результат или следующий шаг (можно Markdown)"
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Статус</label>
            <div className="flex flex-wrap gap-1">
              {DEFAULT_COLUMNS.map(col => (
                <Badge
                  key={col.id}
                  variant={column === col.id ? 'default' : 'outline'}
                  className="cursor-pointer"
                  onClick={() => setColumn(col.id)}
                >
                  {col.title}
                </Badge>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full justify-between"
              aria-expanded={advancedOpen}
              aria-controls="create-advanced-fields"
              onClick={() => setAdvancedOpen(value => !value)}
            >
              <span>Дополнительные поля</span>
              <ChevronDown className={`h-4 w-4 transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
            </Button>

            {advancedOpen && (
              <div id="create-advanced-fields" className="space-y-4 rounded-md border p-3">
                <div>
                  <label htmlFor="create-due" className="mb-1 block text-xs text-muted-foreground">Срок</label>
                  <Input id="create-due" type="datetime-local" value={dueAt} onChange={e => setDueAt(e.target.value)} />
                </div>

                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Приоритет</label>
                  <div className="flex flex-wrap gap-1">
                    {(['low', 'medium', 'high', 'critical'] as Priority[]).map(p => (
                      <Badge
                        key={p}
                        variant={priority === p ? 'default' : 'outline'}
                        className="cursor-pointer"
                        onClick={() => setPriority(p)}
                      >
                        {p}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Теги</label>
                  <div className="mb-2 flex flex-wrap gap-1">
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
                    <Button type="button" variant="outline" size="sm" onClick={addTag}><Plus className="h-3 w-3" /></Button>
                  </div>
                </div>

                <div className="space-y-3 rounded-md border p-3">
                  <label className="text-sm font-medium">Планирование</label>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="text-xs text-muted-foreground">Тип<select className="mt-1 h-9 w-full rounded-md border bg-transparent px-2 text-sm" value={planning.type} onChange={e => setPlanning({ ...planning, type: e.target.value as PlanningMetadataForm['type'] })}><option value="action">Действие</option><option value="outcome">Результат</option></select></label>
                    <label className="text-xs text-muted-foreground">Роль<RolePicker roles={roles} value={planning.role} onChange={role => setPlanning({ ...planning, role })} /></label>
                  </div>
                  <div className="flex flex-wrap gap-4 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={planning.important} onChange={e => setPlanning({ ...planning, important: e.target.checked })} /> Важно</label><label className="flex items-center gap-2"><input type="checkbox" checked={planning.urgent} onChange={e => setPlanning({ ...planning, urgent: e.target.checked })} /> Срочно</label></div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><label className="text-xs text-muted-foreground">Планировать на дату<Input className="mt-1" type="datetime-local" value={planning.scheduledAt} onChange={e => setPlanning({ ...planning, scheduledAt: e.target.value })} /></label><label className="text-xs text-muted-foreground">Ранг Today<select className="mt-1 h-9 w-full rounded-md border bg-transparent px-2 text-sm" value={planning.todayRank} onChange={e => setPlanning({ ...planning, todayRank: e.target.value })}><option value="">Нет</option><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></label></div>
                  <Input placeholder="Ждём от (ID через запятую)" value={planning.waitingFor} onChange={e => setPlanning({ ...planning, waitingFor: e.target.value })} />
                  <Input placeholder="Требует согласования от (ID через запятую)" value={planning.requiresApprovalFrom} onChange={e => setPlanning({ ...planning, requiresApprovalFrom: e.target.value })} />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><Input placeholder="Предложенный исполнитель" value={planning.suggestedAssignee} onChange={e => setPlanning({ ...planning, suggestedAssignee: e.target.value })} /><Input placeholder="Родительская карточка" value={planning.parent} onChange={e => setPlanning({ ...planning, parent: e.target.value })} /></div>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button type="button" onClick={() => void submit()} disabled={!title.trim() || !project.trim() || submitting}>
            {submitting ? 'Сохраняю…' : 'Создать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
