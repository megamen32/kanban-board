import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import type { RoleDefinition } from './types';

const DEFAULT_ROLES: RoleDefinition[] = [
  'Создатель продуктов', 'Интегратор для клиентов', 'Руководитель команды',
  'Автор и публичная роль', 'Личное и отношения', 'Заточка пилы',
].map((label, order) => ({ id: `nikita-${order + 1}`, label, order }));

function rolesFile() { return path.join(process.env.KANBAN_AUTH_DIR || path.join(process.cwd(), 'data', 'auth'), 'roles.json'); }
function readAll(): Record<string, RoleDefinition[]> {
  try { return JSON.parse(fs.readFileSync(rolesFile(), 'utf8')) as Record<string, RoleDefinition[]>; } catch { return { nikita: DEFAULT_ROLES }; }
}
function writeAll(value: Record<string, RoleDefinition[]>) { fs.mkdirSync(path.dirname(rolesFile()), { recursive: true }); fs.writeFileSync(rolesFile(), JSON.stringify(value, null, 2)); }
export function getRoles(owner: string): RoleDefinition[] { return (readAll()[owner] ?? []).slice().sort((a, b) => a.order - b.order); }
export function saveRoles(owner: string, roles: RoleDefinition[]): RoleDefinition[] {
  const clean = roles.map((role, order) => ({ id: role.id || uuidv4(), label: role.label.trim(), order })).filter(role => role.label);
  const all = readAll(); all[owner] = clean; writeAll(all); return clean;
}
