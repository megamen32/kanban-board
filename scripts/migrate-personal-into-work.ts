import fs from 'node:fs';
import path from 'node:path';

const source = '/home/roomhacker/todo-kanban/personal-tasks';
const destination = '/home/roomhacker/todo-kanban/work-tasks/personal';

function files(root: string, relative = ''): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    if (entry.name.startsWith('.')) return [];
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) return files(path.join(root, entry.name), next);
    return entry.isFile() && entry.name.endsWith('.md') ? [next] : [];
  });
}

function withOwnership(raw: string): string {
  if (!raw.startsWith('---')) return raw;
  if (/^owner:/m.test(raw)) return raw;
  return raw.replace(/\n---(?:\r?\n|$)/, '\nowner: nikita\nshared: false\n---\n');
}

const copied = files(source);
for (const relative of copied) {
  const target = path.join(destination, relative);
  if (fs.existsSync(target)) throw new Error(`refusing to overwrite ${target}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, withOwnership(fs.readFileSync(path.join(source, relative), 'utf8')));
}
console.log(JSON.stringify({ copied: copied.length, source, destination }));
