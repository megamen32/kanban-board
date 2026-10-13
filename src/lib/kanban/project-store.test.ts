import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureProject, listProjects } from './project-store';
import { createCard, getAllCards } from './file-store';
import { getProjectOptions } from '../../components/kanban/view-model';

// Fast unit: durable zero-card registry, expected <1s/max5s.
describe('persistent projects', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-project-')); });
  afterEach(() => { vi.restoreAllMocks(); fs.rmSync(dir, { recursive: true, force: true }); });
  it('persists immutable empty projects, exact repeats and name conflicts without a card', () => {
    expect(listProjects(dir)).toEqual([]);
    const input = { externalKey: 'exmanager:app:team', name: 'Пустая команда' };
    const first = ensureProject(dir, input);
    expect(first.created).toBe(true);
    expect(ensureProject(dir, input)).toEqual({ ...first, created: false });
    expect(listProjects(dir)).toEqual([first.project]);
    expect(getAllCards(dir)).toEqual([]);
    expect(() => ensureProject(dir, { ...input, name: 'Другая' })).toThrow(/conflict/);
    expect(listProjects(dir)).toEqual([first.project]);
    expect(getProjectOptions([], listProjects(dir))).toEqual(['Пустая команда']);
    createCard('legacy fixture', '', 'todo', 'medium', [], 'Старый проект', [], dir);
    expect(getProjectOptions(getAllCards(dir), listProjects(dir))).toEqual(['Пустая команда', 'Старый проект']);
  });
  it('keeps same-name distinct identities and never interprets keys as paths', () => {
    const a = ensureProject(dir, { externalKey: '../outside', name: 'Team' });
    const b = ensureProject(dir, { externalKey: 'other', name: 'Team' });
    expect(a.project.id).not.toBe(b.project.id);
    expect(listProjects(dir)).toHaveLength(2);
    expect(getProjectOptions([], listProjects(dir))).toEqual(['Team']);
  });
  it.each(['', '   ', ' name', 'name\n'])('rejects invalid names without publication: %j', name => {
    expect(() => ensureProject(dir, { externalKey: 'key', name })).toThrow();
    expect(listProjects(dir)).toEqual([]);
  });
  it('never acknowledges failed persistence or silently discards corruption', () => {
    const write = vi.spyOn(fs, 'fsyncSync').mockImplementation(() => { throw new Error('disk failure'); });
    expect(() => ensureProject(dir, { externalKey: 'key', name: 'Team' })).toThrow(/disk failure/);
    write.mockRestore();
    expect(listProjects(dir)).toEqual([]);
    ensureProject(dir, { externalKey: 'key', name: 'Team' });
    const registry = path.join(dir, '.projects');
    fs.writeFileSync(path.join(registry, fs.readdirSync(registry)[0]), '{}');
    expect(() => listProjects(dir)).toThrow();
  });
  // Focused integration: actual separate Node processes racing one immutable key;
  // expected <2s/max10s. Proves no duplicate UUID or partial reads across processes.
  it('converges concurrent processes on one fsynced immutable object', async () => {
    const script = `import { ensureProject } from './src/lib/kanban/project-store.ts'; console.log(JSON.stringify(ensureProject(process.argv[1], {externalKey:'concurrent',name:'Concurrent fixture'})));`;
    const results = await Promise.all(Array.from({ length: 4 }, () => promisify(execFile)(process.execPath,
      ['--experimental-strip-types', '--input-type=module', '-e', script, dir], { timeout: 8000 })));
    const projects = results.map(result => JSON.parse(result.stdout));
    expect(projects.filter(result => result.created)).toHaveLength(1);
    expect(new Set(projects.map(result => result.project.id)).size).toBe(1);
    expect(listProjects(dir)).toEqual([projects[0].project]);
    expect(getAllCards(dir)).toEqual([]);
    expect(fs.readdirSync(path.join(dir, '.projects'))).toHaveLength(1);
  }, 10000);

});
