import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { KanbanCard } from '@/lib/kanban/types';

vi.mock('../ui/button', () => ({ Button: ({ children, ...props }: any) => React.createElement('button', props, children) }));
vi.mock('../ui/textarea', () => ({ Textarea: (props: any) => React.createElement('textarea', props) }));

import {
  ReviewRecoveryControl,
  buildRecoveryRequest,
  canSubmitRecovery,
  isOwnerRecoveryCandidate,
} from './review-recovery-control';

const stuck = (overrides: Partial<KanbanCard> = {}): KanbanCard => ({
  id: '11044d6a-0648-41a6-949e-6b3b3c1680c1',
  title: 'QA seed: release report blocked',
  description: '',
  column: 'in-progress',
  priority: 'medium',
  tags: [],
  order: 0,
  created: '2026-10-26T00:00:00Z',
  updated: '2026-10-26T00:00:00Z',
  fileName: 'stuck.md',
  version: 16,
  project: 'UX QA 2026-10-26',
  assignees: [],
  needsReview: true,
  requiresApprovalFrom: [],
  resultHistory: [],
  ...overrides,
});

describe('owner-only rework recovery for a stuck review gate', () => {
  it('offers recovery only to the owner of a card without approvers or results', () => {
    expect(isOwnerRecoveryCandidate(stuck(), 'nikita')).toBe(true);
    expect(isOwnerRecoveryCandidate(stuck(), 'oleg')).toBe(false);
    expect(isOwnerRecoveryCandidate(stuck(), null)).toBe(false);
    expect(isOwnerRecoveryCandidate(stuck(), undefined)).toBe(false);
  });

  it('leaves ordinary review cards and cards with a decision untouched', () => {
    expect(isOwnerRecoveryCandidate(stuck({ column: 'review' }), 'nikita')).toBe(false);
    expect(isOwnerRecoveryCandidate(stuck({ requiresApprovalFrom: ['nikita'] }), 'nikita')).toBe(false);
    expect(isOwnerRecoveryCandidate(stuck({ resultHistory: [{ summary: 'result', evidenceRefs: ['source:event:span-1'], submittedBy: 'exmanager-service', submittedAt: '2026-10-26T00:00:00Z' }] }), 'nikita')).toBe(false);
    expect(isOwnerRecoveryCandidate(stuck({ needsReview: false }), 'nikita')).toBe(false);
  });

  it('sends an explicit owner rework with a note and the expected version', () => {
    expect(buildRecoveryRequest(stuck(), '  вернуть в работу  ')).toEqual({
      action: 'recover-rework',
      note: 'вернуть в работу',
      expectedVersion: 16,
    });
    expect(canSubmitRecovery('  ')).toBe(false);
    expect(canSubmitRecovery(' что исправить ')).toBe(true);
  });

  it('shows the recovery control to the owner and nothing to anybody else', () => {
    const owner = renderToStaticMarkup(React.createElement(ReviewRecoveryControl, { card: stuck(), username: 'nikita' }));
    expect(owner).toContain('Вернуть на доработку');
    expect(owner).toContain('нет назначенного проверяющего');
    expect(owner).not.toContain('Принять результат');

    expect(renderToStaticMarkup(React.createElement(ReviewRecoveryControl, { card: stuck(), username: 'oleg' }))).toBe('');
    expect(renderToStaticMarkup(React.createElement(ReviewRecoveryControl, { card: stuck(), username: null }))).toBe('');
    expect(renderToStaticMarkup(React.createElement(ReviewRecoveryControl, { card: stuck({ column: 'review' }), username: 'nikita' }))).toBe('');
  });
});
