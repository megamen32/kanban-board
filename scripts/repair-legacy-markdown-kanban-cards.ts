import fs from 'node:fs';
import path from 'node:path';

const root = '/home/roomhacker/todo-kanban/work-tasks/personal';
const columns = new Set(['inbox', 'todo', 'in-progress', 'review', 'blocked', 'done', 'someday', 'archived']);

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(dir, entry.name)) : entry.name.endsWith('.md') ? [path.join(dir, entry.name)] : []);
}

let repaired = 0;
for (const file of files(root)) {
  const raw = fs.readFileSync(file, 'utf8');
  const match = raw.match(/^(---\n)([\s\S]*?)(\n---\n[\s\S]*)$/);
  if (!match) continue;
  let frontmatter = match[2];
  const before = frontmatter;
  frontmatter = frontmatter.replace(/^column: (.*)$/m, (_, value: string) => columns.has(value.trim()) ? `column: ${value.trim()}` : 'column: todo');
  frontmatter = frontmatter.replace(/^title: (.*)$/m, (_, value: string) => {
    const trimmed = value.trim();
    return /^['"]/.test(trimmed) ? `title: ${trimmed}` : `title: ${JSON.stringify(value)}`;
  });
  if (frontmatter !== before) { fs.writeFileSync(file, `${match[1]}${frontmatter}${match[3]}`); repaired++; }
}
console.log(JSON.stringify({ repaired, root }));
