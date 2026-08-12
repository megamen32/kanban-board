'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { RoleDefinition } from '@/lib/kanban/types';

export function RolesDialog({ owner, open, onOpenChange }: { owner: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [roles, setRoles] = useState<RoleDefinition[]>([]);
  useEffect(() => { if (open) fetch(`/api/kanban/roles?owner=${encodeURIComponent(owner)}`).then(response => response.json()).then(data => setRoles(data.roles ?? [])); }, [open, owner]);
  const save = async () => { await fetch('/api/kanban/roles', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ owner, roles }) }); onOpenChange(false); };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Мои роли</DialogTitle></DialogHeader><p className="text-sm text-muted-foreground">Роли личные. ИИ может предложить роль, но ты решаешь.</p><div className="space-y-2">{roles.map((role, index) => <div className="flex gap-2" key={role.id}><Input value={role.label} onChange={event => setRoles(current => current.map(item => item.id === role.id ? { ...item, label: event.target.value } : item))} /><Button variant="ghost" size="icon" aria-label={`Удалить ${role.label}`} onClick={() => setRoles(current => current.filter(item => item.id !== role.id))}><Trash2 className="h-4 w-4" /></Button><Button variant="ghost" size="sm" disabled={index === 0} onClick={() => setRoles(current => { const copy = [...current]; [copy[index - 1], copy[index]] = [copy[index], copy[index - 1]]; return copy; })}>↑</Button></div>)}</div><Button variant="outline" onClick={() => setRoles(current => [...current, { id: crypto.randomUUID(), label: '', order: current.length }])}><Plus className="mr-2 h-4 w-4" />Роль</Button><DialogFooter><Button onClick={save}>Сохранить</Button></DialogFooter></DialogContent></Dialog>;
}
