export function normalizeDueAt(value: unknown, allowNull = false): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null && allowNull) return null;
  if (typeof value !== 'string' || !value.trim()) throw new Error('dueAt must be an ISO date');
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) throw new Error('dueAt must be an ISO date');
  return new Date(timestamp).toISOString();
}
