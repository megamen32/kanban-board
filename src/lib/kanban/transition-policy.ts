import type {
  KanbanCard,
  KanbanCardUpdates,
  PlanningEvidence,
  ExecutorResultInput,
  TaskReviewRecord,
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
  /** Authenticated work-service task authority; cannot be set by request data. */
  internalTeamAuthorization?: { actor: string; evidence: PlanningEvidence };
  /** Machine evidence issued by a trusted server-side verifier, never by the request payload. */
  trustedCompletionEvidence?: PlanningEvidence[];
  ownerAuthorization?: {
    actor: string;
    evidence: PlanningEvidence;
  };
  /** Direct owner completion delegated by an authenticated trusted service. */
  ownerCompletionAuthorization?: { actor: string; evidence: PlanningEvidence };
  weeklyPlanAcceptance?: {
    actor: string;
    week: string;
    evidence: PlanningEvidence;
  };
}

export type HumanReviewAction = 'accept' | 'rework' | 'recover-rework';
export type HumanReviewDecision =
  | { kind: 'accepted'; patch: KanbanCardUpdates }
  | { kind: 'rejected'; reason: 'task_not_waiting_for_review' | 'reviewer_not_authorized' | 'rework_note_required' };

export type TransitionDecision =
  | {
      kind: 'accepted';
      patch: KanbanCardUpdates;
    }
  | {
      kind: 'redirected';
      patch: KanbanCardUpdates;
      reason: 'automation_done_requires_review' | 'executor_result_requires_review';
    }
  | {
      kind: 'rejected';
      reason: 'assignee_change_requires_owner_authorization' | 'reviewer_change_requires_owner_authorization'
        | 'deadline_change_requires_human_ui' | 'weekly_plan_requires_batch_acceptance'
        | 'review_requires_explicit_decision' | 'executor_result_requires_non_review_state'
        | 'blocked_reason_required';
    };

