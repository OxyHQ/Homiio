/**
 * Image ingest runs its images together, in order, and tolerates a bad one.
 *
 * External image ingest was strictly serial: one `await` per image, and inside
 * each image one `await` per size variant — up to 30 images × 4 variants = 120
 * sequential fetch → Sharp → S3 round trips for ONE listing.
 *
 * Measured in production on 2026-09-20: **4.6 listings per minute**, median gap
 * between ingests 9.5 s — almost exactly 30 images at ~300 ms each. Madrid
 * alone advertises 8,121 rentals, so the Spanish market was a multi-week
 * import.
 *
 * Three properties have to hold together, and the interesting one is that they
 * pull against each other: going parallel is easy, going parallel WITHOUT
 * reordering the gallery or losing a listing to one dead photo is the work.
 *
 * Since ADR 0041 the downloads are Oxy's (`importAppFiles`, four at a time per
 * batch), so for a listing the property is ONE request rather than thirty —
 * `__tests__/integration/externalMediaIngest.test.ts` asserts that, against
 * Postgres. `mapWithConcurrency` stays tested here, database-free.
 */

import { mapWithConcurrency } from '../../utils/concurrency';

describe('mapWithConcurrency', () => {
  it('preserves order even when later items finish first', async () => {
    // The gallery's cover photo is decided by position. A `push`-as-they-land
    // implementation would pass a "did everything run?" test and silently
    // shuffle every listing's photos.
    const result = await mapWithConcurrency([50, 10, 30, 0], 4, async (delay, index) => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return index;
    });

    expect(result).toEqual([0, 1, 2, 3]);
  });

  it('never exceeds the limit', async () => {
    let now = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 40 }), 5, async () => {
      now += 1;
      peak = Math.max(peak, now);
      await new Promise((resolve) => setTimeout(resolve, 5));
      now -= 1;
    });

    expect(peak).toBeLessThanOrEqual(5);
    expect(peak).toBeGreaterThan(1);
  });

  it('handles an empty list and a nonsense limit without hanging', async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
    expect(await mapWithConcurrency([1, 2], 0, async (n) => n * 2)).toEqual([2, 4]);
    expect(await mapWithConcurrency([1, 2], -3, async (n) => n * 2)).toEqual([2, 4]);
  });
});
