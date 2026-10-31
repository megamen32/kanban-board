/** Personal graph presentation only. These preferences never mutate business cards. */
export type GraphDirection = 'vertical' | 'horizontal';
export interface GraphPoint { x: number; y: number }
export interface GraphLayoutPreferences {
  version: number;
  direction: GraphDirection;
  columns: number;
  projectOrder: string[];
  positions: Record<GraphDirection, Record<string, GraphPoint>>;
  updatedAt?: string;
}
export interface GraphLayoutChange {
  direction?: GraphDirection;
  columns?: number;
  projectOrder?: string[];
  placement?: { direction: GraphDirection; values: Record<string, GraphPoint | null> };
}
export const MAX_GRAPH_ENTRIES = 10000;
export function defaultGraphLayout(): GraphLayoutPreferences {
  return { version: 0, direction: 'vertical', columns: 0, projectOrder: [], positions: { vertical: {}, horizontal: {} } };
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const direction = (value: unknown): value is GraphDirection => value === 'vertical' || value === 'horizontal';
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 1200
  && !['__proto__', 'constructor', 'prototype'].includes(value) && !/[\u0000-\u001f\u007f]/.test(value);
const point = (value: unknown): value is GraphPoint => record(value) && Object.keys(value).length === 2
  && ['x', 'y'].every(key => typeof value[key] === 'number' && Number.isFinite(value[key]) && Number(value[key]) >= 0 && Number(value[key]) <= 1000000);

export function parseGraphLayoutChange(value: unknown): GraphLayoutChange | null {
  if (!record(value) || !Object.keys(value).length || Object.keys(value).some(key => !['direction', 'columns', 'projectOrder', 'placement'].includes(key))) return null;
  const result: GraphLayoutChange = {};
  if ('direction' in value) { if (!direction(value.direction)) return null; result.direction = value.direction; }
  if ('columns' in value) { if (!Number.isInteger(value.columns) || Number(value.columns) < 0 || Number(value.columns) > 6) return null; result.columns = Number(value.columns); }
  if ('projectOrder' in value) {
    if (!Array.isArray(value.projectOrder) || value.projectOrder.length > MAX_GRAPH_ENTRIES || !value.projectOrder.every(validId)
      || new Set(value.projectOrder).size !== value.projectOrder.length) return null;
    result.projectOrder = [...value.projectOrder];
  }
  if ('placement' in value) {
    const placement = value.placement;
    if (!record(placement) || Object.keys(placement).some(key => !['direction', 'values'].includes(key))
      || !direction(placement.direction) || !record(placement.values) || Object.keys(placement.values).length > MAX_GRAPH_ENTRIES) return null;
    const values: Record<string, GraphPoint | null> = {};
    for (const [id, position] of Object.entries(placement.values)) {
      if (!validId(id) || (position !== null && !point(position))) return null;
      values[id] = position === null ? null : { x: Math.round(position.x), y: Math.round(position.y) };
    }
    result.placement = { direction: placement.direction, values };
  }
  return result;
}

export function applyGraphLayoutChange(previous: GraphLayoutPreferences, change: GraphLayoutChange): GraphLayoutPreferences {
  const next: GraphLayoutPreferences = { ...previous, projectOrder: [...previous.projectOrder],
    positions: { vertical: { ...previous.positions.vertical }, horizontal: { ...previous.positions.horizontal } } };
  if (change.direction) next.direction = change.direction;
  if (change.columns !== undefined) next.columns = change.columns;
  if (change.projectOrder) next.projectOrder = [...change.projectOrder];
  if (change.placement) {
    const values = next.positions[change.placement.direction];
    for (const [id, position] of Object.entries(change.placement.values)) {
      if (position === null) delete values[id]; else values[id] = { ...position };
    }
    if (Object.keys(values).length > MAX_GRAPH_ENTRIES) throw new Error('graph_layout_too_large');
  }
  return next;
}

export function parseStoredGraphLayout(value: unknown): GraphLayoutPreferences | null {
  if (!record(value) || !Number.isSafeInteger(value.version) || Number(value.version) < 0 || !record(value.positions)) return null;
  const settings = parseGraphLayoutChange({ direction: value.direction, columns: value.columns, projectOrder: value.projectOrder });
  if (!settings) return null;
  let parsed = applyGraphLayoutChange(defaultGraphLayout(), settings);
  for (const orientation of ['vertical', 'horizontal'] as const) {
    const update = parseGraphLayoutChange({ placement: { direction: orientation, values: value.positions[orientation] } });
    if (!update) return null;
    parsed = applyGraphLayoutChange(parsed, update);
  }
  parsed.version = Number(value.version);
  if (typeof value.updatedAt === 'string') parsed.updatedAt = value.updatedAt;
  return parsed;
}
