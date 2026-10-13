'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import type { KanbanCard, KanbanCardUpdates, KanbanColumn, ConflictInfo } from '@/lib/kanban/types';
import type { KanbanProject } from '@/lib/kanban/project-store';
import type { WeeklyDraft } from '@/lib/kanban/weekly-plan';
import { retryConflictEdit } from './conflict-choice';
import { BoardMutationError, readMutationResponse } from '../lib/kanban/mutation-response';

const WS_URL = '/?XTransformPort=3003';

export type KanbanUpdateRequest = KanbanCardUpdates & {
  reassignmentIntent?: 'direct-owner-command';
  reassignmentEvidence?: Record<string, unknown>;
};

export function buildUpdateRequestBody(updates: KanbanUpdateRequest, expectedVersion?: number) {
  return { ...updates, expectedVersion };
}

export interface WeeklyPlanResult extends WeeklyDraft {
  error?: string;
}

export function useKanban() {
  const [cards, setCards] = useState<KanbanCard[]>([]);
  const [projects, setProjects] = useState<KanbanProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [conflict, setConflict] = useState<ConflictInfo | null>(null);
  const [weeklyDraft, setWeeklyDraft] = useState<WeeklyDraft | null>(null);
  const [weeklyLoading, setWeeklyLoading] = useState(false);
  const [weeklyError, setWeeklyError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const fetchCards = useCallback(async () => {
    try {
      const res = await fetch('/api/kanban/cards');
      const data = await res.json();
      if (data.cards) setCards(data.cards);
      if (data.projects) setProjects(data.projects);
    } catch (e) {
      console.error('Fetch cards error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCards();

    // WebSocket
    const socket = io(WS_URL);
    socketRef.current = socket;

    socket.on('connect', () => { console.log('[ws] connected'); fetchCards(); });
    socket.on('disconnect', () => console.log('[ws] disconnected'));

    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleRefresh = () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(fetchCards, 150);
    };
    socket.on('board:changed', scheduleRefresh);
    // Retain rollout compatibility, but never merge legacy truncated payloads.
    socket.on('file:created', scheduleRefresh);
    socket.on('file:updated', scheduleRefresh);
    socket.on('file:deleted', scheduleRefresh);

    return () => {
      clearTimeout(refreshTimer);
      socket.disconnect();
    };
  }, [fetchCards]);

  const createCard = useCallback(async (title: string, description: string = '', column: string = 'inbox', priority: string = 'medium', tags: string[] = [], project: string = '', assignees: string[] = [], dueAt?: string, planning?: KanbanCardUpdates) => {
    const res = await fetch('/api/kanban/cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description, column, priority, tags, project, assignees, dueAt, ...planning }),
    });
    const data = await readMutationResponse(res);
    const saved = data.card;
    if (!saved) throw new BoardMutationError('Сервер не подтвердил создание задачи. Введённые данные не удалены.');
    if (saved) setCards(prev => prev.some(card => card.id === saved.id)
      ? prev.map(card => card.id === saved.id ? saved : card)
      : [...prev, saved]);
    return saved;
  }, []);

  const updateCard = useCallback(async (id: string, updates: KanbanUpdateRequest, expectedVersion?: number) => {
    const res = await fetch(`/api/kanban/cards/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildUpdateRequestBody(updates, expectedVersion)),
    });
    const data = await readMutationResponse(res, true);
    if (res.status === 409) {
      setConflict({
        cardId: id,
        serverVersion: data.serverCard!.version,
        clientVersion: expectedVersion ?? 0,
        serverCard: data.serverCard!,
        clientCard: { id, ...updates } as KanbanCard,
      });
      return null;
    }
    const saved = data.card;
    if (!saved) throw new BoardMutationError('Сервер не подтвердил сохранение карточки. Введённые данные не удалены.');
    setCards(prev => prev.map(c => c.id === id ? saved : c));
    return saved;
  }, []);

  const deleteCard = useCallback(async (id: string) => {
    const response = await fetch(`/api/kanban/cards/${id}`, { method: 'DELETE' });
    const data = await readMutationResponse(response);
    if (!data.success) throw new BoardMutationError('Сервер не подтвердил удаление. Карточка не скрыта.');
    setCards(prev => prev.filter(c => c.id !== id));
    return true;
  }, []);

  const moveCard = useCallback(async (id: string, column: string, order?: number) => {
    const current = cards.find(card => card.id === id);
    if (!current) throw new BoardMutationError('Карточка изменилась. Обновите доску перед перемещением.');
    return updateCard(id, { column: column as KanbanColumn, order }, current.version);
  }, [cards, updateCard]);

  const reorderColumn = useCallback(async (column: string, cardIds: string[]) => {
    const res = await fetch('/api/kanban/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ column, cardIds }),
    });
    const data = await readMutationResponse(res);
    if (!data.cards) throw new BoardMutationError('Сервер не подтвердил порядок карточек. Обновите доску.');
    if (data.cards) {
      setCards((prev: KanbanCard[]) => {
        const updated = new Map<KanbanCard['id'], KanbanCard>((data.cards as KanbanCard[]).map((c: KanbanCard) => [c.id, c]));
        return prev.map(c => updated.get(c.id) || c);
      });
    }
  }, []);

  const resolveConflict = useCallback(async (useServer: boolean) => {
    if (!conflict) return false;
    if (useServer) {
      setCards(prev => prev.map(c => c.id === conflict.cardId ? conflict.serverCard : c));
      setConflict(null);
      return true;
    }
    const saved = await retryConflictEdit(conflict, updateCard);
    if (saved) setConflict(null);
    return Boolean(saved);
  }, [conflict, updateCard]);

  const fetchWeeklyDraft = useCallback(async () => {
    setWeeklyLoading(true);
    setWeeklyError(null);
    try {
      const res = await fetch('/api/kanban/weekly-plan');
      const data = await res.json() as WeeklyPlanResult;
      if (!res.ok) throw new Error(data.error || 'Не удалось загрузить план недели');
      setWeeklyDraft(data);
      return data;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось загрузить план недели';
      setWeeklyError(message);
      return null;
    } finally {
      setWeeklyLoading(false);
    }
  }, []);

  const acceptWeeklyPlan = useCallback(async (cardIds: string[], now?: string) => {
    setWeeklyLoading(true);
    setWeeklyError(null);
    try {
      const res = await fetch('/api/kanban/weekly-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardIds, ...(now ? { now } : {}) }),
      });
      const data = await res.json() as WeeklyPlanResult & { cards?: KanbanCard[] };
      if (!res.ok) throw new Error(data.error || 'Не удалось принять план недели');
      if (data.cards) setCards(previous => previous.map(card => data.cards!.find(updated => updated.id === card.id) ?? card));
      setWeeklyDraft(previous => previous ? { ...previous, cards: previous.cards.map(card => data.cards?.find(updated => updated.id === card.id) ?? card), cardIds } : previous);
      return data.cards ?? [];
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось принять план недели';
      setWeeklyError(message);
      return null;
    } finally {
      setWeeklyLoading(false);
    }
  }, []);

  return {
    cards,
    projects,
    loading,
    conflict,
    createCard,
    updateCard,
    deleteCard,
    moveCard,
    reorderColumn,
    resolveConflict,
    refresh: fetchCards,
    weeklyDraft,
    weeklyLoading,
    weeklyError,
    fetchWeeklyDraft,
    acceptWeeklyPlan,
  };
}
