'use client';

import type { KanbanCard } from '@/lib/kanban/types';
import { homeItems, isQaCard, type HomeItem } from './kontur-home-model';
import { taskFacts, UNKNOWN } from './kontur-model';
import { formatStamp } from './kontur-calendar';

export function ActionCard({card, reason, action = 'Открыть карточку', onOpen}: {
  card: KanbanCard; reason: string; action?: string; onOpen: (card: KanbanCard) => void;
}) {
  const facts = taskFacts(card);
  const assignees = [...new Set([card.assignee, ...card.assignees].filter(Boolean))].join(', ');
  return <article className="k-panel" style={{padding: 16, marginBottom: 12}}>
    {isQaCard(card) && <strong className="k-eyebrow">QA · тестовая карточка</strong>}
    <h3>{facts.nextStep !== UNKNOWN ? facts.nextStep : card.title}</h3>
    {facts.nextStep !== UNKNOWN && <p>{card.title}</p>}
    <p>{facts.project} · Исполнитель: {assignees || (card.executor === 'dot' ? 'dot' : UNKNOWN)}</p>
    {card.dueAt && <p>Дедлайн: {formatStamp(card.dueAt)}</p>}
    <p><strong>Почему здесь:</strong> {reason}</p>
    <small>Карточка обновлена: {formatStamp(card.updated)}</small>
    <div style={{marginTop: 10}}><button type="button" className="k-button k-button-small" onClick={() => onOpen(card)}>{action}</button></div>
  </article>;
}

export function KonturHome({cards, username, lastLoadedAt, onOpen}: {
  cards: KanbanCard[]; username: string; lastLoadedAt: string | null; onOpen: (card: KanbanCard) => void;
}) {
  const items = homeItems(cards, username);
  const group = (bucket: HomeItem['bucket']) => {
    const visible = items.filter(item => item.bucket === bucket);
    return visible.length ? visible.map(item => <ActionCard key={item.card.id} {...item} onOpen={onOpen} />)
      : <p className="k-section-note">В этом разделе задач нет.</p>;
  };
  return <section aria-label="Что мне делать">
    <p className="k-section-note">Данные доски загружены: {lastLoadedAt ? formatStamp(lastLoadedAt) : UNKNOWN}. Состояние сессий отдельно не проверено.</p>
    <div className="k-overview-grid"><div><h2>Нужен мой ответ</h2>{group('answer')}</div>
      <div><h2>Сделать сейчас</h2>{group('now')}</div></div>
    <details className="k-panel" style={{padding: 16, marginTop: 16}}><summary>Ожидаю других · {items.filter(item => item.bucket === 'waiting').length}</summary>{group('waiting')}</details>
    <details className="k-panel" style={{padding: 16, marginTop: 16}}><summary>Работа ИИ · {items.filter(item => item.bucket === 'ai').length}</summary>{group('ai')}</details>
    <p className="k-section-note">QA, архив, завершённые задачи и идеи скрыты. Backlog и «Позже» доступны в плане проекта.</p>
  </section>;
}
