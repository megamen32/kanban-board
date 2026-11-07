/** Display references only. These URLs never grant source, execution, or completion authority. */
export const MAX_PROVENANCE_URL_LENGTH = 2048;
export type ProvenanceUrlField = 'sourceMessageUrl' | 'sourceSessionUrl';

export function isSafeProvenanceUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > MAX_PROVENANCE_URL_LENGTH
      || /[\u0000-\u0020\u007f-\u009f\\]/.test(value)) return false;
  const authority = value.match(/^https?:\/\/([^/?#]*)/i)?.[1];
  if (!authority || authority.includes('@')) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:')
      && !!url.hostname && !url.username && !url.password
      && !/[\u0000-\u001f\u007f-\u009f]/.test(decodeURI(value));
  } catch {
    return false;
  }
}

/** Undefined preserves a value; null explicitly clears it; strings must be safe URLs. */
export function normalizeProvenanceUrl(value: unknown, field: ProvenanceUrlField): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (!isSafeProvenanceUrl(value)) {
    throw new Error(field + ' must be an absolute HTTP(S) URL without credentials, whitespace or control characters (max ' + MAX_PROVENANCE_URL_LENGTH + ' characters)');
  }
  return value;
}
