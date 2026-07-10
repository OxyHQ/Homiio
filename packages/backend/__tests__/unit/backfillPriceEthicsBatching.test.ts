import {
  finalBatchToFlush,
  planBackfillBatches,
  readyBatchAfterAppend,
} from '../../scripts/backfillPriceEthicsBatching';

describe('backfillPriceEthicsBatching', () => {
  describe('readyBatchAfterAppend', () => {
    it('returns null for a partial batch below the limit', () => {
      expect(readyBatchAfterAppend(['a', 'b'], 50, 2, Number.MAX_SAFE_INTEGER)).toBeNull();
    });

    it('returns the batch when batch size is reached', () => {
      const batch = Array.from({ length: 50 }, (_, i) => `id-${i}`);
      expect(readyBatchAfterAppend(batch, 50, 50, Number.MAX_SAFE_INTEGER)).toEqual(batch);
    });

    it('returns the batch when the processing limit is reached', () => {
      expect(readyBatchAfterAppend(['a', 'b', 'c'], 50, 30, 30)).toEqual(['a', 'b', 'c']);
    });
  });

  describe('finalBatchToFlush', () => {
    it('returns null for an empty batch', () => {
      expect(finalBatchToFlush([])).toBeNull();
    });

    it('returns a copy of a non-empty trailing batch', () => {
      expect(finalBatchToFlush(['x', 'y'])).toEqual(['x', 'y']);
    });
  });

  describe('planBackfillBatches', () => {
    const ids = Array.from({ length: 120 }, (_, i) => `id-${i}`);

    it('flushes a final partial batch when total listings are below batch size', () => {
      expect(planBackfillBatches(ids.slice(0, 20), 50, Number.MAX_SAFE_INTEGER)).toEqual([
        ids.slice(0, 20),
      ]);
    });

    it('splits full batches and flushes the remainder', () => {
      expect(planBackfillBatches(ids.slice(0, 75), 50, Number.MAX_SAFE_INTEGER)).toEqual([
        ids.slice(0, 50),
        ids.slice(50, 75),
      ]);
    });

    it('stops at the limit and does not emit extra batches', () => {
      expect(planBackfillBatches(ids, 50, 30)).toEqual([ids.slice(0, 30)]);
    });
  });
});
