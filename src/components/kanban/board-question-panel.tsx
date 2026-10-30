'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { KanbanCard } from '@/lib/kanban/types';

/** Stage 1 board-owned executor question: one button per choice, answered read-only afterwards. */
export function BoardQuestionPanel({ card, onAnswered }: { card: KanbanCard; onAnswered: () => void | Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const question = card.pendingQuestion;
  if (!question) return null;

  async function answer(value: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/kanban/cards/${encodeURIComponent(card.id)}/answer`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value }),
      });
      if (!response.ok) setError('Не удалось отправить ответ. Обнови карточку и попробуй ещё раз.');
      else await onAnswered();
    } catch {
      setError('Не удалось отправить ответ. Проверь соединение.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-3 rounded-md border bg-muted/40 p-3 text-sm" aria-label="Вопрос исполнителя">
      <p className="text-xs text-muted-foreground">Вопрос исполнителя</p>
      <p className="mt-1 font-medium">{question.text}</p>
      {question.answer ? (
        <p className="mt-2 text-muted-foreground">
          Ответ: <span className="text-foreground">{question.answer.label}</span>
          {question.answer.by === 'timeout' ? ' (по таймауту)' : ''}
          {question.deliveryError ? ' · доставка в сессию не подтверждена' : ''}
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          {question.choices.map(choice => (
            <Button key={choice.value} size="sm" variant="outline" disabled={busy} onClick={() => void answer(choice.value)}>
              {choice.label}
            </Button>
          ))}
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
    </section>
  );
}