/**
 * Validate and normalize one requested card transition without performing I/O.
 *
 * Assignee changes require a direct command from the Nikita owner. Deadline
 * changes from automation and unconfirmed MCP are rejected as inferred deadlines.
 * Authenticated service MCP may carry a server-issued confirmed owner command. Human
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
  const waitingForHumanReview = before.column === 'review' || before.needsReview;
  const reviewStateKeys = [
    'column', 'needsReview', 'requiresApprovalFrom', 'completedBy', 'completedAt',
    'completionEvidence', 'reviewHistory', 'resultHistory', 'executorResult',
  ];
  const ownerReviewerAssignmentOnly = context.origin === 'human-ui'
    && hasOwnerAuthorization(context)
    && Object.keys(requested).length === 1
    && Object.hasOwn(requested, 'requiresApprovalFrom');
  // Review-state decisions use the authenticated human review endpoint and its
  // expected-version CAS. The board owner may change only the designated reviewer;
  // accepting, rejecting, completing, and all other review-state writes remain gated.
  if (waitingForHumanReview && !ownerReviewerAssignmentOnly
    && reviewStateKeys.some((key) => Object.hasOwn(requested, key))) {
    return { kind: 'rejected', reason: 'review_requires_explicit_decision' };
  }

  // Audit fields are policy-owned. Callers may request a state transition, but
  // cannot manufacture the evidence or actor/timestamp records proving it.
  const {
    completedBy: _requestedCompletedBy,
    completedAt: _requestedCompletedAt,
    completionEvidence: _requestedCompletionEvidence,
    approvalEvidence: _requestedApprovalEvidence,
    resultHistory: _requestedResultHistory,
    reviewHistory: _requestedReviewHistory,
    nextAction: _requestedNextAction,
    executorResult,
    ...policyRequested
  } = requested;

  const changesWeeklyPlan = policyRequested.week !== undefined || policyRequested.bigRock !== undefined;
  if (changesWeeklyPlan && !hasWeeklyPlanAcceptance(context, policyRequested.week)) {
    return { kind: 'rejected', reason: 'weekly_plan_requires_batch_acceptance' };
  }

  if (policyRequested.column === 'blocked'
      && !(typeof policyRequested.blockerReason === 'string' && policyRequested.blockerReason.trim())
      && !(typeof before.blockerReason === 'string' && before.blockerReason.trim())) {
    return { kind: 'rejected', reason: 'blocked_reason_required' };
  }

  if (
    changesAssignee(before, policyRequested)
    && !(context.isCreation && context.origin === 'human-ui' && context.actor === NIKITA_ACTOR)
    && !hasOwnerAuthorization(context) && !hasInternalTeamAuthorization(context)
  ) {
    return {
      kind: 'rejected',
      reason: 'assignee_change_requires_owner_authorization',
    };
  }

  if (changesReviewers(before, policyRequested) && !hasOwnerAuthorization(context)) {
    return { kind: 'rejected', reason: 'reviewer_change_requires_owner_authorization' };
  }

  if (changesDeadline(before, policyRequested) && context.origin !== 'human-ui'
    && !(context.origin === 'mcp' && (hasOwnerAuthorization(context) || hasInternalTeamAuthorization(context)))) {
    return {
      kind: 'rejected',
      reason: 'deadline_change_requires_human_ui',
    };
  }

  if (executorResult !== undefined) {
    if (context.origin === 'human-ui') {
      return { kind: 'rejected', reason: 'executor_result_requires_non_review_state' };
    }
    if (before.column === 'review' || before.needsReview) {
      return { kind: 'rejected', reason: 'executor_result_requires_non_review_state' };
    }
    const result = normalizeExecutorResult(executorResult);
    if (!result) return { kind: 'rejected', reason: 'executor_result_requires_non_review_state' };
    const submittedAt = new Date().toISOString();
    return {
      kind: 'redirected',
      reason: 'executor_result_requires_review',
      patch: {
        ...policyRequested,
        column: 'review',
        needsReview: true,
        requiresApprovalFrom: before.requiresApprovalFrom?.length
          ? before.requiresApprovalFrom : [NIKITA_ACTOR],
        resultHistory: [...(before.resultHistory ?? []), {
          ...result,
          submittedBy: context.actor,
          submittedAt,
        }],
        nextAction: result.nextAction ?? null,
      },
    };
  }

  if ((before.column === 'review' || before.needsReview)
    && policyRequested.column !== undefined && policyRequested.column !== before.column) {
    return { kind: 'rejected', reason: 'review_requires_explicit_decision' };
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

  // An integrator-process card never completes on an automatic transition.
  if (!isIntegratorProcessCard(before) && hasInternalTeamAuthorization(context) && (requested.completionEvidence ?? []).some(item =>
    typeof item.type === 'string' && item.type.trim() && Object.keys(item).some(key => key !== 'type')
  ) && !(before.requiresApprovalFrom ?? []).length && !(policyRequested.requiresApprovalFrom ?? []).length) {
    return { kind: 'accepted', patch: { ...patch, completedBy: context.internalTeamAuthorization!.actor,
      completedAt: new Date().toISOString(), needsReview: false,
      completionEvidence: appendEvidence(before.completionEvidence, undefined, {
        type: 'internal_team_completion', actor: context.internalTeamAuthorization!.actor, origin: 'mcp',
        evidence: context.internalTeamAuthorization!.evidence, result: requested.completionEvidence,
      }),
    } };
  }

  const ownerCompletion = context.ownerCompletionAuthorization;
  if (context.origin === 'mcp' && ownerCompletion?.actor === NIKITA_ACTOR
    && Object.keys(ownerCompletion.evidence).length > 0 && before.owner === NIKITA_ACTOR
    && Object.keys(policyRequested).every(key => key === 'column')
    && (before.requiresApprovalFrom ?? []).every(actor => actor === NIKITA_ACTOR)) {
    return {
      kind: 'accepted',
      patch: { ...patch, completedBy: NIKITA_ACTOR, completedAt: new Date().toISOString(),
        needsReview: false, requiresApprovalFrom: [],
        completionEvidence: appendEvidence(before.completionEvidence, undefined, {
          type: 'owner_confirmed_completion', actor: NIKITA_ACTOR, origin: context.origin,
          evidence: ownerCompletion.evidence,
        }),
      },
    };
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
  // An integrator-process card never completes on an automatic transition.
  if (!isIntegratorProcessCard(before) && completionEvidence.some(isMachineVerifiableEvidence)) {
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

/** Build an explicit human decision only for a currently assigned reviewer. */
export function decideHumanReview(
  before: KanbanCard,
  action: HumanReviewAction,
  actor: string,
  note = '',
): HumanReviewDecision {
  if (action === 'recover-rework') {
    if (actor !== NIKITA_ACTOR || before.column !== 'in-progress' || !before.needsReview
      || (before.requiresApprovalFrom?.length ?? 0) > 0 || (before.resultHistory?.length ?? 0) > 0
      || (before.taskExecutionHistory?.length ?? 0) > 0) {
      return { kind: 'rejected', reason: 'task_not_waiting_for_review' };
    }
    if (!note.trim()) return { kind: 'rejected', reason: 'rework_note_required' };
    const decidedAt = new Date().toISOString();
    const review: TaskReviewRecord = { decision: 'rework', actor, decidedAt, note: note.trim() };
    return {
      kind: 'accepted',
      patch: {
        column: 'in-progress',
        needsReview: false,
        nextAction: note.trim(),
        reviewHistory: [...(before.reviewHistory ?? []), review],
      },
    };
  }
  if (before.column !== 'review' || !before.needsReview) {
    return { kind: 'rejected', reason: 'task_not_waiting_for_review' };
  }
  const designatedReviewer = Boolean(actor && (before.requiresApprovalFrom ?? []).includes(actor));
  const ownerReviewWithoutReviewer = actor === NIKITA_ACTOR
    && (before.requiresApprovalFrom?.length ?? 0) === 0
    && (before.resultHistory?.length ?? 0) > 0;
  if (!designatedReviewer && !ownerReviewWithoutReviewer) {
    return { kind: 'rejected', reason: 'reviewer_not_authorized' };
  }
  if (action === 'rework' && !note.trim()) {
    return { kind: 'rejected', reason: 'rework_note_required' };
  }
  const decidedAt = new Date().toISOString();
  const review: TaskReviewRecord = {
    decision: action === 'accept' ? 'accepted' : 'rework',
    actor,
    decidedAt,
    ...(note.trim() ? { note: note.trim() } : {}),
  };
  if (action === 'rework') {
    return {
      kind: 'accepted',
      patch: {
        column: 'in-progress',
        needsReview: false,
        nextAction: note.trim(),
        reviewHistory: [...(before.reviewHistory ?? []), review],
      },
    };
  }
  return {
    kind: 'accepted',
    patch: {
      column: 'done',
      needsReview: false,
      completedBy: actor,
      completedAt: decidedAt,
      completionEvidence: appendEvidence(before.completionEvidence, undefined, {
        type: MANUAL_CONFIRMATION,
        actor,
        origin: 'human-ui',
      }),
      reviewHistory: [...(before.reviewHistory ?? []), review],
    },
  };
}

