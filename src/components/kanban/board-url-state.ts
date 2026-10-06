import type { AttentionFilter, PlanningTab, WorkspaceView } from './view-model';

export type BoardLayout = 'kanban' | 'list';
export type ClosedKind = 'all' | 'done' | 'archived';

export type BoardUrlState = Readonly<{
  project: string;
  workspaceView: WorkspaceView;
  layout: BoardLayout;
  tab: PlanningTab;
  assignee: string;
  person: string;
  search: string;
  attention: AttentionFilter;
  closedKind: ClosedKind;
  inboxOnly: boolean;
}>;

const TABS = new Set<PlanningTab>(['execution', 'inbox', 'week', 'today', 'balance', 'closed']);
const WORKSPACE_VIEWS = new Set<WorkspaceView>(['mine', 'shared', 'all']);
const LAYOUTS = new Set<BoardLayout>(['kanban', 'list']);
const ATTENTION_FILTERS = new Set<AttentionFilter>(['all', 'blocked', 'unassigned']);
const CLOSED_KINDS = new Set<ClosedKind>(['all', 'done', 'archived']);

function boundedValue(value: string | null): string | undefined {
  const normalized = value?.normalize('NFKC').trim();
  return normalized ? normalized.slice(0, 240) : undefined;
}

/** Parses a shareable board URL without trusting arbitrary values as enums. */
export function parseBoardUrlState(params: URLSearchParams): Partial<BoardUrlState> {
  const parsed: { -readonly [Key in keyof BoardUrlState]?: BoardUrlState[Key] } = {};
  const project = boundedValue(params.get('project'));
  const assignee = boundedValue(params.get('assignee'));
  const person = boundedValue(params.get('person'));
  const search = boundedValue(params.get('search'));
  const tab = params.get('tab');
  const view = params.get('view');
  const explicitWorkspace = params.get('workspace');
  const explicitLayout = params.get('layout');
  const attention = params.get('attention');
  const closedKind = params.get('closed');

  if (project) parsed.project = project;
  if (assignee) parsed.assignee = assignee;
  if (person) parsed.person = person;
  if (search) parsed.search = search;
  if (tab && TABS.has(tab as PlanningTab)) parsed.tab = tab as PlanningTab;

  // view=all|shared|mine is the canonical team-filter contract. Keep the
  // older view=list|kanban spelling readable and expose layout explicitly.
  if (explicitWorkspace && WORKSPACE_VIEWS.has(explicitWorkspace as WorkspaceView)) {
    parsed.workspaceView = explicitWorkspace as WorkspaceView;
  } else if (view && WORKSPACE_VIEWS.has(view as WorkspaceView)) {
    parsed.workspaceView = view as WorkspaceView;
  }
  if (explicitLayout && LAYOUTS.has(explicitLayout as BoardLayout)) {
    parsed.layout = explicitLayout as BoardLayout;
  } else if (view && LAYOUTS.has(view as BoardLayout)) {
    parsed.layout = view as BoardLayout;
  }
  if (attention && ATTENTION_FILTERS.has(attention as AttentionFilter)) parsed.attention = attention as AttentionFilter;
  if (closedKind && CLOSED_KINDS.has(closedKind as ClosedKind)) parsed.closedKind = closedKind as ClosedKind;
  if (params.get('inbox') === '1') parsed.inboxOnly = true;

  return parsed;
}

/** Serializes the complete visible board state so the current URL is copyable. */
export function serializeBoardUrlState(state: BoardUrlState): URLSearchParams {
  const params = new URLSearchParams();
  params.set('tab', state.tab);
  params.set('view', state.workspaceView);
  params.set('layout', state.layout);
  if (state.project !== 'all') params.set('project', state.project);
  if (state.assignee !== 'all') params.set('assignee', state.assignee);
  if (state.person) params.set('person', state.person);
  if (state.search.trim()) params.set('search', state.search.trim());
  if (state.attention !== 'all') params.set('attention', state.attention);
  if (state.closedKind !== 'all') params.set('closed', state.closedKind);
  if (state.inboxOnly) params.set('inbox', '1');
  return params;
}
