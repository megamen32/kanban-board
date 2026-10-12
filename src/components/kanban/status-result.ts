import type { KanbanColumn } from '@/lib/kanban/types';

/** A successful HTTP response may still redirect a requested DONE to review. */
export function statusSaveError(result: unknown, requested: KanbanColumn): string | null {
  if (!result || typeof result !== 'object' || !('column' in result)) {
    return 'Статус не сохранён. Обновите доску и попробуйте ещё раз.';
  }
  if (result.column !== requested) {
    return result.column === 'review'
      ? 'Задача отправлена на проверку, а не завершена. Вход не подтверждён — обновите страницу и войдите снова.'
      : 'Сервер сохранил другой статус. Обновите доску перед повторным изменением.';
  }
  return null;
}
