'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import type { KanbanCard, KanbanCardUpdates, KanbanColumn, ConflictInfo } from '@/lib/kanban/types';
import type { KanbanProject } from '@/lib/kanban/project-store';
import type { WeeklyDraft } from '@/lib/kanban/weekly-plan';
import { retryConflictEdit } from './conflict-choice';
import { BoardMutationError, boardMutationRequest, readMutationResponse } from '../lib/kanban/mutation-response';
import { BoardReadError, readBoardSnapshot } from './board-snapshot';
import { createBoardReader, mergeCardReceipts, type BoardReader } from './board-state';

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
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ConflictInfo | null>(null);
  const [weeklyDraft, setWeeklyDraft] = useState<WeeklyDraft | null>(null);
  const [weeklyLoading, setWeeklyLoading] = useState(false);
  const [weeklyError, setWeeklyError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const boardReader = useRef<BoardReader | null>(null);
  if (!boardReader.current) {
    boardReader.current = createBoardReader({
      load: async () => {
        const res = await fetch('/api/kanban/cards', {cache: 'no-store', credentials: 'same-origin'});
        return readBoardSnapshot(res);
      },
      onData: data => {
        setCards(data.cards);
        setProjects(data.projects);
        setError(null);
        setLastLoadedAt(new Date().toISOString());
      },
      onError: failure => {
        if (failure instanceof BoardReadError && [401, 403].includes(failure.status)) {
          setCards([]); setProjects([]); setLastLoadedAt(null);
        }
        setError(failure instanceof BoardReadError ? failure.message : 'Сервер недоступен. Сохранённые на экране записи могут быть устаревшими.');
      },
      onBusy: setRefreshing,
      onSettled: () => setLoading(false),
    });
  }

  const fetchCards = useCallback(() => boardReader.current!.read(), []);
  const refreshCards = useCallback(() => boardReader.current!.refresh(), []);

  useEffect(() => {
    fetchCards();

    // WebSocket
    const socket = io(WS_URL);
    socketRef.current = socket;

    socket.on('connect', () => { console.log('[ws] connected'); void refreshCards(); });
    socket.on('disconnect', () => console.log('[ws] disconnected'));

    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleRefresh = () => {
      boardReader.current!.invalidate();
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => { void refreshCards(); }, 150);
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
  }, [fetchCards, refreshCards]);

  const createCard = useCallback(async (title: string, description: string = '', column: string = 'inbox', priority: string = 'medium', tags: string[] = [], project: string = '', assignees: string[] = [], dueAt?: string, planning?: KanbanCardUpdates) => {
    const res = await boardMutationRequest('/api/kanban/cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description, column, priority, tags, project, assignees, dueAt, ...planning }),
    }, 'create');
    const data = await readMutationResponse(res, false, 'create');
    const saved = data.card;
    if (!saved) throw new BoardMutationError('Сервер не подтвердил создание задачи. Введённые данные не удалены.');
    boardReader.current!.invalidate();
    setCards(prev => mergeCardReceipts(prev, [saved], true));
    return saved;
  }, []);

  const updateCard = useCallback(async (id: string, updates: KanbanUpdateRequest, expectedVersion?: number) => {
    const res = await boardMutationRequest(`/api/kanban/cards/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildUpdateRequestBody(updates, expectedVersion)),
    }, 'update');
    const data = await readMutationResponse(res, true, 'update');
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
    boardReader.current!.invalidate();
    setCards(prev => mergeCardReceipts(prev, [saved]));
    return saved;
  }, []);

  const deleteCard = useCallback(async (id: string) => {
    const response = await boardMutationRequest(`/api/kanban/cards/${id}`, { method: 'DELETE' }, 'delete');
    const data = await readMutationResponse(response, false, 'delete');
    if (!data.success) throw new BoardMutationError('Сервер не подтвердил удаление. Карточка не скрыта.');
    boardReader.current!.invalidate();
    setCards(prev => prev.filter(c => c.id !== id));
    return true;
  }, []);

  const moveCard = useCallback(async (id: string, column: string, order?: number) => {
    const current = cards.find(card => card.id === id);
    if (!current) throw new BoardMutationError('Карточка изменилась. Обновите доску перед перемещением.');
    return updateCard(id, { column: column as KanbanColumn, order }, current.version);
  }, [cards, updateCard]);

  const reorderColumn = useCallback(async (column: string, cardIds: string[]) => {
    const res = await boardMutationRequest('/api/kanban/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ column, cardIds }),
    }, 'reorder');
    const data = await readMutationResponse(res, false, 'reorder');
    if (!data.cards) throw new BoardMutationError('Сервер не подтвердил порядок карточек. Обновите доску.');
    boardReader.current!.invalidate();
    setCards(prev => mergeCardReceipts(prev, data.cards!));
  }, []);

  const resolveConflict = useCallback(async (useServer: boolean) => {
    if (!conflict) return false;
    if (useServer) {
      boardReader.current!.invalidate();
      setCards(prev => mergeCardReceipts(prev, [conflict.serverCard]));
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
      boardReader.current!.invalidate();
      if (data.cards) setCards(previous => mergeCardReceipts(previous, data.cards!));
      setWeeklyDraft(previous => previous ? { ...previous, cards: mergeCardReceipts(previous.cards, data.cards ?? []), cardIds } : previous);
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
    refreshing,
    error,
    lastLoadedAt,
    conflict,
    createCard,
    updateCard,
    deleteCard,
    moveCard,
    reorderColumn,
    resolveConflict,
    refresh: refreshCards,
    weeklyDraft,
    weeklyLoading,
    weeklyError,
    fetchWeeklyDraft,
    acceptWeeklyPlan,
  };
}
