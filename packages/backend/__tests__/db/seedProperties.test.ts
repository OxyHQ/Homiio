/**
 * `scripts/seedProperties.ts` — the seeder converges, and a repeat is a genuine
 * no-op.
 *
 * ## Why row counts alone are not the test
 *
 * "Run it twice and the row count is unchanged" is the obvious assertion and it
 * is NOT sufficient here, because the implementation this replaced satisfied it
 * while being the exact opposite of idempotent: it `TRUNCATE`d five tables and
 * re-inserted everything, so the counts matched perfectly and every single id —
 * every listing, address, photo — was different afterwards. A count is blind to
 * the distinction the seeder exists to make.
 *
 * So the discriminating assertion is the ID SET, captured after run 1 and
 * compared after run 2. Under truncate-and-reinsert it is disjoint; under a real
 * `(source, source_id)` probe it is identical. Row counts are asserted too,
 * because they are what catches the OTHER failure — a probe that never matches
 * and appends 21 more listings on every run.
 *
 * The third assertion is the image fetcher's call count. `images` has no natural
 * key to conflict on (its id is minted per upload), so a re-run that re-fetched
 * would leave orphaned rows reachable from nothing — invisible to a `properties`
 * count and visible here as a non-zero call count on the second pass.
 *
 * ## What is real and what is stubbed
 *
 * Postgres is real (`connectPostgres`, the worker's own throwaway database), the
 * Sharp pipeline is real, and the repositories are real — a mocked drizzle would
 * accept the statements a probe-less seeder issues and prove nothing. Only the
 * NETWORK is stubbed, with a 1x1 PNG, following `externalIngest.test.ts`: the
 * property under test is what the seeder writes on a repeat, and reaching
 * Unsplash to observe it would be measuring the network.
 */

import path from 'path';
import fs from 'fs/promises';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { closePostgres, connectPostgres, getDb } from '../../db/postgres';
import { cities, images, properties, propertyImages } from '../../db/schema';
import type { ImageBufferInput } from '../../services/imageUploadService';
import { resetGeoTables } from '../helpers/postgresGeoFixtures';
import { SEED_OWNER_OXY_USER_ID, seedProperties } from '../../scripts/seedProperties';

// A 1x1 transparent PNG — a real, Sharp-decodable image with no network fetch.
const ONE_BY_ONE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const LOCAL_IMAGE_STORE_DIR = path.join(__dirname, '..', '..', '.local-image-store');

/**
 * Listings in the seed dataset. An EQUALITY rather than a floor, so adding a
 * listing without updating this fails loudly instead of silently weakening the
 * vacuity guard below.
 */
const SEED_LISTING_COUNT = 21;

const fetchImage = jest.fn(
  async (): Promise<ImageBufferInput> => ({ buffer: ONE_BY_ONE_PNG, mimetype: 'image/png' }),
);

/** The seeded listings' own id set, plus the tables that hang off them. */
interface Snapshot {
  properties: string[];
  addresses: string[];
  images: string[];
  propertyImages: string[];
}

/**
 * Every query here is SCOPED to rows the seeder owns, never a bare `select id
 * from <table>`.
 *
 * The first version counted whole tables and CI caught it: one `images` row
 * left by another file in the same worker made the table 98 rows against 97
 * fetches, and the suite went red for a reason that had nothing to do with the
 * seeder. A global assertion silently makes every other suite in the worker
 * part of this test's fixture — the same fragility that makes
 * `propertyImages.test.ts`'s primary-photo assertion order-dependent. Scoping
 * is what makes this file's result a property of the seeder alone.
 */
