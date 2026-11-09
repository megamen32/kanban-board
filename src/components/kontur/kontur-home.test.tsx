import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { KanbanCard } from '@/lib/kanban/types';
import { KonturHome } from './kontur-home';
import { KonturProjectPlan } from './kontur-project-plan';

const card = {id:'fixture',title:'Concrete task',description:'',owner:'nikita',assignees:['nikita'],
  column:'todo',project:'Fixture',priority:'medium',tags:[],version:1,order:0,fileName:'fixture.md',
  created:'2026-11-08T00:00:00Z',updated:'2026-11-08T00:00:00Z'} as KanbanCard;
describe('simple home and project plan', () => {
  it('renders the two action groups and collapsed background groups with honest freshness', () => {
    const html = renderToStaticMarkup(<KonturHome cards={[card]} username="nikita" lastLoadedAt={null} onOpen={()=>{}} />);
    expect(html).toContain('Нужен мой ответ');
    expect(html).toContain('Сделать сейчас');
    expect(html).toContain('Concrete task');
    expect(html).toContain('Данные доски загружены: неизвестно');
    expect(html.match(/<details/g)).toHaveLength(2);
    expect(html).not.toContain('<details open');
    expect(html).not.toContain('Готово до:');
  });
  it('uses the same card in roadmap and never claims an unknown project goal', () => {
    const html = renderToStaticMarkup(<KonturProjectPlan cards={[card]} project="Fixture" teamLabel="неизвестно" onOpen={()=>{}} onMove={async()=>null} />);
    expect(html).toContain('Цели не указаны');
    expect(html).toContain('Далее');
    expect(html).toContain('Позже');
    expect(html).toContain('Backlog');
    expect(html.match(/Concrete task/g)).toHaveLength(2);
    expect(html).toContain('AI не запускается');
  });
});
