import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { createCard, readCardFile, updateCard } from './file-store';
import { DEFAULT_COLUMNS, ROLE_IDS } from './types';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-planning-'));
  roots.push(root);
  return root;
}

describe('planning frontmatter schema', () => {
  test('provides planning v1 defaults and exposes eight supported columns', () => {
    const root = makeRoot();
    const filePath = path.join(root, 'legacy.md');
    fs.writeFileSync(filePath, '---\nid: legacy\ntitle: Legacy\nproject: alpha\n---\nBody');

    const card = readCardFile(filePath, root);

    expect(DEFAULT_COLUMNS.map(column => column.id)).toEqual([
      'inbox', 'todo', 'in-progress', 'review', 'blocked', 'done', 'someday', 'archived',
    ]);
    expect(card).toMatchObject({
      planningVersion: 1,
      type: 'action',
      important: false,
      urgent: false,
      bigRock: false,
      waitingFor: [],
      requiresApprovalFrom: [],
      needsReview: false,
      completionEvidence: [],
      approvalEvidence: [],
    });
  });

  test('preserves unknown YAML keys through an edit', () => {
    const root = makeRoot();
    const filePath = path.join(root, 'legacy.md');
    const unknownYaml = [
      '# future metadata must survive unrelated edits',
      '',
      'future_quoted: "x: y # preserve"',
      'future_inline: {owner: external, flags: [a, b]}',
      'future_folded: >',
      '  first line',
      '  second line',
    ].join('\n');
    fs.writeFileSync(filePath, [
      '---',
      'id: legacy',
      'title: Legacy',
      'project: alpha',
      unknownYaml,
      '---',
      'Body',
    ].join('\n'));

    const card = readCardFile(filePath, root);
    expect(card).not.toBeNull();
    updateCard('legacy', { title: 'Renamed' }, undefined, root);

    const rewritten = fs.readFileSync(path.join(root, 'Renamed-legacy.md'), 'utf8');
    expect(rewritten).toContain(unknownYaml);
    expect(rewritten).not.toContain('planning_version:');
  });

  test('preserves a quoted unknown top-level key through an ordinary edit', () => {
    const root = makeRoot();
    const filePath = path.join(root, 'quoted-key.md');
    const quotedUnknown = '"future:key": "value: preserve"';
    fs.writeFileSync(filePath, [
      '---',
      'id: quoted-key',
      'title: Quoted key',
      'project: alpha',
      quotedUnknown,
      '---',
      'Body',
    ].join('\n'));

    expect(readCardFile(filePath, root)).not.toBeNull();
    updateCard('quoted-key', { title: 'Renamed quoted key' }, undefined, root);

    const rewritten = fs.readFileSync(path.join(root, 'Renamed-quoted-key-quoted.md'), 'utf8');
    expect(rewritten).toContain(quotedUnknown);
  });

  test('does not materialize planning metadata when moving a legacy card', () => {
    const root = makeRoot();
    const filePath = path.join(root, 'legacy.md');
    fs.writeFileSync(filePath, '---\nid: legacy\ntitle: Legacy\nproject: alpha\n---\nBody');

    const card = readCardFile(filePath, root);
    expect(card).not.toBeNull();
    updateCard('legacy', { column: 'in-progress' }, undefined, root);

    const rewritten = fs.readFileSync(filePath, 'utf8');
    expect(rewritten).toContain('column: in-progress');
    expect(rewritten).not.toContain('planning_version:');
    expect(rewritten).not.toContain('type: action');
    expect(rewritten).not.toContain('big_rock: false');
  });

  test('does not materialize planning metadata for an ordinary legacy UI save', () => {
    const root = makeRoot();
    const filePath = path.join(root, 'legacy-ui.md');
    fs.writeFileSync(filePath, '---\nid: legacy-ui\ntitle: Legacy UI\nproject: alpha\n---\nBody');

    expect(readCardFile(filePath, root)).not.toBeNull();
    updateCard('legacy-ui', {
      title: 'Renamed by UI', description: 'Updated body', column: 'inbox', priority: 'medium',
      tags: [], project: 'alpha', assignees: [], dueAt: null,
      type: null, role: null, important: false, urgent: false, scheduledAt: null, todayRank: null,
      waitingFor: [], requiresApprovalFrom: [], suggestedAssignee: null, parent: null,
    } as never, undefined, root);

    const rewritten = fs.readFileSync(path.join(root, 'Renamed-by-UI-legacy.md'), 'utf8');
    expect(rewritten).not.toContain('planning_version:');
    expect(rewritten).not.toContain('type: action');
    expect(rewritten).not.toContain('big_rock: false');
  });

  test('persists blocked and someday columns with planning metadata', () => {
    const root = makeRoot();
    const created = createCard('Planning', 'Body', 'blocked', 'high', [], 'alpha', [], root);
    const updated = updateCard(created.id, {
      type: 'outcome',
      role: 'product-builder',
      week: '2026-W33',
      bigRock: true,
      scheduledAt: '2026-08-12T09:00:00+03:00',
      todayRank: 1,
      waitingFor: ['nikita'],
    }, undefined, root);
    expect('conflict' in updated).toBe(false);

    updateCard(created.id, { column: 'someday' }, undefined, root);
    const reread = readCardFile(path.join(root, created.fileName), root);
    expect(reread).toMatchObject({
      column: 'someday',
      planningVersion: 1,
      type: 'outcome',
      role: 'product-builder',
      week: '2026-W33',
      bigRock: true,
      todayRank: 1,
      waitingFor: ['nikita'],
    });
  });

  test('accepts the approved stable roles and rejects unknown role IDs', () => {
    const roles = ROLE_IDS;
    const root = makeRoot();
    for (const [index, role] of roles.entries()) {
      const filePath = path.join(root, `role-${index}.md`);
      fs.writeFileSync(filePath, `---\nid: role-${index}\ntitle: Role ${index}\nproject: alpha\nrole: ${role}\n---\nBody`);
      expect(readCardFile(filePath, root)?.role).toBe(role);
    }

    const invalidPath = path.join(root, 'invalid-role.md');
    fs.writeFileSync(invalidPath, '---\nid: invalid-role\ntitle: Invalid\nproject: alpha\nrole: unknown-role\n---\nBody');
    expect(() => readCardFile(invalidPath, root)).toThrow(/role/);
  });

  test('rejects malformed known planning fields without writing', () => {
    const root = makeRoot();
    const filePath = path.join(root, 'malformed.md');
    const raw = '---\nid: malformed\ntitle: Malformed\nproject: alpha\nimportant: "yes"\n---\nBody';
    fs.writeFileSync(filePath, raw);

    expect(() => readCardFile(filePath, root)).toThrow(/important/);
    expect(fs.readFileSync(filePath, 'utf8')).toBe(raw);

    const created = createCard('Valid', 'Body', 'todo', 'medium', [], 'alpha', [], root);
    const createdPath = path.join(root, created.fileName);
    const beforeUpdate = fs.readFileSync(createdPath, 'utf8');
    expect(() => updateCard(created.id, { important: 'yes' as never }, undefined, root)).toThrow(/important/);
    expect(() => updateCard(created.id, { column: 'not-a-column' as never }, undefined, root)).toThrow(/column/);
    expect(fs.readFileSync(createdPath, 'utf8')).toBe(beforeUpdate);
  });
});
