import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import type { KanbanCard } from '@/lib/kanban/types';

vi.mock('@/components/ui/dialog', () => ({ Dialog: () => null, DialogContent: () => null, DialogHeader: () => null, DialogTitle: () => null, DialogFooter: () => null }));
vi.mock('@/components/ui/button', () => ({ Button: () => null }));
vi.mock('@/components/ui/input', () => ({ Input: () => null }));
vi.mock('@/components/ui/textarea', () => ({ Textarea: () => null }));
vi.mock('@/components/ui/badge', () => ({ Badge: () => null }));
vi.mock('@/components/ui/checkbox', () => ({ Checkbox: () => null }));
vi.mock('@/lib/kanban/date-input', () => ({ fromDateTimeLocalValue: (value: string) => value ? new Date(value).toISOString() : undefined, toDateTimeLocalValue: (value?: string) => value ?? '' }));
vi.mock('@/lib/kanban/types', () => ({ DEFAULT_COLUMNS: [], PRIORITY_COLORS: {}, ROLE_IDS: ['product-builder', 'client-integrator', 'team-lead', 'author-public', 'personal-relationships', 'sharpening-the-saw'] }));
import { buildPlanningMetadataUpdates } from './card-edit-dialog';
import { buildPlanningMetadataCreate } from './add-card-dialog';

describe('planning metadata dialog payloads', () => {
  it('builds complete planning metadata for create without audit evidence', () => {
    expect(buildPlanningMetadataCreate({
      type: 'outcome',
      role: 'product-builder',
      important: true,
      urgent: true,
      scheduledAt: '2026-08-12T07:00:00.000Z',
      todayRank: '2',
      waitingFor: 'marina',
      requiresApprovalFrom: 'nikita',
      suggestedAssignee: 'marina',
      parent: 'outcome-1',
    })).toEqual({
      type: 'outcome',
      role: 'product-builder',
      important: true,
      urgent: true,
      scheduledAt: '2026-08-12T07:00:00.000Z',
      todayRank: 2,
      waitingFor: ['marina'],
      requiresApprovalFrom: ['nikita'],
      suggestedAssignee: 'marina',
      parent: 'outcome-1',
    });
  });

  it('builds edit metadata and preserves explicit reassignment fields only', () => {
    const card = { assignees: ['nikita'] } as KanbanCard;
    const updates = buildPlanningMetadataUpdates(card, {
      type: 'action',
      role: 'team-lead',
      important: false,
      urgent: true,
      scheduledAt: '',
      todayRank: '1',
      waitingFor: 'nikita',
      requiresApprovalFrom: '',
      suggestedAssignee: '',
      parent: '',
    }, ['marina']);

    expect(updates).toMatchObject({
      type: 'action', role: 'team-lead', important: false, urgent: true,
      scheduledAt: null, todayRank: 1, waitingFor: ['nikita'],
      requiresApprovalFrom: [], suggestedAssignee: null, parent: null,
      assignees: ['marina'], reassignmentIntent: 'direct-owner-command',
    });
    expect(updates).not.toHaveProperty('completedBy');
    expect(updates).not.toHaveProperty('completionEvidence');
    expect(updates).not.toHaveProperty('approvalEvidence');
  });

  it('uses explicit clear markers for every optional planning field', () => {
    const updates = buildPlanningMetadataUpdates({ assignees: ['nikita'] } as KanbanCard, {
      type: '', role: '', important: false, urgent: false, scheduledAt: '', todayRank: '',
      waitingFor: '', requiresApprovalFrom: '', suggestedAssignee: '', parent: '',
    }, ['nikita']);

    expect(updates).toMatchObject({
      type: null, role: null, scheduledAt: null, todayRank: null,
      waitingFor: [], requiresApprovalFrom: [], suggestedAssignee: null, parent: null,
    });
  });
});
