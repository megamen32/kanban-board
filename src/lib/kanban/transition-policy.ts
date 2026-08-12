import type {
  KanbanCard,
  KanbanCardUpdates,
  PlanningEvidence,
} from './types';

export const NIKITA_ACTOR = 'nikita' as const;
export const MANUAL_CONFIRMATION = 'manual_confirmation' as const;
export const MACHINE_VERIFIABLE = 'machine-verifiable' as const;

export type TransitionOrigin = 'human-ui' | 'automation' | 'mcp';

export interface TransitionContext {
  origin: TransitionOrigin;
  actor: string;
  /** True only for a new-card request; existing-card changes remain protected. */
  isCreation?: boolean;
  /** Machine evidence issued by a trusted server-side verifier, never by the request payload. */
  trustedCompletionEvidence?: PlanningEvidence[];
  ownerAuthorization?: {
    actor: string;
    evidence: PlanningEvidence;
  };
  weeklyPlanAcceptance?: {
    actor: string;
    week: string;
    evidence: PlanningEvidence;
  };
}

export type TransitionDecision =
  | {
      kind: 'accepted';
      patch: KanbanCardUpdates;
    }
  | {
      kind: 'redirected';
      patch: KanbanCardUpdates;
      reason: 'automation_done_requires_review';
    }
  | {
      kind: 'rejected';
      reason: 'assignee_change_requires_owner_authorization' | 'deadline_change_requires_human_ui' | 'weekly_plan_requires_batch_acceptance';
    };

/**
 * Validate and normalize one requested card transition without performing I/O.
 *
 * Assignee changes require a direct command from the Nikita owner. Deadline
 * changes from automation and MCP are rejected as inferred deadlines. Human
 * completion records manual evidence; non-human completion requires evidence
 * issued by a trusted server-side verifier or is redirected to review.
 *
 * @param before Card state before the requested transition.
 * @param requested Partial card update requested by the caller.
 * @param context Origin and actor responsible for the request.
 * @returns A safe accepted patch, a review redirect, or a rejection reason.
 */
export function validateTransition(
  before: KanbanCard,
  requested: KanbanCardUpdates,
  context: TransitionContext,
): TransitionDecision {
  // Audit fields are policy-owned. Callers may request a state transition, but
  // cannot manufacture the evidence or actor/timestamp records proving it.
  const {
    completedBy: _requestedCompletedBy,
    completedAt: _requestedCompletedAt,
    completionEvidence: _requestedCompletionEvidence,
    approvalEvidence: _requestedApprovalEvidence,
    ...policyRequested
  } = requested;

  const changesWeeklyPlan = policyRequested.week !== undefined || policyRequested.bigRock !== undefined;
  if (changesWeeklyPlan && !hasWeeklyPlanAcceptance(context, policyRequested.week)) {
    return { kind: 'rejected', reason: 'weekly_plan_requires_batch_acceptance' };
  }

  if (
    changesAssignee(before, policyRequested)
    && !(context.isCreation && context.origin === 'human-ui' && context.actor === NIKITA_ACTOR)
    && !hasOwnerAuthorization(context)
  ) {
    return {
      kind: 'rejected',
      reason: 'assignee_change_requires_owner_authorization',
    };
  }

  if (changesDeadline(before, policyRequested) && context.origin !== 'human-ui') {
    return {
      kind: 'rejected',
      reason: 'deadline_change_requires_human_ui',
    };
  }

  let patch: KanbanCardUpdates = { ...policyRequested };

  if (changesWeeklyPlan) {
    patch = {
      ...patch,
      approvalEvidence: appendEvidence(
        before.approvalEvidence,
        undefined,
        {
          type: 'weekly_plan_acceptance',
          actor: context.weeklyPlanAcceptance!.actor,
          origin: context.origin,
          week: context.weeklyPlanAcceptance!.week,
          evidence: context.weeklyPlanAcceptance!.evidence,
        },
      ),
    };
  }

  if (changesAssignee(before, policyRequested) && hasOwnerAuthorization(context)) {
    patch = {
      ...patch,
      approvalEvidence: appendEvidence(
        before.approvalEvidence,
        undefined,
        {
          type: 'assignee_authorization',
          actor: context.ownerAuthorization!.actor,
          origin: context.origin,
          evidence: context.ownerAuthorization!.evidence,
        },
      ),
    };
  }

  if (policyRequested.column !== 'done' || before.column === 'done') {
    return { kind: 'accepted', patch };
  }

  if (context.origin === 'human-ui') {
    return {
      kind: 'accepted',
      patch: {
        ...patch,
        completedBy: context.actor,
        completedAt: new Date().toISOString(),
        completionEvidence: appendEvidence(
          before.completionEvidence,
          undefined,
          {
            type: MANUAL_CONFIRMATION,
            actor: context.actor,
            origin: context.origin,
          },
        ),
      },
    };
  }

  const completionEvidence = context.trustedCompletionEvidence ?? [];
  if (completionEvidence.some(isMachineVerifiableEvidence)) {
    return {
      kind: 'accepted',
      patch: {
        ...patch,
        completedBy: context.actor,
        completedAt: new Date().toISOString(),
        completionEvidence,
      },
    };
  }

  const {
    completedBy: _completedBy,
    completedAt: _completedAt,
    column: _column,
    ...reviewPatch
  } = patch;
  return {
    kind: 'redirected',
    reason: 'automation_done_requires_review',
    patch: {
      ...reviewPatch,
      column: 'review',
      needsReview: true,
      requiresApprovalFrom: appendPerson(before.requiresApprovalFrom, policyRequested.requiresApprovalFrom, NIKITA_ACTOR),
    },
  };
}

