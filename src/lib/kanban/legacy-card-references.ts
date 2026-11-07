import type { KanbanCard } from './types';
import { isSafeProvenanceUrl } from './provenance-links';

export interface LegacyCardReference {
  href: string;
  service: 'userio' | 'agent-herder';
  origin: 'source' | 'description';
}

const SERVICES = new Map<string, LegacyCardReference['service']>([
  ['https://msg.bezrabotnyi.com', 'userio'],
  ['https://agent.bezrabotnyi.com', 'agent-herder'],
]);

function trimTextDelimiters(value: string): string {
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  const counts: Record<string, number> = { '(': 0, ')': 0, '[': 0, ']': 0, '{': 0, '}': 0 };
  let end = value.length;
  const punctuation = (character: string) => '.,;!?'.includes(character);
  while (end > 0 && punctuation(value[end - 1])) end--;
  for (let index = 0; index < end; index++) {
    const character = value[index];
    if (Object.hasOwn(counts, character)) counts[character]++;
  }
  while (end > 0) {
    const close = value[end - 1];
    const open = pairs[close];
    if (!open || counts[close] <= counts[open]) break;
    counts[close]--;
    end--;
    while (end > 0 && punctuation(value[end - 1])) end--;
  }
  return value.slice(0, end);
}

/** Surface existing links, never manufacture a permalink from an opaque ID. */
export function legacyCardReferences(card: Pick<KanbanCard, 'source' | 'description'>): LegacyCardReference[] {
  const result: LegacyCardReference[] = [];
  const seen = new Set<string>();
  const add = (value: string, origin: LegacyCardReference['origin']) => {
    if (result.length >= 20 || !isSafeProvenanceUrl(value)) return;
    const url = new URL(value);
    const service = SERVICES.get(url.origin);
    if (!service || seen.has(url.href)) return;
    seen.add(url.href);
    result.push({ href: url.href, service, origin });
  };
  if (typeof card.source === 'string') add(card.source, 'source');
  if (typeof card.description === 'string' && card.description.length <= 100_000) {
    for (const match of card.description.matchAll(/https?:\/\/[^\s<>"'`«»“”‘’]+/gi)) {
      let value = trimTextDelimiters(match[0]);
      const before = card.description.slice(Math.max(0, match.index - 2), match.index);
      const marker = ['**', '__', '~~', '*', '_'].find(item => before.endsWith(item));
      if (marker && value.endsWith(marker)) value = value.slice(0, -marker.length);
      add(trimTextDelimiters(value), 'description');
      if (result.length >= 20) break;
    }
  }
  return result;
}

export function legacyReferenceLabel(reference: LegacyCardReference): string {
  const service = reference.service === 'userio' ? 'User.IO' : 'Agent Herder';
  return `${service} ${reference.origin === 'source' ? 'из источника задачи' : 'из описания'}`;
}
