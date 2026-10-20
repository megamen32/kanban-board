import type { TaskQuestionView } from './notice-question-model';
import { taskQuestionStateLabel, taskQuestionTimestamp } from './notice-question-model';

function deliveryLabel(state: string): string {
  return ({
    sent: 'отправка подтверждена',
    sending: 'отправка ещё выполняется',
    unknown: 'результат отправки неизвестен',
    failed: 'отправка не подтверждена',
  } as Record<string, string>)[state] ?? 'нет подтверждения доставки';
}

export function QuestionDetails({ view }: { view: TaskQuestionView }) {
  const answerLabel = view.decision
    ? view.question.choices.find(choice => choice.value === view.decision?.value)?.label ?? view.decision.value
    : null;
  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-medium">Связанный вопрос</h4>
        <span className="text-xs text-muted-foreground">{taskQuestionStateLabel(view.state)}</span>
      </div>
      <p className="whitespace-pre-wrap text-sm">{view.question.text}</p>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {view.question.choices.map(choice => <li key={choice.value}>{choice.label}</li>)}
      </ul>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div><dt className="text-xs text-muted-foreground">Назначение</dt><dd>{view.purpose}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Уведомление</dt><dd>{deliveryLabel(view.notification.attemptState)}</dd></div>
        {view.notification.delivered && view.notification.deadlineAt !== null && (
          <div><dt className="text-xs text-muted-foreground">Срок ответа после подтверждённой отправки</dt><dd>{taskQuestionTimestamp(view.notification.deadlineAt)}</dd></div>
        )}
        {!view.notification.delivered && view.question.expiresAt !== null && (
          <div><dt className="text-xs text-muted-foreground">Срок вопроса</dt><dd>{taskQuestionTimestamp(view.question.expiresAt)}</dd></div>
        )}
        {view.decision && <div>
          <dt className="text-xs text-muted-foreground">{view.decision.source === 'human' ? 'Ответ человека' : 'Итог по таймауту'}</dt>
          <dd>{answerLabel}{view.decision.decidedAt !== null ? ` · ${taskQuestionTimestamp(view.decision.decidedAt)}` : ''}</dd>
        </div>}
      </dl>
      <p className="text-xs text-muted-foreground">Ответ или таймаут не останавливает и не возобновляет задачу. Команды паузы/остановки и подтверждение управления здесь недоступны.</p>
    </div>
  );
}
