'use client';

import { DndContext, DragOverlay, closestCorners, PointerSensor, TouchSensor, KeyboardSensor, useSensor, useSensors, type DragStartEvent, type DragEndEvent } from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useState, useCallback } from 'react';
import { DEFAULT_COLUMNS } from '@/lib/kanban/types';
import type { KanbanCard as CardType, KanbanColumn as ColType } from '@/lib/kanban/types';

const COL_IDS: ReadonlyArray<ColType> = DEFAULT_COLUMNS.map(c => c.id);

interface Props {
  children: React.ReactNode;
  cards: CardType[];
  onMoveCard: (cardId: string, newColumn: ColType, order?: number) => Promise<CardType | null>;
  onReorder: (column: ColType, cardIds: string[]) => Promise<void>;
}

export function DndProvider({ children, cards, onMoveCard, onReorder }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const activeCard = activeId ? cards.find(c => c.id === activeId) ?? null : null;

  const handleDragStart = useCallback((e: DragStartEvent) => setActiveId(String(e.active.id)), []);

  const handleDragEnd = useCallback(async (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;

    const cardId = String(active.id);
    const card = cards.find(c => c.id === cardId);
    if (!card) return;

    const overId = String(over.id);
    let targetCol: ColType = card.column;
    let targetOrder: number | undefined;

    if (COL_IDS.includes(overId as ColType)) {
      targetCol = overId as ColType;
      targetOrder = cards.filter(c => c.column === targetCol).length;
    } else {
      const overCard = cards.find(c => c.id === overId);
      if (overCard) {
        targetCol = overCard.column as ColType;
        const colCards = cards.filter(c => c.column === targetCol && c.id !== cardId).sort((a, b) => a.order - b.order);
        const idx = colCards.findIndex(c => c.id === overId);
        targetOrder = idx >= 0 ? idx : colCards.length;
      }
    }

    if (targetCol !== card.column) {
      await onMoveCard(cardId, targetCol, targetOrder);
    } else if (targetOrder !== undefined) {
      const colCards = cards.filter(c => c.column === targetCol).sort((a, b) => a.order - b.order);
      const reordered = colCards.filter(c => c.id !== cardId);
      reordered.splice(targetOrder, 0, card);
      await onReorder(targetCol, reordered.map(c => c.id));
    }
  }, [cards, onMoveCard, onReorder]);

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      {children}
      <DragOverlay>
        {activeCard && (
          <div className="bg-background rounded-md border border-border p-3 shadow-xl rotate-2 opacity-90 max-w-[280px]">
            <span className="font-medium text-sm">{activeCard.title}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
