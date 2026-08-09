'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import type { KanbanCard, SyncEvent, ConflictInfo } from '@/lib/kanban/types';

const WS_URL = '/?XTransformPort=3003';

export function useKanban() {
  const [cards, setCards] = useState<KanbanCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [conflict, setConflict] = useState<ConflictInfo | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const fetchCards = useCallback(async () => {
    try {
      const res = await fetch('/api/kanban/cards');
      const data = await res.json();
      if (data.cards) setCards(data.cards);
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

    socket.on('connect', () => console.log('[ws] connected'));
    socket.on('disconnect', () => console.log('[ws] disconnected'));

    socket.on('file:created', (card: KanbanCard) => {
      setCards(prev => {
        if (prev.some(c => c.id === card.id)) return prev;
        return [...prev, card];
      });
    });

    socket.on('file:updated', (card: KanbanCard) => {
      setCards(prev => prev.map(c => c.id === card.id ? card : c));
    });

    socket.on('file:deleted', ({ fileName }: { fileName: string }) => {
      setCards(prev => prev.filter(c => c.fileName !== fileName));
    });

    return () => {
      socket.disconnect();
    };
  }, [fetchCards]);

  const createCard = useCallback(async (title: string, description: string = '', column: string = 'inbox', priority: string = 'medium', tags: string[] = [], project: string = '', assignees: string[] = []) => {
    const res = await fetch('/api/kanban/cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description, column, priority, tags, project, assignees }),
    });
    const data = await res.json();
    if (data.card) setCards(prev => [...prev, data.card]);
    return data.card;
  }, []);

  const updateCard = useCallback(async (id: string, updates: Partial<KanbanCard>, expectedVersion?: number) => {
    const res = await fetch(`/api/kanban/cards/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...updates, expectedVersion }),
    });
    const data = await res.json();
    if (res.status === 409) {
      setConflict({
        cardId: id,
        serverVersion: data.serverCard.version,
        clientVersion: expectedVersion ?? 0,
        serverCard: data.serverCard,
        clientCard: { id, ...updates } as KanbanCard,
      });
      return null;
    }
    if (data.card) {
      setCards(prev => prev.map(c => c.id === id ? data.card : c));
    }
    return data.card;
  }, []);

  const deleteCard = useCallback(async (id: string) => {
    await fetch(`/api/kanban/cards/${id}`, { method: 'DELETE' });
    setCards(prev => prev.filter(c => c.id !== id));
  }, []);

  const moveCard = useCallback(async (id: string, column: string, order?: number) => {
    const res = await fetch(`/api/kanban/cards/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ column, order }),
    });
    const data = await res.json();
    if (data.card) {
      setCards(prev => prev.map(c => c.id === id ? data.card : c));
    }
    return data.card as KanbanCard | null;
  }, []);

  const reorderColumn = useCallback(async (column: string, cardIds: string[]) => {
    const res = await fetch('/api/kanban/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ column, cardIds }),
    });
    const data = await res.json();
    if (data.cards) {
      setCards((prev: KanbanCard[]) => {
        const updated = new Map<KanbanCard['id'], KanbanCard>((data.cards as KanbanCard[]).map((c: KanbanCard) => [c.id, c]));
        return prev.map(c => updated.get(c.id) || c);
      });
    }
  }, []);

  const resolveConflict = useCallback((useServer: boolean) => {
    if (!conflict) return;
    if (useServer) {
      setCards(prev => prev.map(c => c.id === conflict.cardId ? conflict.serverCard : c));
    }
    setConflict(null);
  }, [conflict]);

  return {
    cards,
    loading,
    conflict,
    createCard,
    updateCard,
    deleteCard,
    moveCard,
    reorderColumn,
    resolveConflict,
    refresh: fetchCards,
  };
}
