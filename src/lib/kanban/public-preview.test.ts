import { expect, it } from 'vitest';
import { GET } from '../../app/link-preview/route';
import { todoPreview } from './public-preview';

// Fast unit: crawler metadata is a standalone static public document, <1s/max5s.
it('serves only static human-readable metadata and the fixed public image', async () => {
  const response = GET();
  expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
  const html = await response.text();
  expect(html).toContain(`<meta property="og:image" content="${todoPreview.image}">`);
  expect(html).toContain(`<meta property="og:title" content="${todoPreview.title}">`);
  expect(html).not.toMatch(/api\/kanban|__NEXT_DATA__|<script\b|cookie|Bearer|owner|cardId/);
});
