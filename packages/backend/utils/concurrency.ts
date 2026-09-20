/**
 * Bounded-parallel `map`, for work that is independent but not free.
 *
 * WHY THIS EXISTS. External image ingest ran strictly serially: one `await` per
 * image, and inside each image one `await` per size variant. A listing carries
 * up to 30 images and every image is re-hosted into four variants, so a single
 * property cost **120 sequential fetch → Sharp → S3 round trips**.
 *
 * Measured in production on 2026-09-20: **4.6 listings per minute**, with a
 * median gap of 9.5 seconds between ingests — almost exactly 30 images at
 * ~300 ms each. At that rate Madrid's 8,121 rentals take thirty hours and the
 * Spanish market takes weeks.
 *
 * Nothing about the work required that order. The images of one listing do not
 * depend on each other, and `isPrimary` / `order` are derived from the index
 * rather than from insertion sequence, so parallelising them changes the clock
 * and nothing else.
 *
 * **BOUNDED, not `Promise.all`.** Unbounded would fan 30 concurrent Sharp
 * pipelines and 120 S3 PUTs out of one job, times the fetch-worker count —
 * enough to exhaust sockets and thrash libvips' thread pool, turning a
 * throughput fix into an availability problem. A small limit captures nearly
 * all of the win.
 */

/**
 * Run `task` over `items` with at most `limit` in flight, **preserving order**.
 *
 * Order matters here: image position decides which photo is the cover. Results
 * are written into their own slot rather than pushed as they land, so the
 * output is a faithful `map` regardless of which task finishes first.
 *
 * A rejecting task rejects the whole call, exactly like `Promise.all` — callers
 * that want per-item tolerance catch inside `task`, which is what the image
 * ingest does so one bad photo never loses a listing.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];

  const effectiveLimit = Math.max(1, Math.min(Math.trunc(limit) || 1, items.length));
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await task(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: effectiveLimit }, () => worker()));
  return results;
}
