import { NextRequest, NextResponse } from 'next/server';
import { boardIdentityFromRequest, identityFromRequest } from '@/lib/auth/request';
import { tasksDirForScope } from '@/lib/auth/data-scope';
import { getAllCards, updateCard } from '@/lib/kanban/file-store';
import { NIKITA_ACTOR, validateTransition } from '@/lib/kanban/transition-policy';
import { buildWeeklyDraft, runAtomicWrites } from '@/lib/kanban/weekly-plan';
import { moscowIsoWeek } from '@/lib/kanban/planning-views';
import type { KanbanCard } from '@/lib/kanban/types';

function requestedNow(req: NextRequest, body?: Record<string, unknown>): string {
  const value = body?.now ?? req.nextUrl.searchParams.get('now') ?? new Date().toISOString();
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new Error('now must be a valid timestamp');
  return value;
}

export async function GET(req: NextRequest) {
  try {
    const identity = boardIdentityFromRequest(req);
    const cards = getAllCards(tasksDirForScope(identity.scope));
    return NextResponse.json(buildWeeklyDraft(cards, requestedNow(req)));
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const identity = boardIdentityFromRequest(req);
    const authenticated = identityFromRequest(req);
    if (!authenticated || authenticated.username !== NIKITA_ACTOR) {
      return NextResponse.json({ error: 'weekly_plan_acceptance_requires_nikita' }, { status: 403 });
    }
    const body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'request body must be an object' }, { status: 400 });
    }
    const now = requestedNow(req, body as Record<string, unknown>);
    const week = moscowIsoWeek(now);
    if (!week) return NextResponse.json({ error: 'now must be a valid timestamp' }, { status: 400 });
    const cardIds = (body as Record<string, unknown>).cardIds;
    if (!Array.isArray(cardIds) || cardIds.length === 0 || cardIds.length > 6
      || cardIds.some(id => typeof id !== 'string' || !id.trim())
      || new Set(cardIds).size !== cardIds.length) {
      return NextResponse.json({ error: 'cardIds must contain 1 to 6 unique card IDs' }, { status: 400 });
    }
    const tasksDir = tasksDirForScope(identity.scope);
    const allCards = getAllCards(tasksDir);
    const selected = cardIds.map(id => allCards.find(card => card.id === id));
    if (selected.some((card): card is undefined => !card)) {
      return NextResponse.json({ error: 'all cardIds must reference cards in this board scope' }, { status: 400 });
    }
    const existingRocks = allCards.filter(card => card.week === week && card.bigRock === true && !cardIds.includes(card.id));
    if (existingRocks.length + selected.length > 6) {
      return NextResponse.json({ error: 'weekly_plan_allows_at_most_six_big_rocks' }, { status: 400 });
    }
    const batchId = typeof (body as Record<string, unknown>).batchId === 'string'
      && ((body as Record<string, unknown>).batchId as string).trim()
      ? (body as Record<string, unknown>).batchId as string
      : `weekly-${Date.now()}`;
    const decisions = selected.map(card => validateTransition(card as KanbanCard, { week, bigRock: true }, {
      origin: 'human-ui',
      actor: NIKITA_ACTOR,
      weeklyPlanAcceptance: {
        actor: NIKITA_ACTOR,
        week,
        evidence: { type: 'weekly_plan_acceptance', batchId },
      },
    }));
    const rejected = decisions.find(decision => decision.kind === 'rejected');
    if (rejected?.kind === 'rejected') return NextResponse.json({ error: rejected.reason }, { status: 400 });
    const operations = decisions.map((decision, index) => {
      if (decision.kind !== 'accepted') throw new Error('weekly_plan_acceptance_failed');
      const before = selected[index]!;
      return {
        write: () => {
          const result = updateCard(before.id, decision.patch, undefined, tasksDir);
          if ('conflict' in result) throw new Error('weekly_plan_conflict');
          return result;
        },
        rollback: () => {
          const result = updateCard(before.id, {
            week: before.week,
            bigRock: before.bigRock,
            approvalEvidence: before.approvalEvidence,
          }, undefined, tasksDir);
          if ('conflict' in result) throw new Error('weekly_plan_rollback_conflict');
        },
      };
    });
    let updated: KanbanCard[];
    try {
      updated = runAtomicWrites(operations);
    } catch (error) {
      if ((error as Error).message === 'weekly_plan_conflict') {
        return NextResponse.json({ error: 'weekly_plan_conflict' }, { status: 409 });
      }
      throw error;
    }
    return NextResponse.json({ week, cards: updated });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
