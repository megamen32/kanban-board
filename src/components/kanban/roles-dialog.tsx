'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { RoleDefinition } from '@/lib/kanban/types';
import { mutationErrorMessage, readMutationResponse, BoardMutationError } from '../../lib/kanban/mutation-response';

export function RolesDialog({ owner, open, onOpenChange, onSaved }: {
  owner: string; open: boolean; onOpenChange: (open: boolean) => void; onSaved?: () => void;
}) {
  const [roles, setRoles] = useState<RoleDefinition[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoaded(false); setError(null);
    fetch(`/api/kanban/roles?owner=${encodeURIComponent(owner)}`, { signal: controller.signal })
      .then(response => readMutationResponse(response))
      .then(data => {
        if (!data.roles) throw new BoardMutationError('Не удалось загрузить роли. Сохранение не выполнялось.');
        setRoles(data.roles); setLoaded(true);
      })
      .catch(failure => { if (!controller.signal.aborted) setError(mutationErrorMessage(failure)); });
    return () => controller.abort();
  }, [open, owner]);
  const save = async () => {
    if (!loaded || saving) return;
    if (roles.some(role => !role.label.trim())) { setError('Введите название роли или удалите пустую строку.'); return; }
    setSaving(true); setError(null);
    try {
      const response = await fetch('/api/kanban/roles', {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ owner, roles }),
      });
      const data = await readMutationResponse(response);
      if (!data.roles) throw new BoardMutationError('Сохранение ролей не подтверждено. Ваши изменения остались в форме.');
      onSaved?.(); onOpenChange(false);
    } catch (failure) { setError(mutationErrorMessage(failure)); }
    finally { setSaving(false); }
  };
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-md">
      <DialogHeader><DialogTitle>Мои роли</DialogTitle></DialogHeader>
      <p className="text-sm text-muted-foreground">Роли личные. ИИ может предложить роль, но ты решаешь.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="space-y-2">{loaded && roles.map((role, index) =>
        <div className="flex gap-2" key={role.id}>
          <Input value={role.label} onChange={event => setRoles(current => current.map(item => item.id === role.id ? { ...item, label: event.target.value } : item))} />
          <Button variant="ghost" size="icon" aria-label={`Удалить ${role.label}`} onClick={() => setRoles(current => current.filter(item => item.id !== role.id))}><Trash2 className="h-4 w-4" /></Button>
          <Button variant="ghost" size="sm" disabled={index === 0} onClick={() => setRoles(current => { const copy = [...current]; [copy[index - 1], copy[index]] = [copy[index], copy[index - 1]]; return copy; })}>↑</Button>
        </div>
      )}</div>
      <Button variant="outline" disabled={!loaded || saving} onClick={() => setRoles(current => [...current, { id: crypto.randomUUID(), label: '', order: current.length }])}><Plus className="mr-2 h-4 w-4" />Роль</Button>
      <DialogFooter><Button disabled={!loaded || saving} onClick={() => void save()}>{saving ? 'Сохраняем…' : 'Сохранить'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
