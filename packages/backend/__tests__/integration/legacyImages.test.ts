/**
 * The way out of Homiio's own bucket, end to end: the legacy door
 * (`GET /api/images/file/*`), the unused-image sweep that ends the orphans,
 * the migration that copies shown photos into Oxy Files, and the gate that
 * says when the bucket may go.
 */

import { createHash } from 'node:crypto';

import express, { type Express } from 'express';
import request from 'supertest';
import { eq, sql } from 'drizzle-orm';
import { uuidv7 } from '@oxy.so/db';

import imageController from '../../controllers/imageController';
import { countUnusedImages, sweepUnusedImages } from '../../db/images/unusedImages';
import { getDb } from '../../db/postgres';
import {
  cities,
  fileReferenceChanges,
  images,
  legacyMediaReads,
  properties,
  propertyImages,
  regions,
} from '../../db/schema';
import { replacePropertyImages } from '../../db/properties/propertyWrites';
import { errorHandler } from '../../middlewares/errorHandler';
import {
  countLegacyImages,
  detachMissingImage,
  findLegacyImages,
  migrateLegacyImage,
} from '../../services/files/imageMigration';
import { legacyObjectStore } from '../../services/files/legacyObjectStore';
import { flushLegacyReads } from '../../services/files/legacyReadCounter';
import { storageRetirementStatus } from '../../services/files/storageStatus';
import { setOxyFilesForTests } from '../../services/files/oxyFilesClient';
import { fakeOxyFiles } from '../helpers/fakeOxyFiles';
import {
  resetGeoTables,
  seedAddress,
  seedGeoChain,
  seedProperty,
  type GeoChain,
} from '../helpers/postgresGeoFixtures';

const originalFetch = global.fetch;
let chain: GeoChain;

function door(): Express {
  const app = express();
  app.get('/images/file/*', (req, res) => imageController.serveLegacyImage(req, res));
  app.use(errorHandler);
  return app;
}

