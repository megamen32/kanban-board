'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { X, Plus, Trash2 } from 'lucide-react';
import { DEFAULT_COLUMNS, PRIORITY_COLORS } from '@/lib/kanban/types';
import type { KanbanCard, Priority, KanbanColumn } from '@/lib/kanban/types';

interface Props {
  card: KanbanCard;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete?: (id: string) => void;
  onUpdate?: (id: string, updates: Partial<KanbanCard>, version?: number) => Promise<KanbanCard | null>;
}

export function CardEditDialog({ card, open, onOpenChange, onDelete, onUpdate }: Props) {
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);
  const [column, setColumn] = useState(card.column);
  const [priority, setPriority] = useState<Priority>(card.priority);
  const [tags, setTags] = useState<string[]>(card.tags);
  const [project, setProject] = useState(card.project);
  const [assignees, setAssignees] = useState(card.assignees.join(', '));
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
  }, [card]);

  const handleSave = async () => {
    if (!title.trim() || !onUpdate) return;
    setSaving(true);
    await onUpdate(card.id, {
      title: title.trim(),
      description: description.trim(),
      column: column as KanbanColumn,
      priority,
      tags,
      project: project.trim(),
      assignees: assignees.split(',').map(value => value.trim()).filter(Boolean),
    }, card.version);
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
            </div>
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
