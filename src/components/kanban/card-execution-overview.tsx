import type { KanbanCard, TaskExecutionPhase } from '../../lib/kanban/types';
import { CardResultPreview } from './card-result-preview';

const PHASE: Record<TaskExecutionPhase, string> = {
  intent: 'Запуск запрошен',
  'create-unknown': 'Создание сессии не подтверждено',
  created: 'Сессия создана',
  'dispatch-unknown': 'Отправка задания не подтверждена',
  running: 'ИИ работает',
  waiting: 'Ожидается ответ',
  stopped: 'Остановлено',
  result: 'Результат получен',
};

/** The saved, factual state of execution, visible from every task view.
 * Does not issue any executor commands or mutate the card.
 */
export function CardExecutionOverview({ card, onRefresh, refreshing = false }: {
  card: KanbanCard;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const receipt = card.taskExecutionHistory?.at(-1);
  const result = card.resultHistory?.at(-1);
  if (!receipt && !result) return null;
  const progress = receipt?.lastProgress?.trim();
  const latestChild = receipt?.continuations?.at(-1);
  const state = latestChild?.phase === 'result' ? 'Результат продолжения получен'
    : latestChild?.phase === 'running' ? 'ИИ выполняет следующее действие'
      : receipt ? PHASE[receipt.phase] : 'Результат сохранён';
  return (
    <section aria-label="Работа ИИ и результат" className="min-w-0 space-y-2 rounded-md border bg-muted/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Работа ИИ</h3>
          <p className="text-xs text-muted-foreground" role="status">
            {state}
            {receipt?.lastProgressAt && <span> · {new Date(receipt.lastProgressAt).toLocaleString('ru-RU')}</span>}
          </p>
        </div>
        {onRefresh && <button type="button" className="rounded border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
          onClick={onRefresh} disabled={refreshing} aria-label="Обновить ход работы ИИ">
          {refreshing ? 'Обновляю…' : 'Обновить'}
        </button>}
      </div>
      {progress && <div className="space-y-1 text-sm">
        <p className="text-xs font-medium text-muted-foreground">Последнее действие</p>
        <p className="whitespace-pre-wrap break-words">{progress}</p>
      </div>}
      {latestChild?.summary && <div className="space-y-1 text-sm">
        <p className="text-xs font-medium text-muted-foreground">Итог последнего продолжения</p>
        <p className="whitespace-pre-wrap break-words">{latestChild.summary}</p>
      </div>}
      {result && <CardResultPreview result={result} />}
    </section>
  );
}
