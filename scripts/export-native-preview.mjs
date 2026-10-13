// Export only the fixed crawler document and image into the existing SDK adapter.
// No environment, auth or board data is loaded.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const destination = process.argv[2];
if (!destination) throw new Error('Usage: node scripts/export-native-preview.mjs DESTINATION');
const source = await readFile(new URL('../src/lib/kanban/public-preview.ts', import.meta.url), 'utf8');
const { todoPreview, publicPreviewHtml } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const png = await readFile(new URL('../public/todo-preview.png', import.meta.url));
const hash = createHash('sha256').update(png).digest('hex').slice(0, 12);
const imageName = `todo-preview.${hash}.png`;
if (todoPreview.image !== `${todoPreview.url}static/${imageName}`) {
  throw new Error('Preview image URL must pin the exported image bytes');
}
await mkdir(destination, { recursive: true });
await writeFile(resolve(destination, 'index.html'), publicPreviewHtml());
await writeFile(resolve(destination, imageName), png);
