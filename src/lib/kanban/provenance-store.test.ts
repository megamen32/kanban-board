import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCard, findCardById, getAllCards, updateCard, type CreateCardOptions } from './file-store';
import type { KanbanCard } from './types';

const message = 'https://messages.example.test/opaque-message?selected=1';
const session = 'https://sessions.example.test/opaque-session#turn';

describe('durable source and session display links', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-provenance-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  const create = (options: CreateCardOptions = {}) =>
    createCard('Synthetic task', 'Original text', 'inbox', 'medium', [], 'Synthetic project', [], dir, undefined, options);

  it('round-trips explicit URLs in canonical snake_case frontmatter', () => {
    const card = create({ sourceMessageUrl: message, sourceSessionUrl: session });
    const persisted = findCardById(card.id, dir)!;
    expect(persisted).toMatchObject({ sourceMessageUrl: message, sourceSessionUrl: session });
    const raw = fs.readFileSync(path.join(dir, persisted.fileName), 'utf8');
    expect(raw).toContain('source_message_url:');
    expect(raw).toContain('source_session_url:');
    expect(persisted.taskExecutionHistory).toBeUndefined();
    expect(persisted.sourceAdmission).toBeUndefined();
  });

  it('preserves omitted fields and legacy source, clears only explicit null', () => {
    const card = create({ sourceMessageUrl: message, sourceSessionUrl: session });
    const changed = updateCard(card.id, { source: 'legacy:opaque', title: 'New title', sourceMessageUrl: undefined }, card.version, dir) as KanbanCard;
    expect(changed).toMatchObject({ source: 'legacy:opaque', sourceMessageUrl: message, sourceSessionUrl: session });
    const cleared = updateCard(card.id, { sourceMessageUrl: null }, changed.version, dir) as KanbanCard;
    expect(cleared.sourceMessageUrl).toBeUndefined();
    expect(findCardById(card.id, dir)).toMatchObject({ source: 'legacy:opaque', sourceSessionUrl: session });
    expect(fs.readFileSync(path.join(dir, cleared.fileName), 'utf8')).not.toContain('source_message_url:');
  });

  it('keeps a malformed imported link and unknown YAML lossless until explicitly edited', () => {
    const id = '00000000-0000-4000-8000-000000000042';
    const unknown = 'foreign_metadata: |-\n  Keep this text exactly.\n  Second line.\n';
    const invalid = 'source_message_url: "javascript:alert(1)"\n';
    fs.writeFileSync(path.join(dir, 'legacy.md'), [
      '---', 'id: ' + id, 'title: Legacy synthetic', 'column: inbox', 'priority: medium',
      'version: 4', 'project: Synthetic project', invalid.trimEnd(), unknown.trimEnd(), '---', 'Original body', '',
    ].join('\n'));
    const original = findCardById(id, dir)!;
    expect(original).toBeDefined();
    expect(original.sourceMessageUrl).toBeUndefined();
    const edited = updateCard(id, { title: 'Unrelated edit' }, 4, dir) as KanbanCard;
    const editedRaw = fs.readFileSync(path.join(dir, edited.fileName), 'utf8');
    expect(editedRaw).toContain(invalid);
    expect(editedRaw).toContain(unknown);
    expect(editedRaw).not.toContain('planning_version:');
    const linked = updateCard(id, { sourceMessageUrl: message }, edited.version, dir) as KanbanCard;
    const linkedRaw = fs.readFileSync(path.join(dir, linked.fileName), 'utf8');
    expect(linkedRaw).not.toContain('javascript:');
    expect(linkedRaw.match(/^source_message_url:/gm)).toHaveLength(1);
    expect(linkedRaw).toContain(unknown);
    const cleared = updateCard(id, { sourceMessageUrl: null }, linked.version, dir) as KanbanCard;
    expect(findCardById(id, dir)?.sourceMessageUrl).toBeUndefined();
    expect(fs.readFileSync(path.join(dir, cleared.fileName), 'utf8')).toContain(unknown);
  });

  it('rejects invalid updates before renaming or changing any stored card', () => {
    const card = create({ sourceMessageUrl: message });
    const file = path.join(dir, card.fileName);
    const before = fs.readFileSync(file, 'utf8');
    expect(() => updateCard(card.id, {
      title: 'Must not rename', sourceSessionUrl: 'https://user:password@example.test/',
    }, card.version, dir)).toThrow(/sourceSessionUrl/);
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
    expect(findCardById(card.id, dir)?.version).toBe(card.version);
  });

  it('rejects invalid creation and preserves optimistic conflict semantics', () => {
    expect(() => create({ sourceMessageUrl: 'javascript:alert(1)' })).toThrow(/sourceMessageUrl/);
    expect(getAllCards(dir)).toHaveLength(0);
    const card = create({ sourceMessageUrl: message });
    const conflict = updateCard(card.id, { sourceMessageUrl: null }, card.version + 1, dir);
    expect(conflict).toHaveProperty('conflict', true);
    expect(findCardById(card.id, dir)?.sourceMessageUrl).toBe(message);
  });
});
