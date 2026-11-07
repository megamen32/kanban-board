import { describe, expect, it, vi } from 'vitest';
import { createBoardReader, mergeCardReceipts } from './board-state';
import { BoardReadError } from './board-snapshot';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return {promise, resolve, reject};
}

type Card = {id: string; version: number; title: string; column: string};
const card = (version: number, column = 'in-progress', id = 'synthetic-task'): Card => ({
  id, version, column, title: `Synthetic task v${version}`,
});

describe('version-monotonic board receipts', () => {
  it('keeps v9 and its completed result when a delayed v8 update arrives later', async () => {
    let displayed = [card(7)];
    const older = deferred<Card>();
    const newer = deferred<Card>();
    const apply = (receipt: Promise<Card>) => receipt.then(saved => {
      displayed = mergeCardReceipts(displayed, [saved]);
    });
    const oldUpdate = apply(older.promise);
    const newUpdate = apply(newer.promise);

    const accepted = card(9, 'done');
    newer.resolve(accepted);
    await newUpdate;
    older.resolve(card(8, 'review'));
    await oldUpdate;

    expect(displayed).toEqual([accepted]);
    expect(displayed[0]).toBe(accepted);
  });

  it('merges bulk receipts independently without reviving absent cards or mutating input', () => {
    const current = [card(9), card(4, 'inbox', 'second')];
    const saved = card(5, 'ready', 'second');
    const receipts = [card(8), saved, card(2, 'inbox', 'deleted')];

    const result = mergeCardReceipts(current, receipts);

    expect(result).toEqual([current[0], saved]);
    expect(result[0]).toBe(current[0]);
    expect(current[1].version).toBe(4);
    expect(receipts).toHaveLength(3);
  });

  it('appends a created ID once, takes its highest receipt version, and keeps equal versions', () => {
    const existing = card(9);
    const created = card(3, 'ready', 'created');
    const sameVersion = {...existing, title: 'Conflicting duplicate receipt'};

    expect(mergeCardReceipts([existing], [
      sameVersion, card(1, 'inbox', 'created'), created, card(2, 'review', 'created'),
    ], true)).toEqual([existing, created]);
  });
});

describe('board read epochs', () => {
  it.each([401, 403, 503])('ignores a stale %i error after a confirmed mutation', async status => {
    const response = deferred<Card[]>();
    let displayed = [card(7)];
    let error: unknown = null;
    const onError = vi.fn((failure: unknown) => {
      error = failure;
      if (failure instanceof BoardReadError && [401, 403].includes(failure.status)) displayed = [];
    });
    const onSettled = vi.fn();
    const reader = createBoardReader({
      load: () => response.promise,
      onData: data => { displayed = data; },
      onError,
      onSettled,
    });

    const reading = reader.read();
    await Promise.resolve();
    reader.invalidate();
    displayed = mergeCardReceipts(displayed, [card(9, 'done')]);
    response.reject(new BoardReadError('Synthetic stale failure', status));
    await reading;

    expect(displayed).toEqual([card(9, 'done')]);
    expect(error).toBeNull();
    expect(onError).not.toHaveBeenCalled();
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it('does not replace a confirmed mutation with an older successful read', async () => {
    const response = deferred<Card[]>();
    let displayed = [card(7)];
    const onData = vi.fn((data: Card[]) => { displayed = data; });
    const reader = createBoardReader({load: () => response.promise, onData, onError: vi.fn()});

    const reading = reader.read();
    reader.invalidate();
    displayed = mergeCardReceipts(displayed, [card(9, 'done')]);
    response.resolve([card(8, 'review')]);
    await reading;

    expect(displayed).toEqual([card(9, 'done')]);
    expect(onData).not.toHaveBeenCalled();
  });

  it('coalesces concurrent refresh signals into a fresh read after the in-flight request', async () => {
    const oldResponse = deferred<Card[]>();
    const freshResponse = deferred<Card[]>();
    const freshStarted = deferred<void>();
    const load = vi.fn()
      .mockImplementationOnce(() => oldResponse.promise)
      .mockImplementationOnce(() => { freshStarted.resolve(undefined); return freshResponse.promise; });
    const onData = vi.fn();
    const onError = vi.fn();
    const reader = createBoardReader<Card[]>({load, onData, onError});

    const oldRead = reader.read();
    await Promise.resolve();
    expect(reader.read()).toBe(oldRead);
    const eventRefresh = reader.refresh();
    const secondEventRefresh = reader.refresh();
    expect(load).toHaveBeenCalledTimes(1);

    oldResponse.resolve([card(7)]);
    await freshStarted.promise;
    expect(load).toHaveBeenCalledTimes(2);
    expect(onData).not.toHaveBeenCalled();
    freshResponse.resolve([card(9)]);
    await Promise.all([oldRead, eventRefresh, secondEventRefresh]);

    expect(onData).toHaveBeenCalledExactlyOnceWith([card(9)]);
    expect(onError).not.toHaveBeenCalled();
  });

  it('keeps another event arriving during the follow-up read and suppresses its stale error', async () => {
    const responses = [deferred<number>(), deferred<number>(), deferred<number>()];
    const starts = [deferred<void>(), deferred<void>(), deferred<void>()];
    let index = 0;
    const load = vi.fn(() => {
      const request = index++;
      starts[request].resolve(undefined);
      return responses[request].promise;
    });
    const onData = vi.fn();
    const onError = vi.fn();
    const reader = createBoardReader({load, onData, onError});
    const initial = reader.read();
    await starts[0].promise;
    const firstEvent = reader.refresh();
    responses[0].resolve(1);
    await starts[1].promise;
    const nextEvent = reader.refresh();
    responses[1].reject(new BoardReadError('Synthetic obsolete ACL response', 403));
    await starts[2].promise;
    responses[2].resolve(3);
    await Promise.all([initial, firstEvent, nextEvent]);

    expect(load).toHaveBeenCalledTimes(3);
    expect(onData).toHaveBeenCalledExactlyOnceWith(3);
    expect(onError).not.toHaveBeenCalled();
  });

  it('still reports a current authorization error and allows a subsequent read', async () => {
    const failure = new BoardReadError('Synthetic current ACL response', 403);
    const onError = vi.fn();
    const onData = vi.fn();
    const onBusy = vi.fn();
    const load = vi.fn()
      .mockImplementationOnce(() => { throw failure; })
      .mockResolvedValueOnce([card(10)]);
    const reader = createBoardReader<Card[]>({load, onData, onError, onBusy});

    await reader.read();
    expect(onError).toHaveBeenCalledExactlyOnceWith(failure);
    await reader.read();

    expect(load).toHaveBeenCalledTimes(2);
    expect(onData).toHaveBeenCalledExactlyOnceWith([card(10)]);
    expect(onBusy.mock.calls).toEqual([[true], [false], [true], [false]]);
  });
});