function normalizeExecutorResult(value: unknown): ExecutorResultInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  if (typeof result.summary !== 'string' || !result.summary.trim()
    || !Array.isArray(result.evidenceRefs)
    || result.evidenceRefs.some(ref => typeof ref !== 'string' || !ref.trim())) return null;
  return {
    summary: result.summary.trim(),
    evidenceRefs: [...result.evidenceRefs] as string[],
    ...(typeof result.nextAction === 'string' && result.nextAction.trim() ? { nextAction: result.nextAction.trim() } : {}),
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
function hasInternalTeamAuthorization(context: TransitionContext): boolean {
  return context.origin === 'mcp' && !!context.internalTeamAuthorization?.actor
    && Object.keys(context.internalTeamAuthorization.evidence).length > 0;
}

function hasOwnerAuthorization(context: TransitionContext): boolean {
  return context.ownerAuthorization?.actor === NIKITA_ACTOR
    && Object.keys(context.ownerAuthorization.evidence).length > 0;
}

/**
 * Identify an integrator-process card by its immutable source-admission binding.
 * The canonical catalog-link path already recognizes an admitted integrator task
 * by exactly this classification, and the binding can never be added later.
 *
 * @param card Card state before the requested transition.
 * @returns True when the card belongs to the integrator process.
 */
function isIntegratorProcessCard(card: KanbanCard): boolean {
  return card.sourceAdmission?.classification === 'explicit-task';
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

function changesReviewers(before: KanbanCard, requested: KanbanCardUpdates): boolean {
  return requested.requiresApprovalFrom !== undefined
    && !sameArray(requested.requiresApprovalFrom, before.requiresApprovalFrom ?? []);
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
