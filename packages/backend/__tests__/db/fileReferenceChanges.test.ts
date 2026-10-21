/**
 * The triggers of migration `0037_oxy_files` — every change that can move
 * whether Homiio uses an Oxy file marks the (file, entity) pair for the drain,
 * in the transaction of the change.
 *
 * Each case asserts the MARK, not the outcome (the drain decides add or
 * remove from the present state; `referenceSync.test.ts` covers that). The
 * case that matters most is the cascade: the expiry sweep deletes listings in
 * bulk and their photo rows go with them through `ON DELETE CASCADE`, with no
 * application code running — the way ~950 photo rows were stranded before.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { CHECK_VIOLATION, constraintNameOf, sqlStateOf, uuidv7 } from '@oxy.so/db';

import { getDb } from '../../db/postgres';
import {
  cities,
  evictionCases,
  fileReferenceChanges,
  images,
  properties,
  propertyImages,
  regions,
} from '../../db/schema';
import { replacePropertyImages } from '../../db/properties/propertyWrites';
import { insertOxyImage } from '../../services/files/publicImages';
import {
  resetGeoTables,
  seedAddress,
  seedCityImage,
  seedGeoChain,
  seedProperty,
  type GeoChain,
} from '../helpers/postgresGeoFixtures';

let chain: GeoChain;

async function listing(): Promise<string> {
  const addressId = await seedAddress({ chain, street: `Carrer ${uuidv7()}` });
  return seedProperty({ addressId });
}

/** An `images` row backed by an Oxy file. */
async function oxyImage(
  entityType: 'property' | 'city' | 'region' | 'eviction_case',
  entityId: string,
  fileId: string,
) {
  return insertOxyImage(entityType, entityId, {
    fileId,
    owner: 'application',
    format: 'jpeg',
    bytes: 10,
    sha256: 'a'.repeat(64),
  });
}

/** The marks for some file ids, as `type:entity:file|generation`. */
async function marks(fileIds: string[]): Promise<Map<string, number>> {
  const rows = await getDb()
    .select({ id: fileReferenceChanges.id, generation: fileReferenceChanges.generation })
    .from(fileReferenceChanges)
    .where(inArray(fileReferenceChanges.oxyFileId, fileIds));
  return new Map(rows.map((row) => [row.id, row.generation]));
}

async function clearMarks(): Promise<void> {
  await getDb().delete(fileReferenceChanges);
}

beforeEach(async () => {
  await resetGeoTables();
  chain = await seedGeoChain({ cityName: `Triggerville ${uuidv7().slice(-6)}` });
});

afterAll(async () => {
  await resetGeoTables();
});

describe('property_images', () => {
  it("marks the listing's pair when a photo is attached and when it is replaced", async () => {
    const propertyId = await listing();
    const first = await oxyImage('property', propertyId, 'file-a');
    await replacePropertyImages(propertyId, [{ imageId: first.id, isPrimary: true }]);

    expect((await marks(['file-a'])).get(`property:${propertyId}:file-a`)).toBe(1);

    // A replace deletes every row and inserts them again: one pair, marked again.
    const second = await oxyImage('property', propertyId, 'file-b');
    await replacePropertyImages(propertyId, [{ imageId: second.id, isPrimary: true }]);

    const after = await marks(['file-a', 'file-b']);
    expect(after.get(`property:${propertyId}:file-a`)).toBeGreaterThan(1);
    expect(after.get(`property:${propertyId}:file-b`)).toBe(1);
  });

  it("marks the pair when the expiry sweep's CASCADE removes the photo rows", async () => {
    const propertyId = await listing();
    const photo = await oxyImage('property', propertyId, 'file-cascade');
    await replacePropertyImages(propertyId, [{ imageId: photo.id }]);
    await clearMarks();

    // What the expiry sweep does: delete the listing. No application code runs
    // for its photo rows.
    await getDb().delete(properties).where(eq(properties.id, propertyId));

    expect((await marks(['file-cascade'])).has(`property:${propertyId}:file-cascade`)).toBe(true);
  });

  it('refuses a photo row with no Oxy file (the bucket is retired; there is no other home)', async () => {
    const propertyId = await listing();
    const error = await getDb()
      .insert(images)
      .values({
        entityType: 'property',
        entityId: propertyId,
        keysOriginal: 'p/o.jpeg',
        urlsOriginal: 'u',
        urlsSmall: 'u',
        urlsMedium: 'u',
        urlsLarge: 'u',
        format: 'jpeg',
        bytes: 1,
      })
      .then(
        () => undefined,
        (rejected: unknown) => rejected,
      );

    expect(sqlStateOf(error)).toBe(CHECK_VIOLATION);
    expect(constraintNameOf(error)).toBe('images_storage_check');

    const all = await getDb().select().from(fileReferenceChanges);
    expect(all).toEqual([]);
  });
});