/** A legacy row, its original object in the store (unless `missing`). */
async function legacyRow(
  entityType: 'property' | 'city' | 'region',
  entityId: string,
  options: { missing?: boolean; createdAt?: Date } = {},
) {
  const uuid = uuidv7();
  const keys = {
    keysOriginal: `${entityType}/${uuid}-original.jpeg`,
    keysSmall: `${entityType}/${uuid}-small.webp`,
    keysMedium: `${entityType}/${uuid}-medium.webp`,
    keysLarge: `${entityType}/${uuid}-large.webp`,
  };
  const bytes = Buffer.from(`legacy-original-${uuid}`);
  if (!options.missing) {
    await legacyObjectStore().putPrivate(keys.keysOriginal, bytes, 'image/jpeg');
  }
  const [row] = await getDb()
    .insert(images)
    .values({
      entityType,
      entityId,
      ...keys,
      urlsOriginal: `https://api.homiio.test/api/images/file/${keys.keysOriginal}`,
      urlsSmall: `https://api.homiio.test/api/images/file/${keys.keysSmall}`,
      urlsMedium: `https://api.homiio.test/api/images/file/${keys.keysMedium}`,
      urlsLarge: `https://api.homiio.test/api/images/file/${keys.keysLarge}`,
      format: 'jpeg',
      bytes: bytes.length,
      ...(options.createdAt ? { createdAt: options.createdAt } : {}),
    })
    .returning();
  return { row, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

async function listing(overrides: Partial<typeof properties.$inferInsert> = {}): Promise<string> {
  const addressId = await seedAddress({ chain, street: `Carrer ${uuidv7()}` });
  return seedProperty({ addressId, overrides });
}

async function showOn(propertyId: string, imageId: string): Promise<void> {
  await replacePropertyImages(propertyId, [{ imageId, isPrimary: true }]);
}

beforeEach(async () => {
  await resetGeoTables();
  // Counts are buffered per process: write out the previous test's, then clear.
  await flushLegacyReads();
  await getDb().delete(legacyMediaReads);
  fakeOxyFiles.reset();
  // A plausible city name: the cover sync skips implausible ones.
  chain = await seedGeoChain({ cityName: 'Valladolid' });
});

afterEach(() => {
  (global as { fetch: typeof originalFetch }).fetch = originalFetch;
});

afterAll(async () => {
  await resetGeoTables();
});

describe('the legacy door', () => {
  it('serves an unmigrated photo from the bucket, and counts it', async () => {
    const { row, bytes } = await legacyRow('property', 'p1');
    const res = await request(door()).get(`/images/file/${row.keysOriginal}`);
    expect(res.status).toBe(200);
    expect(Buffer.from(res.body as Buffer).equals(bytes)).toBe(true);

    await flushLegacyReads();
    const reads = await getDb().select().from(legacyMediaReads);
    expect(reads).toEqual([
      expect.objectContaining({ surface: 'public_image', outcome: 'served', reads: 1 }),
    ]);
  });

  it('redirects any rendition of a migrated photo to its Oxy rendition', async () => {
    const { row } = await legacyRow('property', 'p2');
    await getDb()
      .update(images)
      .set({
        oxyFileId: 'moved-1',
        oxyFileOwner: 'application',
        oxyFileStatus: 'active',
        oxyFileVisibility: 'public',
      })
      .where(eq(images.id, row.id));

    const res = await request(door()).get(`/images/file/${row.keysMedium}`);
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe('https://cloud.oxy.test/moved-1?variant=w640');
  });

  it('answers 404 for a migrated photo Oxy no longer serves', async () => {
    const { row } = await legacyRow('property', 'p3');
    await getDb()
      .update(images)
      .set({
        oxyFileId: 'moved-2',
        oxyFileOwner: 'application',
        oxyFileStatus: 'blocked',
        oxyFileVisibility: 'public',
      })
      .where(eq(images.id, row.id));

    expect((await request(door()).get(`/images/file/${row.keysSmall}`)).status).toBe(404);
  });

  it('adds counts from several flushes into one row per day', async () => {
    await request(door()).get('/images/file/property/not-there-original.jpeg');
    await flushLegacyReads();
    await request(door()).get('/images/file/property/not-there-original.jpeg');
    await flushLegacyReads();
    const reads = await getDb().select().from(legacyMediaReads);
    expect(reads).toEqual([expect.objectContaining({ outcome: 'missing', reads: 2 })]);
  });
});

describe('the unused-image sweep', () => {
  it('deletes only rows nothing has shown for the grace period', async () => {
    const shownOn = await listing();
    const old = new Date(Date.now() - 48 * 3_600_000);
    const shown = await legacyRow('property', shownOn, { createdAt: old });
    await showOn(shownOn, shown.row.id);
    const orphan = await legacyRow('property', 'expired-listing', { createdAt: old });
    const fresh = await legacyRow('property', 'publishing-now');

    expect(await countUnusedImages(getDb())).toEqual([
      { entityType: 'property', storage: 'legacy', rows: 1 },
    ]);
    expect(await sweepUnusedImages(getDb())).toBe(1);

    const left = await getDb().select({ id: images.id }).from(images);
    const ids = left.map((row) => row.id);
    expect(ids).toContain(shown.row.id);
    expect(ids).toContain(fresh.row.id);
    expect(ids).not.toContain(orphan.row.id);
  });
});

describe('migrateLegacyImage', () => {
  it("copies a scraped listing's photo as Homiio's file, verified, and repoints every copy", async () => {
    const propertyId = await listing({
      isExternal: true,
      source: 'fixture',
      sourceId: `mig-${uuidv7()}`,
      sourceUrl: 'https://fixtures.homiio.com/x',
    });
    const { row, sha256 } = await legacyRow('property', propertyId);
    await showOn(propertyId, row.id);

    const [candidate] = await findLegacyImages(null, 10);
    expect(candidate.target).toEqual({ kind: 'application' });
    const line = await migrateLegacyImage(candidate);

    expect(line).toMatchObject({ outcome: 'migrated', owner: 'application', sha256 });
    expect(JSON.stringify(line)).not.toContain('http');
    const [after] = await getDb().select().from(images).where(eq(images.id, row.id));
    expect(after.oxyFileId).toBe(line.oxyFileId);
    expect(after.urlsMedium).toBe(`https://cloud.oxy.test/${line.oxyFileId}?variant=w640`);
    const [photo] = await getDb()
      .select()
      .from(propertyImages)
      .where(eq(propertyImages.imageId, row.id));
    expect(photo.url).toBe(after.urlsMedium);
    // The trigger marked the listing's use for the drain.
    const marks = await getDb()
      .select()
      .from(fileReferenceChanges)
      .where(eq(fileReferenceChanges.oxyFileId, line.oxyFileId as string));
    expect(marks.map((mark) => mark.entityId)).toEqual([propertyId]);

    // Resumable: nothing is selected again.
    expect(await findLegacyImages(null, 10)).toEqual([]);
  });

  it("copies a host's photo into the host's account, or Homiio's when the account is gone", async () => {
    const mine = await listing({ oxyUserId: 'host-alive' });
    const orphaned = await listing({ oxyUserId: 'host-deleted' });
    fakeOxyFiles.refusedUsers.add('host-deleted');
    const a = await legacyRow('property', mine);
    const b = await legacyRow('property', orphaned);
    await showOn(mine, a.row.id);
    await showOn(orphaned, b.row.id);

    const lines = [];
    for (const candidate of await findLegacyImages(null, 10)) {
      lines.push(await migrateLegacyImage(candidate));
    }
    const byId = new Map(lines.map((line) => [line.imageId, line]));
    expect(byId.get(a.row.id)).toMatchObject({ outcome: 'migrated', owner: 'account' });
    expect(fakeOxyFiles.files.get(byId.get(a.row.id)?.oxyFileId as string)?.ownerUserId).toBe(
      'host-alive',
    );
    expect(byId.get(b.row.id)).toMatchObject({ outcome: 'owner_fallback', owner: 'application' });
  });

  it('reports a missing object, and --detach-missing takes it off the listing', async () => {
    const propertyId = await listing({ oxyUserId: 'host-x' });
    const { row } = await legacyRow('property', propertyId, { missing: true });
    await showOn(propertyId, row.id);

    const [candidate] = await findLegacyImages(null, 10);
    expect((await migrateLegacyImage(candidate)).outcome).toBe('missing_object');

    await detachMissingImage(row.id);
    const [listingRow] = await getDb()
      .select()
      .from(properties)
      .where(eq(properties.id, propertyId));
    expect(listingRow.hasImages).toBe(false);
    expect(await countLegacyImages()).toEqual([]);
  });

  it('refuses to point a row at bytes Oxy says differ', async () => {
    const propertyId = await listing({
      isExternal: true,
      source: 'fixture',
      sourceId: `mig-${uuidv7()}`,
      sourceUrl: 'https://fixtures.homiio.com/y',
    });
    const { row } = await legacyRow('property', propertyId);
    await showOn(propertyId, row.id);
    const api = fakeOxyFiles.api();
    const realUpload = api.uploadAppFile;
    api.uploadAppFile = async (...args) => {
      const answer = await realUpload(...args);
      return { ...answer, file: { ...answer.file, sha256: '0'.repeat(64) } };
    };
    setOxyFilesForTests(api);
    try {
      const [candidate] = await findLegacyImages(null, 10);
      expect((await migrateLegacyImage(candidate)).outcome).toBe('hash_mismatch');
    } finally {
      setOxyFilesForTests(fakeOxyFiles.api());
    }
    const [after] = await getDb().select().from(images).where(eq(images.id, row.id));
    expect(after.oxyFileId).toBeNull();
  });

  it('re-sources a legacy city cover with credit, and clears a region cover it cannot source', async () => {
    const city = await legacyRow('city', chain.cityId);
    await getDb()
      .update(cities)
      .set({ coverImageId: city.row.id })
      .where(eq(cities.id, chain.cityId));
    const region = await legacyRow('region', chain.regionId);
    await getDb()
      .update(regions)
      .set({ coverImageId: region.row.id })
      .where(eq(regions.id, chain.regionId));
    (global as { fetch: typeof originalFetch }).fetch = jest.fn(async () =>
      Response.json({
        query: {
          pages: {
            '1': {
              imageinfo: [
                {
                  thumburl: 'https://upload.wikimedia.org/x/1280px-y.jpg',
                  mime: 'image/jpeg',
                  descriptionurl: 'https://commons.wikimedia.org/wiki/File:Y.jpg',
                  extmetadata: { LicenseShortName: { value: 'CC BY 4.0' } },
                },
              ],
            },
          },
        },
      }),
    ) as unknown as typeof fetch;

    for (const candidate of await findLegacyImages(null, 10)) {
      await migrateLegacyImage(candidate);
    }

    const [cityAfter] = await getDb().select().from(cities).where(eq(cities.id, chain.cityId));
    const [cover] = await getDb()
      .select()
      .from(images)
      .where(eq(images.id, cityAfter.coverImageId as string));
    expect(cover.oxyFileId).toBeTruthy();
    expect(cover.attributionLicense).toBe('CC BY 4.0');
    const [regionAfter] = await getDb()
      .select()
      .from(regions)
      .where(eq(regions.id, chain.regionId));
    expect(regionAfter.coverImageId).toBeNull();
    expect(await countLegacyImages()).toEqual([]);
  });
});

describe('storageRetirementStatus', () => {
  it('opens the public gate only with nothing left, zero served reads, and a soak of counting', async () => {
    const propertyId = await listing({
      isExternal: true,
      source: 'fixture',
      sourceId: `mig-${uuidv7()}`,
      sourceUrl: 'https://fixtures.homiio.com/z',
    });
    const { row } = await legacyRow('property', propertyId);
    await showOn(propertyId, row.id);

    expect((await storageRetirementStatus(14)).publicImagesRetirable).toBe(false);

    const [candidate] = await findLegacyImages(null, 10);
    await migrateLegacyImage(candidate);
    // Counting began 20 days ago with redirects only.
    await getDb()
      .insert(legacyMediaReads)
      .values({
        day: sql`current_date - 20` as unknown as string,
        surface: 'public_image',
        outcome: 'redirected',
        reads: 5,
      });
    let status = await storageRetirementStatus(14);
    expect(status.publicImagesRetirable).toBe(true);

    // One byte served from the bucket inside the soak closes it again.
    await getDb()
      .insert(legacyMediaReads)
      .values({
        day: sql`current_date` as unknown as string,
        surface: 'public_image',
        outcome: 'served',
        reads: 1,
      });
    status = await storageRetirementStatus(14);
    expect(status.publicImagesRetirable).toBe(false);
  });
});
