/** A real calendar day, without a fabricated time or timezone. */
export function isDateOnlyDueAt(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1];
}

export function normalizeDueAt(value: unknown, allowNull = false): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null && allowNull) return null;
  if (typeof value !== 'string' || !value.trim()) throw new Error('dueAt must be an ISO date');
  const input = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    if (!isDateOnlyDueAt(input)) throw new Error('dueAt must be a valid calendar date');
    return input;
  }
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) throw new Error('dueAt must be an ISO date');
  return new Date(timestamp).toISOString();
}

/** Comparison/reminder boundary only; the stored date continues to have no time. */
export function dueAtTimestamp(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    // The board's Moscow day finishes at 23:59:59.999 (UTC+03:00).
    return isDateOnlyDueAt(value) ? Date.parse(`${value}T23:59:59.999+03:00`) : Number.NaN;
  }
  return Date.parse(value);
}

/** Render a calendar deadline without adding an hour or shifting its day. */
export function formatDueAt(
  value: string | null | undefined,
  options: Intl.DateTimeFormatOptions,
): string | null {
  if (!value || !Number.isFinite(dueAtTimestamp(value))) return null;
  const dateOnly = isDateOnlyDueAt(value);
  const date = new Date(dateOnly ? `${value}T12:00:00Z` : value);
  return date.toLocaleString('ru-RU', dateOnly
    ? { ...options, timeZone: 'UTC', hour: undefined, minute: undefined, second: undefined, timeStyle: undefined }
    : options);
}
