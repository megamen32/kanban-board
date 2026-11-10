import { isDateOnlyDueAt, normalizeDueAt } from './due-at';

export function toDateTimeLocalValue(value?: string): string {
  if (!value) return '';
  if (isDateOnlyDueAt(value)) return value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function fromDateTimeLocalValue(value: string): string | undefined {
  return value ? normalizeDueAt(value) ?? undefined : undefined;
}