function hasWeeklyPlanAcceptance(context: TransitionContext, requestedWeek?: string): boolean {
  return context.origin === 'human-ui'
    && context.actor === NIKITA_ACTOR
    && context.weeklyPlanAcceptance?.actor === NIKITA_ACTOR
    && context.weeklyPlanAcceptance.week === requestedWeek
    && Object.keys(context.weeklyPlanAcceptance.evidence).length > 0;
}

/**
 * Check that a requested assignee change carries explicit authorization from
 * the stable owner identity, including non-empty authorization evidence.
 *
 * @param context Transition origin, actor, and optional owner authorization.
 * @returns True only when the context contains valid direct-owner authority.
 */
function hasOwnerAuthorization(context: TransitionContext): boolean {
  return context.ownerAuthorization?.actor === NIKITA_ACTOR
    && Object.keys(context.ownerAuthorization.evidence).length > 0;
}

/**
 * Determine whether a requested patch changes either supported assignee field.
 *
 * @param before Card state before the request.
 * @param requested Partial update to inspect.
 * @returns True when an assignee value or list differs from the card.
 */
function changesAssignee(before: KanbanCard, requested: KanbanCardUpdates): boolean {
  const assigneeChanged = requested.assignee !== undefined && requested.assignee !== before.assignee;
  const assigneesChanged = requested.assignees !== undefined
    && !sameArray(requested.assignees, before.assignees);
  return assigneeChanged || assigneesChanged;
}

/**
 * Determine whether a requested patch changes the optional deadline.
 *
 * @param before Card state before the request.
 * @param requested Partial update to inspect.
 * @returns True when the request explicitly changes dueAt, including clearing it.
 */
function changesDeadline(before: KanbanCard, requested: KanbanCardUpdates): boolean {
  return requested.dueAt !== undefined && requested.dueAt !== before.dueAt;
}

/**
 * Compare two string arrays without mutating either input.
 *
 * @param left First array.
 * @param right Second array.
 * @returns True when both arrays contain the same values in the same order.
 */
function sameArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Identify the canonical machine-completion evidence marker.
 *
 * @param evidence Evidence record supplied by the caller.
 * @returns True when the record explicitly asserts machine-verifiable evidence.
 */
function isMachineVerifiableEvidence(evidence: PlanningEvidence): boolean {
  return evidence.type === MACHINE_VERIFIABLE;
}

/**
 * Append evidence while retaining existing card and request evidence.
 *
 * @param before Evidence already persisted on the card.
 * @param requested Evidence included in the requested patch.
 * @param addition Evidence generated by this policy decision.
 * @returns A new evidence list in persistence order.
 */
function appendEvidence(
  before: PlanningEvidence[] | undefined,
  requested: PlanningEvidence[] | undefined,
  addition: PlanningEvidence,
): PlanningEvidence[] {
  return [...(before ?? []), ...(requested ?? []), addition];
}

/**
 * Append a required approval person without duplicating an existing ID.
 *
 * @param before Approval IDs already persisted on the card.
 * @param requested Approval IDs included in the requested patch.
 * @param required Person who must approve the redirected transition.
 * @returns A new, stable approval ID list.
 */
function appendPerson(
  before: string[] | undefined,
  requested: string[] | undefined,
  required: string,
): string[] {
  return Array.from(new Set([...(before ?? []), ...(requested ?? []), required]));
}
