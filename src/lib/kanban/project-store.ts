import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';

export const projectInput = {
  externalKey: z.string().min(1).max(512).refine(value => value === value.trim() && !/[\u0000-\u001f]/.test(value)),
  name: z.string().min(1).max(256).refine(value => value === value.trim() && !/[\u0000-\u001f]/.test(value)),
};
const projectSchema = z.object({ id: z.string().uuid(), ...projectInput });
export type KanbanProject = z.infer<typeof projectSchema>;

function directory(tasksDir: string) { return path.join(tasksDir, '.projects'); }
function filename(externalKey: string) { return createHash('sha256').update(externalKey).digest('hex') + '.json'; }
function syncDirectory(dir: string) {
  const fd = fs.openSync(dir, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function readProject(file: string): KanbanProject {
  const project = projectSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (path.basename(file) !== filename(project.externalKey)) throw new Error('Project registry key mismatch');
  return project;
}

/** Hidden registry is durable board data, never a Markdown card. */
export function listProjects(tasksDir: string): KanbanProject[] {
  const dir = directory(tasksDir);
  try {
    return fs.readdirSync(dir).filter(name => /^[a-f0-9]{64}\.json$/.test(name))
      .map(name => readProject(path.join(dir, name)))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru') || a.externalKey.localeCompare(b.externalKey));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !fs.existsSync(dir)) return [];
    throw error;
  }
}

export function ensureProject(tasksDir: string, input: { externalKey: string; name: string }): { project: KanbanProject; created: boolean } {
  const valid = z.object(projectInput).parse(input);
  const dir = directory(tasksDir);
  fs.mkdirSync(dir, { recursive: true });
  syncDirectory(tasksDir);
  const target = path.join(dir, filename(valid.externalKey));
  const existing = () => {
    const project = readProject(target);
    if (project.externalKey !== valid.externalKey || project.name !== valid.name) throw new Error('Project conflict: externalKey already has a different name');
    syncDirectory(dir);
    return { project, created: false };
  };
  if (fs.existsSync(target)) return existing();
  const project = { id: randomUUID(), ...valid };
  const temporary = path.join(dir, '.' + project.id + '.tmp');
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try {
    try {
      fs.writeFileSync(fd, JSON.stringify(project) + '\n');
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    // Atomic no-replace publication across processes: readers see a complete
    // fsynced object and concurrent ensures converge on the winner's UUID.
    try { fs.linkSync(temporary, target); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return existing();
      throw error;
    }
    syncDirectory(dir);
    return { project, created: true };
  } finally { fs.unlinkSync(temporary); }
}
