'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { X, Plus } from 'lucide-react';
import { DEFAULT_COLUMNS } from '@/lib/kanban/types';
import type { KanbanCard, Priority } from '@/lib/kanban/types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultColumn: string;
  onCreate: (title: string, description: string, column: string, priority: string, tags: string[], project: string, assignees: string[]) => Promise<KanbanCard | undefined>;
}

export function AddCardDialog({ open, onOpenChange, defaultColumn, onCreate }: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [column, setColumn] = useState(defaultColumn);
  const [priority, setPriority] = useState<Priority>('medium');
  const [tags, setTags] = useState<string[]>([]);
  const [project, setProject] = useState('');
  const [assignees, setAssignees] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!title.trim() || !project.trim()) return;
    setSubmitting(true);
    await onCreate(title.trim(), description.trim(), column, priority, tags, project.trim(), assignees.split(',').map(value => value.trim()).filter(Boolean));
    setTitle('');
    setDescription('');
    setTags([]);
    setProject('');
    setAssignees('');
    setTagInput('');
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
