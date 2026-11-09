import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { CardCalendarSection } from './card-calendar-section';

const base = {
  dueAt: '2026-11-09T10:00:00.000Z',
  durationMinutes: 60,
  onDurationChange: () => undefined,
  onSync: () => undefined,
};

describe('CardCalendarSection (honest states, no invented connection)', () => {
  test('renders nothing without a saved due date', () => {
    const html = renderToStaticMarkup(<CardCalendarSection {...base} dueAt={undefined} status={{ enabled: true, connected: true }} />);
    expect(html).toBe('');
  });

  test('stays disabled while the status request is in flight', () => {
    const html = renderToStaticMarkup(<CardCalendarSection {...base} status={null} />);
    expect(html).toContain('Проверяем календарь…');
    expect(html).toMatch(/<button[^>]*\sdisabled=""/);
    expect(html).toContain('aria-label="Календарь"');
    expect(html).toContain('Длительность события');
    expect(html).not.toContain('href=');
  });

  test('reports an unavailable bridge without a link or action', () => {
    const unavailableHtml = renderToStaticMarkup(<CardCalendarSection {...base} status="unavailable" />);
    expect(unavailableHtml).toContain('Календарь недоступен');
    expect(unavailableHtml).toContain('disabled');
    const disabledHtml = renderToStaticMarkup(<CardCalendarSection {...base} status={{ enabled: false, connected: false }} />);
    expect(disabledHtml).toContain('Календарь недоступен');
    expect(disabledHtml).not.toContain('href=');
  });

  test('shows the not-connected state with a Keeper link and keeps the action disabled', () => {
    const html = renderToStaticMarkup(
      <CardCalendarSection {...base} status={{ enabled: true, connected: false, publicUrl: 'https://keeper-calendar.airlock.bezrabotnyi.com' }} />,
    );
    expect(html).toContain('Календарь не подключён');
    expect(html).toMatch(/<button[^>]*\sdisabled=""/);
    expect(html).toContain('href="https://keeper-calendar.airlock.bezrabotnyi.com"');
    expect(html).toContain('Открыть Keeper');
    expect(html).toContain('после подключения');
  });

  test('enables the action only for a connected account and honours sync state', () => {
    const html = renderToStaticMarkup(
      <CardCalendarSection {...base} status={{ enabled: true, connected: true, publicUrl: 'https://keeper-calendar.airlock.bezrabotnyi.com' }} />,
    );
    expect(html).toContain('В календарь');
    expect(html).not.toMatch(/<button[^>]*\sdisabled=""/);
    expect(html).toContain('value="60"');

    const syncingHtml = renderToStaticMarkup(
      <CardCalendarSection {...base} syncing status={{ enabled: true, connected: true }} />,
    );
    expect(syncingHtml).toContain('Синхронизация…');
    expect(syncingHtml).toMatch(/<button[^>]*\sdisabled=""/);
  });

  test('warns when the edited due date is not saved yet (calendar acts on the saved date)', () => {
    const html = renderToStaticMarkup(
      <CardCalendarSection {...base} dueAtUnsaved status={{ enabled: true, connected: false }} />,
    );
    expect(html).toContain('не сохранена');
    expect(html).toContain('сохранённая дата');
    const savedHtml = renderToStaticMarkup(
      <CardCalendarSection {...base} status={{ enabled: true, connected: false }} />,
    );
    expect(savedHtml).not.toContain('не сохранена');
  });

  test('never renders credentials, only the caller-own event acknowledgement', () => {
    const html = renderToStaticMarkup(
      <CardCalendarSection {...base} eventId="evt_1" status={{ enabled: true, connected: true }} />,
    );
    expect(html).toContain('Событие создано в вашем календаре');
    expect(html.toLowerCase()).not.toContain('kpr_');
    expect(html.toLowerCase()).not.toContain('bearer');
  });
});
