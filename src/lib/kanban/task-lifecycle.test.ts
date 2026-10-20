import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCard, findCardById, updateCard } from './file-store';
import { decideHumanReview, validateTransition } from './transition-policy';

const directories: string[] = [];
function fixtureDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-lifecycle-'));
  directories.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('versioned task result and human review lifecycle', () => {
  it('persists each executor result and evidence reference, then rework preserves earlier attempts', () => {
    const dir = fixtureDir();
    const card = createCard('Fixture task', '', 'in-progress', 'medium', [], 'fixture', [], dir);
    const attempt = validateTransition(card, {
      column: 'done',
      executorResult: { summary: 'First attempt', evidenceRefs: ['source:event:span-1'], nextAction: 'Wait for review' },
    }, { origin: 'mcp', actor: 'exmanager-service' });
    expect(attempt).toMatchObject({ kind: 'redirected', reason: 'executor_result_requires_review', patch: {
      column: 'review', needsReview: true, requiresApprovalFrom: ['nikita'], nextAction: 'Wait for review',
      resultHistory: [{ summary: 'First attempt', evidenceRefs: ['source:event:span-1'], submittedBy: 'exmanager-service' }],
    } });
    if (attempt.kind !== 'redirected') throw new Error('expected review transition');
    const review = updateCard(card.id, attempt.patch, card.version, dir);
    if ('conflict' in review) throw new Error('unexpected fixture version conflict');
    expect(findCardById(card.id, dir)).toMatchObject({ column: 'review', resultHistory: [
      { summary: 'First attempt', evidenceRefs: ['source:event:span-1'] },
    ] });

    expect(decideHumanReview(review, 'rework', 'marina', 'Add a comparison.')).toMatchObject({
      kind: 'rejected', reason: 'reviewer_not_authorized',
    });
    const rework = decideHumanReview(review, 'rework', 'nikita', 'Add a comparison.');
    expect(rework).toMatchObject({ kind: 'accepted', patch: {
      column: 'in-progress', needsReview: false, nextAction: 'Add a comparison.',
      reviewHistory: [{ decision: 'rework', actor: 'nikita', note: 'Add a comparison.' }],
    } });
    if (rework.kind !== 'accepted') throw new Error('expected authorized rework');
    const returned = updateCard(card.id, rework.patch, review.version, dir);
    if ('conflict' in returned) throw new Error('unexpected rework version conflict');
    expect(findCardById(card.id, dir)).toMatchObject({
      column: 'in-progress', nextAction: 'Add a comparison.',
      resultHistory: [{ summary: 'First attempt', evidenceRefs: ['source:event:span-1'] }],
      reviewHistory: [{ decision: 'rework', actor: 'nikita', note: 'Add a comparison.' }],
    });

    const retry = validateTransition(returned, {
      executorResult: { summary: 'Updated attempt', evidenceRefs: ['source:event:span-2'] },
    }, { origin: 'mcp', actor: 'exmanager-service' });
    expect(retry).toMatchObject({ kind: 'redirected', patch: { resultHistory: [
      { summary: 'First attempt' }, { summary: 'Updated attempt' },
    ] } });
  });

  it('requires a current explicit reviewer decision for review-to-done', () => {
    const dir = fixtureDir();
    const card = createCard('Acceptance task', '', 'review', 'medium', [], 'fixture', [], dir);
    const waiting = updateCard(card.id, { needsReview: true, requiresApprovalFrom: ['nikita'] }, card.version, dir);
    if ('conflict' in waiting) throw new Error('unexpected fixture version conflict');
    expect(validateTransition(waiting, { column: 'done' }, { origin: 'human-ui', actor: 'nikita' })).toMatchObject({
      kind: 'rejected', reason: 'review_requires_explicit_decision',
    });
    expect(decideHumanReview(waiting, 'accept', 'nikita')).toMatchObject({ kind: 'accepted', patch: {
      column: 'done', completedBy: 'nikita', needsReview: false,
      completionEvidence: [{ type: 'manual_confirmation', actor: 'nikita', origin: 'human-ui' }],
      reviewHistory: [{ decision: 'accepted', actor: 'nikita' }],
    } });
    expect(decideHumanReview(waiting, 'accept', 'mcp')).toMatchObject({ kind: 'rejected', reason: 'reviewer_not_authorized' });
  });

  it('does not let an ordinary human grant themselves review authority', () => {
    const dir = fixtureDir();
    const card = createCard('Reviewer grant task', '', 'todo', 'medium', [], 'fixture', [], dir);
    expect(validateTransition(card, { requiresApprovalFrom: ['marina'] }, {
      origin: 'human-ui', actor: 'marina',
    })).toMatchObject({ kind: 'rejected', reason: 'reviewer_change_requires_owner_authorization' });
    expect(validateTransition(card, { requiresApprovalFrom: ['marina'] }, {
      origin: 'human-ui', actor: 'nikita',
      ownerAuthorization: { actor: 'nikita', evidence: { type: 'reviewer-assignment' } },
    })).toMatchObject({ kind: 'accepted', patch: { requiresApprovalFrom: ['marina'] } });
  });

  it('rejects parent links that would create a parent/child cycle', () => {
    const dir = fixtureDir();
    const parent = createCard('Parent', '', 'todo', 'medium', [], 'fixture', [], dir);
    const child = createCard('Child', '', 'todo', 'medium', [], 'fixture', [], dir);
    const grandchild = createCard('Grandchild', '', 'todo', 'medium', [], 'fixture', [], dir);
    const childLink = updateCard(child.id, { parent: parent.id }, child.version, dir);
    if ('conflict' in childLink) throw new Error('unexpected child version conflict');
    const grandchildLink = updateCard(grandchild.id, { parent: child.id }, grandchild.version, dir);
    if ('conflict' in grandchildLink) throw new Error('unexpected grandchild version conflict');

    expect(() => updateCard(parent.id, { parent: grandchild.id }, parent.version, dir)).toThrow('parent_relation_cycle');
    expect(findCardById(parent.id, dir)?.parent).toBeUndefined();
    expect(findCardById(grandchild.id, dir)?.parent).toBe(child.id);
  });
});
