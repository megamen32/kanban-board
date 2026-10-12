import type { RoleDefinition } from '../../lib/kanban/types';

/** Store stable role IDs while displaying the person's saved labels. */
export function RolePicker({ value, roles = [], onChange }: {
  value: string; roles?: RoleDefinition[]; onChange: (value: string) => void;
}) {
  return <select aria-label="Роль" className="mt-1 h-9 w-full rounded-md border bg-transparent px-2 text-sm" value={value} onChange={event => onChange(event.target.value)}>
    <option value="">Не выбрана</option>
    {roles.map(role => <option key={role.id} value={role.id}>{role.label}</option>)}
    {value && !roles.some(role => role.id === value) && <option value={value}>{value}</option>}
  </select>;
}