describe('covers', () => {
  it("marks a city's old and new cover when the pointer moves", async () => {
    const old = await oxyImage('city', chain.cityId, 'cover-old');
    await getDb().update(cities).set({ coverImageId: old.id }).where(eq(cities.id, chain.cityId));
    const next = await oxyImage('city', chain.cityId, 'cover-new');
    await getDb().update(cities).set({ coverImageId: next.id }).where(eq(cities.id, chain.cityId));

    const found = await marks(['cover-old', 'cover-new']);
    expect(found.get(`city:${chain.cityId}:cover-old`)).toBe(2);
    expect(found.get(`city:${chain.cityId}:cover-new`)).toBe(1);
  });

  it('marks a region cover', async () => {
    const cover = await oxyImage('region', chain.regionId, 'region-cover');
    await getDb()
      .update(regions)
      .set({ coverImageId: cover.id })
      .where(eq(regions.id, chain.regionId));

    expect((await marks(['region-cover'])).has(`region:${chain.regionId}:region-cover`)).toBe(true);
  });

  it('marks an eviction case cover, and its removal with the case', async () => {
    const caseId = uuidv7();
    const cover = await oxyImage('eviction_case', caseId, 'case-cover');
    await getDb()
      .insert(evictionCases)
      .values({
        id: caseId,
        oxyUserId: 'organiser-1',
        title: 'Desahucio',
        description: 'Concentración.',
        locationLabel: 'Somewhere',
        locationLongitude: 2.17,
        locationLatitude: 41.38,
        scheduledAt: new Date('2030-01-01T09:00:00Z'),
        coverImageId: cover.id,
      });
    expect((await marks(['case-cover'])).get(`eviction_case:${caseId}:case-cover`)).toBe(1);

    await getDb().delete(evictionCases).where(eq(evictionCases.id, caseId));
    expect((await marks(['case-cover'])).get(`eviction_case:${caseId}:case-cover`)).toBe(2);
  });

  it("marks the cover's pair when the images row is deleted under it (SET NULL)", async () => {
    const cover = await oxyImage('city', chain.cityId, 'cover-deleted');
    await getDb().update(cities).set({ coverImageId: cover.id }).where(eq(cities.id, chain.cityId));
    await clearMarks();

    await getDb().delete(images).where(eq(images.id, cover.id));

    expect((await marks(['cover-deleted'])).has(`city:${chain.cityId}:cover-deleted`)).toBe(true);
  });
});

describe('images', () => {
  it('marks every use of a row when its Oxy file changes', async () => {
    const propertyId = await listing();
    const cover = await seedCityImage(chain.cityId);
    await getDb().update(cities).set({ coverImageId: cover }).where(eq(cities.id, chain.cityId));
    await getDb().insert(propertyImages).values({ propertyId, imageId: cover });

    await getDb()
      .update(images)
      .set({
        oxyFileId: 'migrated-file',
        oxyFileOwner: 'application',
        oxyFileStatus: 'active',
        oxyFileVisibility: 'public',
      })
      .where(eq(images.id, cover));

    const found = await marks(['migrated-file']);
    expect(found.has(`city:${chain.cityId}:migrated-file`)).toBe(true);
    expect(found.has(`property:${propertyId}:migrated-file`)).toBe(true);
  });

  it('re-opens a settled pair and makes it available now', async () => {
    const propertyId = await listing();
    const photo = await oxyImage('property', propertyId, 'file-settled');
    await replacePropertyImages(propertyId, [{ imageId: photo.id }]);
    const id = `property:${propertyId}:file-settled`;
    await getDb()
      .update(fileReferenceChanges)
      .set({ settledAt: new Date(), availableAt: new Date(Date.now() + 3_600_000) })
      .where(eq(fileReferenceChanges.id, id));

    await replacePropertyImages(propertyId, []);

    const [row] = await getDb()
      .select()
      .from(fileReferenceChanges)
      .where(and(eq(fileReferenceChanges.id, id)));
    expect(row.settledAt).toBeNull();
    expect(row.availableAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });
});
