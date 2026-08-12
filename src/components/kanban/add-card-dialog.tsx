'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { X, Plus } from 'lucide-react';
import { DEFAULT_COLUMNS } from '@/lib/kanban/types';
import type { KanbanCard, Priority, PlanningType } from '@/lib/kanban/types';
import { fromDateTimeLocalValue } from '@/lib/kanban/date-input';

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
  onCreate: (title: string, description: string, column: string, priority: string, tags: string[], project: string, assignees: string[], dueAt?: string, planning?: ReturnType<typeof buildPlanningMetadataCreate>) => Promise<KanbanCard | undefined>;
}

export function AddCardDialog({ open, onOpenChange, defaultColumn, onCreate }: Props) {
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

  const handleSubmit = async () => {
    if (!title.trim() || !project.trim()) return;
    setSubmitting(true);
    await onCreate(title.trim(), description.trim(), column, priority, tags, project.trim(), assignees.split(',').map(value => value.trim()).filter(Boolean), fromDateTimeLocalValue(dueAt), buildPlanningMetadataCreate(planning));
    setTitle('');
    setDescription('');
    setTags([]);
    setProject('');
    setAssignees('');
    setDueAt('');
    setTagInput('');
    setPlanning({ type: 'action', role: '', important: false, urgent: false, scheduledAt: '', todayRank: '', waitingFor: '', requiresApprovalFrom: '', suggestedAssignee: '', parent: '' });
    setSubmitting(false);
    onOpenChange(false);
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTagInput('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Новая задача</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <Input
            placeholder="Название задачи"
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            autoFocus
          />

          <Textarea
            placeholder="Описание (markdown)"
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={4}
          />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Проект *</label>
              <Input placeholder="Hermes, Xcode..." value={project} onChange={e => setProject(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Ответственные</label>
              <Input placeholder="через запятую" value={assignees} onChange={e => setAssignees(e.target.value)} />
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Срок</label>
            <Input type="datetime-local" value={dueAt} onChange={e => setDueAt(e.target.value)} />
          </div>

          <div className="space-y-3 rounded-md border p-3">
            <label className="text-sm font-medium">Планирование</label>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-muted-foreground">Тип<select className="mt-1 h-9 w-full rounded-md border bg-transparent px-2 text-sm" value={planning.type} onChange={e => setPlanning({ ...planning, type: e.target.value as PlanningMetadataForm['type'] })}><option value="action">Действие</option><option value="outcome">Результат</option></select></label>
              <label className="text-xs text-muted-foreground">Роль<Input className="mt-1" placeholder="Из «Роли»" value={planning.role} onChange={e => setPlanning({ ...planning, role: e.target.value })} /></label>
            </div>
            <div className="flex flex-wrap gap-4 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={planning.important} onChange={e => setPlanning({ ...planning, important: e.target.checked })} /> Важно</label><label className="flex items-center gap-2"><input type="checkbox" checked={planning.urgent} onChange={e => setPlanning({ ...planning, urgent: e.target.checked })} /> Срочно</label></div>
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
              <div className="flex gap-1">
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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button onClick={handleSubmit} disabled={!title.trim() || !project.trim() || submitting}>Создать</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
