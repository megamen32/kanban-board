import { publicPreviewHtml } from '../../lib/kanban/public-preview';

export function GET() {
  return new Response(publicPreviewHtml(), {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
  });
}
