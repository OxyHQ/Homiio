/** Returns a copy of the batch when it should flush mid-stream, otherwise null. */
export function readyBatchAfterAppend(
  batch: readonly string[],
  batchSize: number,
  processed: number,
  limit: number,
): string[] | null {
  if (batch.length >= batchSize || processed >= limit) {
    return [...batch];
  }
  return null;
}

/** Returns the trailing partial batch after the cursor ends, or null when empty. */
export function finalBatchToFlush(batch: readonly string[]): string[] | null {
  if (batch.length === 0) return null;
  return [...batch];
}

/** Pure planner mirroring the cursor loop plus final flush — for unit tests. */
export function planBackfillBatches(
  ids: readonly string[],
  batchSize: number,
  limit: number,
): string[][] {
  const batches: string[][] = [];
  let batch: string[] = [];
  let processed = 0;

  for (const id of ids) {
    if (processed >= limit) break;

    batch.push(id);
    processed += 1;

    const ready = readyBatchAfterAppend(batch, batchSize, processed, limit);
    if (ready) {
      batches.push(ready);
      batch = [];
    }
  }

  const remaining = finalBatchToFlush(batch);
  if (remaining) {
    batches.push(remaining);
  }

  return batches;
}
