'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { X, Plus, Trash2 } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { DEFAULT_COLUMNS, PRIORITY_COLORS } from '@/lib/kanban/types';
import type { KanbanCard, Priority, KanbanColumn, PlanningType, RoleId } from '@/lib/kanban/types';
import { ROLE_IDS } from '@/lib/kanban/types';
import { fromDateTimeLocalValue, toDateTimeLocalValue } from '@/lib/kanban/date-input';
import type { KanbanUpdateRequest } from '@/hooks/use-kanban';

interface Props {
  card: KanbanCard;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete?: (id: string) => void;
  onUpdate?: (id: string, updates: KanbanUpdateRequest, version?: number) => Promise<KanbanCard | null>;
}

export interface PlanningMetadataForm {
  type: PlanningType | '';
  role: RoleId | '';
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

export function CardEditDialog({ card, open, onOpenChange, onDelete, onUpdate }: Props) {
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);
  const [column, setColumn] = useState(card.column);
  const [priority, setPriority] = useState<Priority>(card.priority);
  const [tags, setTags] = useState<string[]>(card.tags);
  const [project, setProject] = useState(card.project);
  const [assignees, setAssignees] = useState(card.assignees.join(', '));
  const [reassignmentConfirmed, setReassignmentConfirmed] = useState(false);
  const [dueAt, setDueAt] = useState(toDateTimeLocalValue(card.dueAt));
  const [planning, setPlanning] = useState<PlanningMetadataForm>({
    type: card.type ?? 'action', role: card.role ?? '', important: card.important ?? false, urgent: card.urgent ?? false,
    scheduledAt: card.scheduledAt ?? '', todayRank: card.todayRank?.toString() ?? '', waitingFor: card.waitingFor?.join(', ') ?? '',
    requiresApprovalFrom: card.requiresApprovalFrom?.join(', ') ?? '', suggestedAssignee: card.suggestedAssignee ?? '', parent: card.parent ?? '',
  });
  const [tagInput, setTagInput] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTitle(card.title);
    setDescription(card.description);
    setColumn(card.column);
    setPriority(card.priority);
    setTags(card.tags);
    setProject(card.project);
    setAssignees(card.assignees.join(', '));
    setReassignmentConfirmed(false);
    setDueAt(toDateTimeLocalValue(card.dueAt));
    setPlanning({
      type: card.type ?? 'action', role: card.role ?? '', important: card.important ?? false, urgent: card.urgent ?? false,
      scheduledAt: card.scheduledAt ?? '', todayRank: card.todayRank?.toString() ?? '', waitingFor: card.waitingFor?.join(', ') ?? '',
      requiresApprovalFrom: card.requiresApprovalFrom?.join(', ') ?? '', suggestedAssignee: card.suggestedAssignee ?? '', parent: card.parent ?? '',
    });
  }, [card]);

  const handleSave = async () => {
    if (!title.trim() || !onUpdate) return;
    const nextAssignees = assignees.split(',').map(value => value.trim()).filter(Boolean);
    const assigneesChanged = JSON.stringify(nextAssignees) !== JSON.stringify(card.assignees);
    if (assigneesChanged && !reassignmentConfirmed) return;
    setSaving(true);
    const updates: KanbanUpdateRequest = {
      title: title.trim(),
      description: description.trim(),
      column: column as KanbanColumn,
      priority,
      tags,
      project: project.trim(),
      assignees: nextAssignees,
      dueAt: fromDateTimeLocalValue(dueAt) || null,
      ...buildPlanningMetadataUpdates(card, planning, nextAssignees),
    };
    await onUpdate(card.id, updates, card.version);
    setSaving(false);
    onOpenChange(false);
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    await onDelete(card.id);
    onOpenChange(false);
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTagInput('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-auto bottom-0 translate-y-0 w-[calc(100%-1rem)] max-h-[92vh] overflow-y-auto rounded-t-2xl sm:top-[50%] sm:bottom-auto sm:translate-y-[-50%] sm:w-full sm:max-w-[520px] sm:rounded-lg">
        <DialogHeader>
          <DialogTitle>Редактировать задачу</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Название</label>
            <Input value={title} onChange={e => setTitle(e.target.value)} />
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Описание (markdown)</label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={6} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Проект *</label>
              <Input value={project} onChange={e => setProject(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Ответственные</label>
              <Input value={assignees} onChange={e => setAssignees(e.target.value)} placeholder="через запятую" />
              {JSON.stringify(assignees.split(',').map(value => value.trim()).filter(Boolean)) !== JSON.stringify(card.assignees) && (
                <label className="mt-2 flex items-start gap-2 text-xs text-muted-foreground">
                  <Checkbox checked={reassignmentConfirmed} onCheckedChange={value => setReassignmentConfirmed(value === true)} />
                  <span>Подтверждаю явное переназначение ответственных</span>
                </label>
              )}
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Срок</label>
            <Input type="datetime-local" value={dueAt} onChange={e => setDueAt(e.target.value)} />
          </div>

          <div className="space-y-3 rounded-md border p-3">
            <label className="text-sm font-medium">Планирование</label>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-muted-foreground">Тип<select className="mt-1 h-9 w-full rounded-md border bg-transparent px-2 text-sm" value={planning.type} onChange={e => setPlanning({ ...planning, type: e.target.value as PlanningType | '' })}><option value="">Не выбран</option><option value="action">Действие</option><option value="outcome">Результат</option></select></label>
              <label className="text-xs text-muted-foreground">Роль<select className="mt-1 h-9 w-full rounded-md border bg-transparent px-2 text-sm" value={planning.role} onChange={e => setPlanning({ ...planning, role: e.target.value as RoleId | '' })}><option value="">Не выбрана</option>{ROLE_IDS.map(role => <option key={role} value={role}>{role}</option>)}</select></label>
            </div>
            <div className="flex flex-wrap gap-4 text-sm"><label className="flex items-center gap-2"><Checkbox checked={planning.important} onCheckedChange={value => setPlanning({ ...planning, important: value === true })} /> Важно</label><label className="flex items-center gap-2"><Checkbox checked={planning.urgent} onCheckedChange={value => setPlanning({ ...planning, urgent: value === true })} /> Срочно</label></div>
            <div className="grid grid-cols-2 gap-3"><label className="text-xs text-muted-foreground">Планировать на дату<Input className="mt-1" type="datetime-local" value={planning.scheduledAt} onChange={e => setPlanning({ ...planning, scheduledAt: e.target.value })} /></label><label className="text-xs text-muted-foreground">Ранг Today<select className="mt-1 h-9 w-full rounded-md border bg-transparent px-2 text-sm" value={planning.todayRank} onChange={e => setPlanning({ ...planning, todayRank: e.target.value })}><option value="">Нет</option><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></label></div>
            <Input placeholder="Ждём от (ID через запятую)" value={planning.waitingFor} onChange={e => setPlanning({ ...planning, waitingFor: e.target.value })} />
            <Input placeholder="Требует согласования от (ID через запятую)" value={planning.requiresApprovalFrom} onChange={e => setPlanning({ ...planning, requiresApprovalFrom: e.target.value })} />
            <div className="grid grid-cols-2 gap-3"><Input placeholder="Предложенный исполнитель" value={planning.suggestedAssignee} onChange={e => setPlanning({ ...planning, suggestedAssignee: e.target.value })} /><Input placeholder="Родительская карточка" value={planning.parent} onChange={e => setPlanning({ ...planning, parent: e.target.value })} /></div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Колонка</label>
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
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Приоритет</label>
              <div className="flex flex-wrap gap-1">
                {(['low', 'medium', 'high', 'critical'] as Priority[]).map(p => (
                  <Badge
                    key={p}
                    variant={priority === p ? 'default' : 'outline'}
                    className={`cursor-pointer ${priority === p ? PRIORITY_COLORS[p] : ''}`}
                    onClick={() => setPriority(p)}
                  >
                    {p}
                  </Badge>
                ))}
              </div>
            </div>
          </div>

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

        <DialogFooter className="flex justify-between">
          {onDelete && (
            <Button variant="destructive" size="sm" onClick={handleDelete}>
              <Trash2 className="h-3.5 w-3.5 mr-1" /> Удалить
            </Button>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
            <Button onClick={handleSave} disabled={!title.trim() || !project.trim() || saving}>Сохранить</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
