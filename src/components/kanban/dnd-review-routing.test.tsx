import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect,vi} from 'vitest';
import type {KanbanCard} from '@/lib/kanban/types';
const state=vi.hoisted(()=>({end:null as null|((event:unknown)=>Promise<void>)}));
vi.mock('@dnd-kit/core',()=>({
 DndContext:({children,onDragEnd}:{children:React.ReactNode;onDragEnd:typeof state.end})=>{state.end=onDragEnd;return children},
 DragOverlay:()=>null,closestCorners:()=>null,PointerSensor:{},TouchSensor:{},KeyboardSensor:{},useSensor:()=>null,useSensors:()=>[]
}));
vi.mock('@dnd-kit/sortable',()=>({sortableKeyboardCoordinates:()=>null}));
import {DndProvider} from './dnd-provider';
const card={id:'synthetic',column:'review',order:0,title:'Test'} as KanbanCard;
describe('review drag uses the existing human decision dialog',()=>{
 it('opens review and does not send generic status PATCH',async()=>{
  const move=vi.fn();const review=vi.fn();const reorder=vi.fn();
  renderToStaticMarkup(<DndProvider cards={[card]} onMoveCard={move} onReorder={reorder} onReviewRequired={review}><span /></DndProvider>);
  await state.end!({active:{id:card.id},over:{id:'in-progress'}});
  expect(review).toHaveBeenCalledWith(card);expect(move).not.toHaveBeenCalled();expect(reorder).not.toHaveBeenCalled();
 });
 it('preserves normal moves and does not open review',async()=>{
  const current={...card,column:'todo'} as KanbanCard;const move=vi.fn().mockResolvedValue({...current,column:'in-progress'});const review=vi.fn();
  renderToStaticMarkup(<DndProvider cards={[current]} onMoveCard={move} onReorder={vi.fn()} onReviewRequired={review}><span /></DndProvider>);
  await state.end!({active:{id:card.id},over:{id:'in-progress'}});
  expect(move).toHaveBeenCalledOnce();expect(review).not.toHaveBeenCalled();
 });
});
