import type { KanbanCard } from './types';

type TaskActors = Pick<KanbanCard, 'owner' | 'assignee' | 'assignees'>;

/** Compare the stored task's display alias with the server-verified actor. */
function actorKey(value: string | null | undefined): string {
  const normalized = (value || '').normalize('NFKC').trim().toLocaleLowerCase('ru-RU');
  if (['nikita', 'никита', 'никита розанов', 'roomhacker'].includes(normalized)) return 'nikita';
  return normalized;
}

export function sameTaskPerson(left: string | null | undefined, right: string | null | undefined): boolean {
  const key = actorKey(left);
  return !!key && key === actorKey(right);
}

export function taskPersonLabel(value: string | null | undefined): string {
  return actorKey(value) === 'nikita' ? 'nikita' : (value ?? '');
}

/** Reading all cards does not grant permission to complete someone else's work. */
export function isTaskActor(card: TaskActors, verifiedUsername: string | null | undefined): boolean {
  const actor = actorKey(verifiedUsername);
  return !!actor && [card.owner, card.assignee, ...card.assignees].some(value => !!value && actorKey(value) === actor);
}
