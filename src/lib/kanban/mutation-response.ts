import type { KanbanCard, RoleDefinition } from './types';

interface MutationReply {
  card?: KanbanCard;
  cards?: KanbanCard[];
  roles?: RoleDefinition[];
  success?: boolean;
  conflict?: boolean;
  serverCard?: KanbanCard;
  error?: string;
}

export class BoardMutationError extends Error {}

export function mutationErrorMessage(error: unknown): string {
  return error instanceof BoardMutationError ? error.message
    : 'Не удалось сохранить изменение. Введённые данные сохранены в форме — попробуйте ещё раз.';
}

/** HTTP errors and login HTML must not close editors or remove local cards. */
export async function readMutationResponse(response: Response, allowConflict = false): Promise<MutationReply> {
  const data = await response.json().catch(() => null) as MutationReply | null;
  if (allowConflict && response.status === 409 && data?.conflict && data.serverCard) return data;
  if (response.ok && data && typeof data === 'object') return data;
  const reasons: Record<string, string> = {
    assignee_change_requires_owner_authorization: 'Подтвердите переназначение ответственных перед сохранением.',
    reviewer_change_requires_owner_authorization: 'Список принимающих результат меняет только владелец доски.',
    parent_relation_cycle: 'Такая связь создала бы цикл между родительской задачей и подзадачей.',
    deadline_change_requires_human_ui: 'Для изменения срока нужен подтверждённый вход. Обновите страницу и войдите снова.',
    weekly_plan_requires_batch_acceptance: 'План недели принимается отдельно на вкладке «Неделя».',
    weekly_plan_allows_at_most_six_big_rocks: 'На неделю можно принять не больше шести Big Rocks. Сначала пересмотрите текущий план.',
  };
  const message = !data || response.status === 401 || response.status === 403
    ? 'Войдите снова и повторите сохранение. Введённые данные не удалены.'
    : reasons[data.error ?? ''] ?? (response.status >= 500
      ? 'Сервер временно недоступен. Введённые данные не удалены — попробуйте ещё раз.'
      : 'Изменение не сохранено. Проверьте поля и актуальную версию карточки.');
  throw new BoardMutationError(message);
}