async function snapshot(): Promise<Snapshot> {
  const db = getDb();

  const seededProperties = await db
    .select({ id: properties.id, addressId: properties.addressId })
    .from(properties)
    .where(eq(properties.oxyUserId, SEED_OWNER_OXY_USER_ID));
  const propertyIds = seededProperties.map((row) => row.id);
  const addressIds = [...new Set(seededProperties.map((row) => row.addressId))];

  // A seeder run with zero listings must not silently produce empty `inArray`
  // clauses that look like a clean comparison; the caller's vacuity floor
  // asserts the count, and this keeps the queries well-formed meanwhile.
  const propertyPhotos = propertyIds.length
    ? await db
        .select({ id: propertyImages.id })
        .from(propertyImages)
        .where(inArray(propertyImages.propertyId, propertyIds))
    : [];

  // The images this seeder creates are exactly: one per property photo, plus
  // each seeded city's cover. Both are addressed by what points AT them, so a
  // stray row belonging to another suite cannot enter the set.
  const propertyImageRows = propertyIds.length
    ? await db
        .select({ id: images.id })
        .from(images)
        .where(and(eq(images.entityType, 'property'), inArray(images.entityId, propertyIds)))
    : [];
  const cityCovers = await db
    .select({ id: cities.coverImageId })
    .from(cities)
    .where(isNotNull(cities.coverImageId));

  return {
    properties: [...propertyIds].sort(),
    addresses: [...addressIds].sort(),
    images: [
      ...propertyImageRows.map((row) => row.id),
      ...cityCovers.flatMap((row) => (row.id === null ? [] : [row.id])),
    ].sort(),
    propertyImages: propertyPhotos.map((row) => row.id).sort(),
  };
}

beforeAll(async () => {
  await connectPostgres();
  // Clean on the way IN as well as out. This suite seeds the whole Spain geo
  // hierarchy, so it must not inherit a half-populated one from an earlier file
  // in the same worker.
  await resetGeoTables();
});

afterAll(async () => {
  // Leave the worker database exactly as this suite found it, through the SAME
  // helper every other file uses rather than a hand-rolled truncate.
  //
  // This is not tidiness — it was measured. The first version truncated only
  // `properties`/`property_images`/`addresses`/`images` and left the geo
  // hierarchy `seedGeo` had written, which turned five UNRELATED suites red
  // (`geoBackfill`, `geoQueryResolution`, `roommateDiscovery`, `roomOwnership`,
  // `cityPropertiesPagination`) while this file passed in isolation. A
  // `truncate ... cascade` on `cities` does not reach `regions`/`countries`,
  // which is exactly the leftover that broke them. `resetGeoTables` deletes in
  // FK order and covers all three.
  await resetGeoTables();
  await fs.rm(LOCAL_IMAGE_STORE_DIR, { recursive: true, force: true });
  await closePostgres();
});

describe('seedProperties is idempotent', () => {
  it('creates on the first run and changes nothing on the second', async () => {
    // Run 1 — from a known-empty state, which is what `fresh` is for.
    const first = await seedProperties({ fresh: true, fetchImage });
    const afterFirst = await snapshot();

    // Vacuity floor. Every assertion below is satisfied by a seeder that did
    // NOTHING at all — two empty snapshots are trivially equal and zero fetches
    // is trivially zero fetches. These four pin that run 1 really seeded.
    expect(first).toEqual({ created: SEED_LISTING_COUNT, unchanged: 0 });
    expect(afterFirst.properties).toHaveLength(SEED_LISTING_COUNT);
    expect(afterFirst.images.length).toBeGreaterThan(90);
    // One stored `images` row per fetch — the invariant that makes the
    // "no fetches on run 2" assertion below mean "no new image rows".
    expect(afterFirst.images).toHaveLength(fetchImage.mock.calls.length);

    fetchImage.mockClear();

    // Run 2 — the same invocation a developer repeats, WITHOUT `fresh`.
    const second = await seedProperties({ fetchImage });
    const afterSecond = await snapshot();

    // Nothing was created, and every listing was recognised.
    expect(second).toEqual({ created: 0, unchanged: SEED_LISTING_COUNT });

    // THE assertion: identical id sets, not merely identical counts. This is
    // what tells a no-op from a truncate-and-reinsert rewrite.
    expect(afterSecond).toEqual(afterFirst);

    // And a genuine no-op reaches for no bytes at all — so no orphaned `images`
    // row can accumulate behind the `cities.cover_image_id` / `property_images`
    // pointers.
    expect(fetchImage).not.toHaveBeenCalled();
  }, 300_000);
});
