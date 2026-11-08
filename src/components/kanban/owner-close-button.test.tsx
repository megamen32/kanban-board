import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { KanbanCard } from '@/lib/kanban/types';
import { OwnerCloseButton } from './owner-close-button';

const card = {id: 'fixture', owner: 'nikita', column: 'review', version: 4} as KanbanCard;
describe('OwnerCloseButton', () => {
  it('offers one-click closing to the owner without proof inputs', () => {
    const html = renderToStaticMarkup(<OwnerCloseButton card={card} username="nikita" onSaved={() => {}} />);
    expect(html).toContain('Закрыть без проверки');
    expect(html).not.toContain('<textarea');
    expect(html).not.toContain('type="checkbox"');
  });
  it('hides for foreign actors, unauthenticated visitors and closed cards', () => {
    for (const username of [null, 'someone']) {
      expect(renderToStaticMarkup(<OwnerCloseButton card={card} username={username} onSaved={() => {}} />)).toBe('');
    }
    expect(renderToStaticMarkup(<OwnerCloseButton card={{...card, column: 'done'}} username="nikita" onSaved={() => {}} />)).toBe('');
  });
  it('respects the parent saving lock', () => {
    expect(renderToStaticMarkup(<OwnerCloseButton card={card} username="nikita" disabled onSaved={() => {}} />)).toContain('disabled');
  });
});
