import { afterEach, describe, expect, test, vi } from 'vitest';
import { CardBriefProjectionCache, cardBriefProjectionCache, getCardBriefFacts, hashCardBriefSource, isCurrentCardBrief, requestCardBrief, type CardBriefProjection, type CardBriefSource } from './card-brief';

const card = {
  title: 'Подготовить расчёт',
  assignees: [' Анна ', ''],
  assignee: 'legacy owner',
  dueAt: undefined,
  nextAction: null,
};

afterEach(() => vi.unstubAllGlobals());

describe('card brief projection', () => {
  test('builds concise facts from current fields without inventing a missing next step', () => {
    expect(getCardBriefFacts(card)).toEqual({
      action: 'Подготовить расчёт',
      executor: 'Анна',
      deadline: 'Не указан',
    });
    expect(getCardBriefFacts({ ...card, assignees: [], assignee: 'Иван', nextAction: 'Сверить исходные данные' }).executor).toBe('Иван');
    expect(getCardBriefFacts({ ...card, nextAction: '  Сверить исходные данные  ' }).nextStep).toBe('Сверить исходные данные');
  });

  test('accepts only a non-empty projection for the exact card and source hash', () => {
    const projection: CardBriefProjection = { cardId: 'c1', sourceHash: 'hash-1', summary: 'Сверить расчёт', generatedAt: '2026-10-28T10:00:00Z' };
    expect(isCurrentCardBrief('c1', 'hash-1', projection)).toBe(true);
    expect(isCurrentCardBrief('c1', 'hash-2', projection)).toBe(false);
    expect(isCurrentCardBrief('c2', 'hash-1', projection)).toBe(false);
    expect(isCurrentCardBrief('c1', 'hash-1', { ...projection, summary: '  ' })).toBe(false);
  });

  test('cache rejects stale results and returns only a matching source revision', () => {
    const cache = new CardBriefProjectionCache();
    const projection: CardBriefProjection = { cardId: 'c1', sourceHash: 'hash-1', summary: 'Сверить расчёт', generatedAt: '2026-10-28T10:00:00Z' };
    cache.markCurrent('c1', 'hash-1');
    expect(cache.setIfCurrent(projection, 'hash-2')).toBe(false);
    expect(cache.get('c1', 'hash-1')).toBeUndefined();
    expect(cache.setIfCurrent(projection, 'hash-1')).toBe(true);
    expect(cache.get('c1', 'hash-1')).toEqual(projection);
    expect(cache.get('c1', 'hash-2')).toBeUndefined();
  });

  test('source hash changes when description or a current structured fact changes', async () => {
    const source = {
      id: 'c1', title: 'Подготовить расчёт', description: 'Тестовый исходник', assignees: ['Анна'], assignee: 'Анна',
      dueAt: undefined, nextAction: 'Сверить данные', column: 'in-progress' as const,
    };
    const hash = await hashCardBriefSource(source);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(await hashCardBriefSource({ ...source, description: 'Обновлённый тестовый исходник' })).not.toBe(hash);
    expect(await hashCardBriefSource({ ...source, dueAt: '2026-10-30T12:00:00Z' })).not.toBe(hash);
  });

  test('coalesces duplicate generation requests for one source hash', async () => {
    const source: CardBriefSource = { id: 'coalesce-fixture', title: 'Synthetic action', description: 'x'.repeat(450),
      assignees: [], dueAt: undefined, nextAction: null, column: 'todo' };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ summary: 'Synthetic summary', sourceHash: 'coalesce-hash' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    cardBriefProjectionCache.markCurrent(source.id, 'coalesce-hash');
    const [first, second] = await Promise.all([
      requestCardBrief(source, 'coalesce-hash'),
      requestCardBrief(source, 'coalesce-hash'),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/internal/card-summary', expect.objectContaining({ method: 'POST', credentials: 'same-origin' }));
    const requestInit = fetchMock.mock.calls[0]?.[1];
    expect(JSON.parse(String(requestInit?.body))).toEqual({ cardId: source.id, sourceHash: 'coalesce-hash', title: source.title, description: source.description, nextAction: '' });
    expect(first).toEqual(second);
    expect(first?.summary).toBe('Synthetic summary');
  });

  test('does not cache API errors, mismatched hashes, or overlong summaries', async () => {
    const source: CardBriefSource = { id: 'error-fixture', title: 'Synthetic action', description: 'x'.repeat(450),
      assignees: [], dueAt: undefined, nextAction: null, column: 'todo' };
    const hash = 'error-source-hash';
    cardBriefProjectionCache.markCurrent(source.id, hash);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'source_too_large' }), { status: 413 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ summary: 'Wrong revision', sourceHash: 'other-hash' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ summary: 'x'.repeat(601), sourceHash: hash }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await requestCardBrief(source, hash)).toBeNull();
    expect(await requestCardBrief(source, hash)).toBeNull();
    expect(await requestCardBrief(source, hash)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(cardBriefProjectionCache.get(source.id, hash)).toBeUndefined();
  });

  test('discards a late model response after a newer source hash becomes current', async () => {
    const source: CardBriefSource = { id: 'stale-fixture', title: 'Synthetic action', description: 'x'.repeat(450),
      assignees: [], dueAt: undefined, nextAction: null, column: 'todo' };
    let resolveFetch!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { resolveFetch = resolve; })));
    const pending = requestCardBrief(source, 'old-source-hash');
    cardBriefProjectionCache.markCurrent(source.id, 'new-source-hash');
    resolveFetch(new Response(JSON.stringify({ summary: 'Stale synthetic summary', sourceHash: 'old-source-hash' }), { status: 200 }));
    expect(await pending).toBeNull();
    expect(cardBriefProjectionCache.get(source.id, 'old-source-hash')).toBeUndefined();
  });
});
