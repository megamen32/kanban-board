import type { KanbanCard } from '@/lib/kanban/types';

/** Receipts can arrive out of order; a stored newer version always wins. */
export function mergeCardReceipts<T extends Pick<KanbanCard, 'id' | 'version'>>(
  current: readonly T[],
  receipts: readonly T[],
  appendMissing = false,
): T[] {
  const latest = new Map<string, T>();
  for (const receipt of receipts) {
    const previous = latest.get(receipt.id);
    if (!previous || receipt.version > previous.version) latest.set(receipt.id, receipt);
  }

  const merged = current.map(card => {
    const receipt = latest.get(card.id);
    latest.delete(card.id);
    return receipt && receipt.version > card.version ? receipt : card;
  });
  // Updates and reorders must not resurrect cards absent from the current board.
  if (appendMissing) merged.push(...latest.values());
  return merged;
}

export interface BoardReader {
  read(): Promise<void>;
  refresh(): Promise<void>;
  invalidate(): void;
}

interface BoardReaderOptions<T> {
  load(): Promise<T>;
  onData(data: T): void;
  onError(error: unknown): void;
  onBusy?(busy: boolean): void;
  onSettled?(): void;
}

/** Serialize reads and discard both data and errors from an obsolete epoch. */
export function createBoardReader<T>(options: BoardReaderOptions<T>): BoardReader {
  let epoch = 0;
  let inFlight: Promise<void> | null = null;

  const invalidate = () => { epoch++; };
  const read = (): Promise<void> => {
    if (inFlight) return inFlight;
    const startedAt = epoch;
    options.onBusy?.(true);
    // Defer load so even a synchronous throw settles after inFlight is assigned.
    const pending = Promise.resolve().then(options.load).then(
      data => { if (startedAt === epoch) options.onData(data); },
      failure => { if (startedAt === epoch) options.onError(failure); },
    ).finally(() => {
      inFlight = null;
      options.onBusy?.(false);
      options.onSettled?.();
    });
    inFlight = pending;
    return pending;
  };

  const refresh = async (): Promise<void> => {
    invalidate();
    // A signal during a read needs another read, not the old promise alone.
    if (inFlight) await inFlight;
    return read();
  };

  return {read, refresh, invalidate};
}
