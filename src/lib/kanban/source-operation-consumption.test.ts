import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAdmittedCard, deleteCard, findCardById } from './file-store';
import { admitSourceTask, listPendingSourceIntents, markSourceIntentConsumed } from './source-operation';
import type { SourceAdmissionRequest } from './source-operation';

const roots: string[] = [];

function fixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-source-consumption-'));
  roots.push(dir);
  return dir;
}

function request(): SourceAdmissionRequest {
  return {
    tenant: 'fixture-tenant', sourceOwner: 'fixture-owner', sourceEvent: 'event-21', primaryItem: 'primary',
    sourceRevision: 'rev-1', project: 'alpha', title: 'Check supplier quote', description: 'Compare two lines',
    priority: 'medium', assignees: [], classification: 'explicit-task', evidenceRefs: ['fixture:event-21:span-1'],
  };
}

function admit(dir: string) {
  return admitSourceTask(request(), dir, id => findCardById(id, dir), card => createAdmittedCard(card, dir));
}

function journalPath(dir: string): string {
  return path.join(dir, '.source-operations', 'source-operations.json');
}

function journalRecord(dir: string): Record<string, unknown> {
  const journal = JSON.parse(fs.readFileSync(journalPath(dir), 'utf8')) as { operations: Record<string, Record<string, unknown>> };
  return Object.values(journal.operations)[0]!;
}

afterEach(() => {
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('source launch intent consumption', () => {
  it('consumes a pending launch intent terminally and stops issuing it', () => {
    const dir = fixture();
    const admitted = admit(dir);
    expect(admitted.status).toBe('committed');
    const pending = listPendingSourceIntents(dir, id => findCardById(id, dir));
    expect(pending).toHaveLength(1);
    const item = pending[0]!;
    const intentId = item.intentId!;

    const consumed = markSourceIntentConsumed(dir, { operationKey: item.operationKey, intentId });
    expect(consumed).toEqual({
      status: 'consumed', operationKey: item.operationKey, cardId: item.cardId, intentId,
    });

    expect(listPendingSourceIntents(dir, id => findCardById(id, dir))).toEqual([]);
    expect(journalRecord(dir)).toMatchObject({ intentState: 'CONSUMED', state: 'COMMITTED', cardId: item.cardId });
  });

  it('is idempotent: a repeated consumption leaves the journal unchanged', () => {
    const dir = fixture();
    admit(dir);
    const item = listPendingSourceIntents(dir, id => findCardById(id, dir))[0]!;
    const intentId = item.intentId!;
    expect(markSourceIntentConsumed(dir, { operationKey: item.operationKey, intentId }).status).toBe('consumed');

    const before = fs.readFileSync(journalPath(dir), 'utf8');
    const second = markSourceIntentConsumed(dir, { operationKey: item.operationKey, intentId });
    const after = fs.readFileSync(journalPath(dir), 'utf8');

    expect(second).toEqual({
      status: 'already-consumed', operationKey: item.operationKey, cardId: item.cardId, intentId,
    });
    expect(after).toBe(before);
    expect(listPendingSourceIntents(dir, id => findCardById(id, dir))).toEqual([]);
  });

  it('refuses an unknown operation key and a mismatched intent id', () => {
    const dir = fixture();
    admit(dir);
    const item = listPendingSourceIntents(dir, id => findCardById(id, dir))[0]!;
    const intentId = item.intentId!;
    expect(() => markSourceIntentConsumed(dir, { operationKey: 'unknown-operation-key', intentId }))
      .toThrow('unknown source operation');
    expect(() => markSourceIntentConsumed(dir, { operationKey: item.operationKey, intentId: 'another-intent' }))
      .toThrow('source intent id mismatch');
    expect(listPendingSourceIntents(dir, id => findCardById(id, dir))).toHaveLength(1);
  });

  it('never consumes a cancelled intent', () => {
    const dir = fixture();
    const admitted = admit(dir);
    const operationKey = journalRecord(dir).operationKey as string;
    const intentId = journalRecord(dir).intentId as string;
    expect(deleteCard(admitted.cardId, dir)).toBe(true);

    const result = markSourceIntentConsumed(dir, { operationKey, intentId });
    expect(result).toMatchObject({ status: 'not-consumable', reason: 'intent-not-pending' });
    expect(journalRecord(dir)).toMatchObject({ intentState: 'CANCELLED', state: 'CANCELLED' });
    expect(listPendingSourceIntents(dir, id => findCardById(id, dir))).toEqual([]);
  });
});
