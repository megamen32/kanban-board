import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CalendarPanel } from './board-calendar-view';
import type { KanbanCard } from '@/lib/kanban/types';
describe('calendar presentation', () => {
  it('shows existing task titles, distinct deadline/plan markers and undated tasks', () => {
    const cards = [
      { id: 'a', title: '<script>untrusted</script>', scheduledAt: '2026-11-07T10:00:00Z', dueAt: '2026-11-08T12:00:00Z' },
      { id: 'b', title: 'Without a date' },
    ] as KanbanCard[];
    const html = renderToStaticMarkup(<CalendarPanel cards={cards} anchor="2026-11-07" period="week" timeZone="UTC" events={[{ id: 'e', title: 'Private event', startTime: '2026-11-07T00:00:00Z', endTime: '2026-11-08T00:00:00Z', isAllDay: true }]} onOpen={() => {}} />);
    expect(html).toContain('План · 10:00');
    expect(html).toContain('Срок · 12:00');
    expect(html).toContain('Без даты (1)');
    expect(html).toContain('Without a date');
    expect(html).toContain('Личное · Весь день');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
