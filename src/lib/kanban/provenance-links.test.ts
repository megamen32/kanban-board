import { describe, expect, it } from 'vitest';
import { isSafeProvenanceUrl, MAX_PROVENANCE_URL_LENGTH, normalizeProvenanceUrl } from './provenance-links';

describe('explicit provenance URL validation', () => {
  it.each([
    'https://messages.example.test/opaque-link?message=abc#selected',
    'http://sessions.example.test:8080/?from=board#/session/opaque',
    'https://messages.example.test/сообщение?q=a%20b',
  ])('accepts a supplied HTTP(S) reference without rewriting it: %s', value => {
    expect(isSafeProvenanceUrl(value)).toBe(true);
    expect(normalizeProvenanceUrl(value, 'sourceMessageUrl')).toBe(value);
  });

  it.each([
    'javascript:alert(1)', 'data:text/html,unsafe', 'file:///tmp/session', '//example.test/path',
    '/relative', '', ' https://example.test/', 'https://example.test/a b',
    'https://user:password@example.test/', 'https://@example.test/',
    'https://example.test/\nnext', 'https://example.test/%0d%0aHeader',
    'https://example.test/%7F', 'https://example.test\\@other.test/',
    'https:///example.test/path', 'https://example.test/%invalid',
  ])('rejects unsafe or ambiguous references: %s', value => {
    expect(isSafeProvenanceUrl(value)).toBe(false);
    expect(() => normalizeProvenanceUrl(value, 'sourceSessionUrl')).toThrow(/sourceSessionUrl/);
  });

  it('bounds length and separates omission from explicit clearing', () => {
    const prefix = 'https://example.test/';
    const longest = prefix + 'a'.repeat(MAX_PROVENANCE_URL_LENGTH - prefix.length);
    expect(isSafeProvenanceUrl(longest)).toBe(true);
    expect(isSafeProvenanceUrl(longest + 'a')).toBe(false);
    expect(normalizeProvenanceUrl(undefined, 'sourceMessageUrl')).toBeUndefined();
    expect(normalizeProvenanceUrl(null, 'sourceMessageUrl')).toBeNull();
    for (const value of [0, false, {}, []]) {
      expect(() => normalizeProvenanceUrl(value, 'sourceMessageUrl')).toThrow(/sourceMessageUrl/);
    }
  });
});
