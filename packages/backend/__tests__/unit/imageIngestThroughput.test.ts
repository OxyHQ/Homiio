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
 */

import { ExternalMediaIngest } from '../../services/ingestion/ExternalMediaIngest';
import { mapWithConcurrency } from '../../utils/concurrency';

/** A stand-in image service that records call order and simulates latency. */
function fakeImageService(options: { delayMs?: number } = {}) {
  const inFlight = { now: 0, peak: 0 };
  const calls: number[] = [];

  return {
    inFlight,
    calls,
    isStorageConfigured: () => true,
    createImageForEntity: async (
      _entityType: string,
      _entityId: string,
      _input: unknown,
      opts: { order?: number; isPrimary?: boolean; caption?: string },
    ) => {
      inFlight.now += 1;
      inFlight.peak = Math.max(inFlight.peak, inFlight.now);
      await new Promise((resolve) => setTimeout(resolve, options.delayMs ?? 20));
      inFlight.now -= 1;
      calls.push(opts.order ?? -1);
      const base = `https://cdn.test/${opts.order}`;
      return {
        id: `image-${opts.order}`,
        // The real `ImageDocument` carries a full variant map; `toPropertyImageRef`
        // reads every key, so a thinner stand-in would fail for the wrong reason.
        urls: {
          original: `${base}-original.jpg`,
          small: `${base}-small.webp`,
          medium: `${base}-medium.webp`,
          large: `${base}-large.webp`,
        },
        isPrimary: opts.isPrimary ?? false,
        order: opts.order ?? 0,
        caption: opts.caption,
      };
    },
  };
}

function remoteImages(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    url: `https://portal.test/photo-${index}.jpg`,
    isPrimary: index === 0,
  }));
}

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

describe('ExternalMediaIngest.ingestForProperty', () => {
  it('ingests a listing’s images concurrently, not one after another', async () => {
    // THE GATE THAT CATCHES A RE-SERIALISATION. 24 images at 40 ms each is
    // 960 ms serially and ~160 ms at six in flight. The budget sits between the
    // two, so restoring the `for` loop turns this red rather than merely slow.
    const imageService = fakeImageService({ delayMs: 40 });
    const ingest = new ExternalMediaIngest({
      imageService: imageService as never,
      fetchImage: async () => ({ buffer: Buffer.from('x'), mimetype: 'image/jpeg' }),
      imageConcurrency: 6,
      maxImages: 30,
    });

    const started = Date.now();
    const refs = await ingest.ingestForProperty('property-1', remoteImages(24));
    const elapsed = Date.now() - started;

    expect(refs).toHaveLength(24);
    expect(imageService.inFlight.peak).toBeGreaterThan(1);
    expect(imageService.inFlight.peak).toBeLessThanOrEqual(6);
    expect(elapsed).toBeLessThan(600);
  });

  it('keeps gallery order and exactly one primary', async () => {
    const imageService = fakeImageService({ delayMs: 5 });
    const ingest = new ExternalMediaIngest({
      imageService: imageService as never,
      // Deliberately uneven latency so a naive implementation reorders.
      fetchImage: async (url: string) => {
        const index = Number(url.match(/photo-(\d+)/)?.[1] ?? 0);
        await new Promise((resolve) => setTimeout(resolve, (10 - index) * 4));
        return { buffer: Buffer.from('x'), mimetype: 'image/jpeg' };
      },
      imageConcurrency: 6,
    });

    const refs = await ingest.ingestForProperty('property-2', remoteImages(8));

    expect(refs.map((ref) => ref.order ?? -1)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(refs.filter((ref) => ref.isPrimary)).toHaveLength(1);
    expect(refs[0].isPrimary).toBe(true);
  });

  it('still loses only the broken photo, never the listing', async () => {
    // Per-image tolerance is why the catch lives INSIDE the task. With it
    // outside, one unreachable photo would reject the batch and cost the whole
    // property — trading a throughput fix for lost inventory.
    const imageService = fakeImageService();
    const ingest = new ExternalMediaIngest({
      imageService: imageService as never,
      fetchImage: async (url: string) => {
        if (url.includes('photo-3')) throw new Error('404 from the portal CDN');
        return { buffer: Buffer.from('x'), mimetype: 'image/jpeg' };
      },
      imageConcurrency: 4,
      logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as never,
    });

    const refs = await ingest.ingestForProperty('property-3', remoteImages(6));

    expect(refs).toHaveLength(5);
    expect(refs.filter((ref) => ref.isPrimary)).toHaveLength(1);
  });

  it('honours the image cap before doing any work', async () => {
    const imageService = fakeImageService();
    const ingest = new ExternalMediaIngest({
      imageService: imageService as never,
      fetchImage: async () => ({ buffer: Buffer.from('x'), mimetype: 'image/jpeg' }),
      maxImages: 3,
      imageConcurrency: 6,
    });

    const refs = await ingest.ingestForProperty('property-4', remoteImages(30));

    expect(refs).toHaveLength(3);
    expect(imageService.calls).toHaveLength(3);
  });
});
