'use client';

import { useRef, useState } from 'react';
import type { KanbanCard, KanbanColumn } from '@/lib/kanban/types';
import { isQaCard } from './kontur-home-model';
import { ActionCard } from './kontur-home';
import { mutationErrorMessage } from '@/lib/kanban/mutation-response';

const STAGES = [
  {title: 'Сейчас', columns: ['in-progress', 'review', 'blocked'], destination: 'in-progress'},
  {title: 'Далее', columns: ['todo'], destination: 'todo'},
  {title: 'Позже', columns: ['someday'], destination: 'someday'},
  {title: 'Backlog', columns: ['inbox'], destination: 'inbox'},
] as const;

export function KonturProjectPlan({cards, project, teamLabel, onOpen, onMove}: {
  cards: KanbanCard[]; project: string; teamLabel: string; onOpen: (card: KanbanCard) => void;
  onMove: (card: KanbanCard, column: KanbanColumn) => Promise<unknown>;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const inFlight = useRef(false);
  const active = cards.filter(card => !isQaCard(card) && !['done', 'archived'].includes(card.column));
  async function move(card: KanbanCard, column: KanbanColumn) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(card.id); setError('');
    try { const saved = await onMove(card, column); if (!saved) setError('Изменение не подтверждено. Обновите карточку.'); }
    catch (failure) { setError(mutationErrorMessage(failure)); }
    finally { inFlight.current = false; setBusy(null); }
  }
  if (project === 'all') return <p className="k-section-note">Выберите проект в фильтре выше, чтобы открыть его цели, команду и план.</p>;
  return <section aria-label="План проекта">
    <h2>{project}</h2><p>Команда: {teamLabel}</p>
    <h3>Цели проекта</h3>
    {active.some(card => card.type === 'outcome') ? active.filter(card => card.type === 'outcome').map(card =>
      <button type="button" className="k-text-button" key={card.id} onClick={() => onOpen(card)}>{card.title}</button>)
      : <p>Цели не указаны в карточках типа «результат».</p>}
    <p className="k-section-note">Это существующие карточки. Сейчас: в работе, на проверке и заблокированные; Далее: к выполнению; Позже: когда-нибудь; Backlog: входящие. Перенос меняет только состояние, AI не запускается. Требования приёмки сохраняются.</p>
    {error && <p role="alert">{error}</p>}
    <div className="k-catalog-grid">{STAGES.map(stage => <section key={stage.title}>
      <h3>{stage.title}</h3>
      {active.filter(card => (stage.columns as readonly string[]).includes(card.column)).map(card => <div key={card.id}>
        <ActionCard card={card} reason={card.blockerReason || 'В плане проекта'} onOpen={onOpen} />
        <label>Перенести карточку <select aria-label={'Перенести: ' + card.title} value={stage.destination} disabled={!!busy}
          onChange={event => void move(card, event.target.value as KanbanColumn)}>
          {STAGES.map(target => <option key={target.destination} value={target.destination}>{target.title}</option>)}
        </select></label>
      </div>)}
    </section>)}</div>
  </section>;
}
