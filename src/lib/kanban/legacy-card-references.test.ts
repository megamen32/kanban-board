import { describe, expect, it } from 'vitest';
import { legacyCardReferences, legacyReferenceLabel } from './legacy-card-references';

const message = 'https://msg.bezrabotnyi.com/#/chat/fixture-conversation?m=fixture-message';
const session = 'https://agent.bezrabotnyi.com/fixture-session';

describe('existing links in legacy task metadata', () => {
  it('surfaces exact Markdown and plain links without manufacturing source metadata', () => {
    const card = Object.freeze({ source: 'telegram:opaque:42', description: `Сообщение [открыть](${message}). Сессия: <${session}>` });
    expect(legacyCardReferences(card)).toEqual([
      { href: message, service: 'userio', origin: 'description' },
      { href: session, service: 'agent-herder', origin: 'description' },
    ]);
    expect(card.source).toBe('telegram:opaque:42');
  });

  it('preserves every distinct reference and deduplicates a source repeated in the description', () => {
    expect(legacyCardReferences({ source: message, description: `${message}\n${session}\n${session}` })).toEqual([
      { href: message, service: 'userio', origin: 'source' },
      { href: session, service: 'agent-herder', origin: 'description' },
    ]);
  });

  it('retains parentheses that are part of a URL while removing the Markdown delimiter', () => {
    const url = 'https://msg.bezrabotnyi.com/fixture(a)?message=42';
    expect(legacyCardReferences({ description: `[ссылка](${url}).` })[0].href).toBe(url);
  });

  it('handles a long run of unmatched text delimiters within the supported description bound', () => {
    const description = message + ')'.repeat(95_000);
    expect(legacyCardReferences({ description })).toEqual([
      { href: message, service: 'userio', origin: 'description' },
    ]);
  });

  it.each([['«', '»'], ['“', '”'], ['‘', '’']])('keeps typographic quotes outside the URL: %s %s', (open, close) => {
    expect(legacyCardReferences({ description: `${open}${message}${close} ${open}${session}${close}` }).map(item => item.href)).toEqual([message, session]);
  });

  it('removes surrounding Markdown emphasis while preserving encoded punctuation in an actual URL', () => {
    for (const marker of ['**', '__', '~~', '*', '_']) {
      expect(legacyCardReferences({ description: `${marker}${message}${marker}.` })[0].href).toBe(message);
    }
    const encoded = message + '&label=%C2%BB';
    expect(legacyCardReferences({ description: `«${encoded}»` })[0].href).toBe(encoded);
  });

  it('does not derive a URL from a message ID or an arbitrary URL', () => {
    expect(legacyCardReferences({ source: 'telegram:123|456:789', description: 'https://example.test/context' })).toEqual([]);
  });

  it.each([
    'https://msg.bezrabotnyi.com.evil.example/message/42',
    'https://user:password@msg.bezrabotnyi.com/message/42',
    'https://msg.bezrabotnyi.com:8443/message/42',
    'http://msg.bezrabotnyi.com/message/42',
    'https://msg.bezrabotnyi.com/%0a',
    'https://msg.bezrabotnyi.com/' + 'a'.repeat(2048),
  ])('does not turn an unsupported or unsafe source into a reference: %s', value => {
    expect(legacyCardReferences({ source: value, description: value })).toEqual([]);
  });

  it('bounds rendering without altering the description and keeps provenance visible in labels', () => {
    const description = Array.from({ length: 30 }, (_, index) => `${message}-${index}`).join('\n');
    const references = legacyCardReferences({ description });
    expect(references).toHaveLength(20);
    expect(legacyReferenceLabel(references[0])).toBe('User.IO из описания');
    expect(legacyReferenceLabel({ href: session, service: 'agent-herder', origin: 'source' })).toBe('Agent Herder из источника задачи');
    expect(legacyCardReferences({ description: 'x'.repeat(100_001) })).toEqual([]);
  });
});
