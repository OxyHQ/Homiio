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
  migrateLegacyImages,
} from '../../services/files/imageMigration';
import { legacyImageUrl } from '../../services/files/legacyImages';
import { seedLegacyObject } from '../helpers/legacyBucket';
import { OxyCallPacer } from '../../services/files/oxyCallPacer';
import { flushLegacyReads, LEGACY_MEDIA_READ_PAIRS } from '../../services/files/legacyReadCounter';
import { storageRetirementStatus } from '../../services/files/storageStatus';
import { setOxyFilesForTests } from '../../services/files/oxyFilesClient';
import { fakeOxyFiles, oxyError } from '../helpers/fakeOxyFiles';
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
    await seedLegacyObject(keys.keysOriginal, bytes, 'image/jpeg');
    // What Oxy fetches from the legacy door: the bucket's bytes.
    fakeOxyFiles.servedSources.set(legacyImageUrl(keys.keysOriginal), bytes);
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

async function scrapedListing(): Promise<string> {
  return listing({
    isExternal: true,
    source: 'fixture',
    sourceId: `mig-${uuidv7()}`,
    sourceUrl: `https://fixtures.homiio.com/${uuidv7()}`,
  });
}

/** A pacer on a clock that moves only when it sleeps: no test waits a minute. */
function instantPacer(): OxyCallPacer {
  let now = 0;
  return new OxyCallPacer({
    perMinute: 30,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  });
}

/** A Commons search that answers this photo, credited. */
function commonsAnswers(): typeof fetch {
  return jest.fn(async () =>
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
    expect(await readRows()).toEqual([
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
    expect(await readRows()).toEqual([expect.objectContaining({ outcome: 'missing', reads: 2 })]);
  });

  it('writes a zero row for every surface and outcome of the day, with nothing read', async () => {
    const now = new Date('2026-10-21T12:00:00Z');
    await flushLegacyReads(now);
    await flushLegacyReads(now);
    const rows = await getDb().select().from(legacyMediaReads);
    expect(rows).toHaveLength(LEGACY_MEDIA_READ_PAIRS.length);
    for (const [surface, outcome] of LEGACY_MEDIA_READ_PAIRS) {
      expect(rows).toContainEqual(
        expect.objectContaining({ day: '2026-10-21', surface, outcome, reads: 0 }),
      );
    }
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

  it('walks the table once in id windows, deleting the unused rows of every window', async () => {
    const old = new Date(Date.now() - 48 * 3_600_000);
    const shownOn = await listing();
    const created = [];
    for (let i = 0; i < 5; i += 1) {
      created.push(await legacyRow('property', `expired-${i}`, { createdAt: old }));
    }
    // Shown rows between the unused ones: a window never stops at them.
    await showOn(shownOn, created[2].row.id);
    const seen: string[][] = [];

    const deleted = await sweepUnusedImages(getDb(), {
      window: 2,
      onWindow: (ids) => seen.push([...ids]),
    });

    expect(deleted).toBe(4);
    // Three windows of two (the last one partial), and one that finds the end.
    expect(seen.flat().sort()).toEqual(
      [created[0], created[1], created[3], created[4]].map((c) => c.row.id).sort(),
    );
    const left = await getDb().select({ id: images.id }).from(images);
    expect(left.map((row) => row.id)).toEqual([created[2].row.id]);
  });
});

describe('migrateLegacyImage', () => {
  it("imports a scraped listing's photo as Homiio's file through the legacy door, verified, and repoints every copy", async () => {
    const propertyId = await scrapedListing();
    const { row, sha256 } = await legacyRow('property', propertyId);
    await showOn(propertyId, row.id);

    const [candidate] = await findLegacyImages(null, 10);
    expect(candidate.target).toEqual({ kind: 'application', listingId: propertyId });
    const line = await migrateLegacyImage(candidate);

    expect(line).toMatchObject({ outcome: 'migrated', owner: 'application', sha256 });
    expect(JSON.stringify(line)).not.toContain('http');
    // Oxy fetched the bucket's bytes from the legacy door, as Homiio's public
    // file, with the listing's use registered in the same request.
    expect(fakeOxyFiles.callsOf('importAppFiles')).toEqual([
      [
        [
          {
            sourceUrl: legacyImageUrl(row.keysOriginal as string),
            visibility: 'public',
            reference: { entityType: 'property', entityId: propertyId },
          },
        ],
      ],
    ]);
    expect(fakeOxyFiles.callsOf('uploadAppFile')).toEqual([]);
    expect(fakeOxyFiles.hasReference(line.oxyFileId as string, 'property', propertyId)).toBe(true);
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
    const propertyId = await scrapedListing();
    const { row } = await legacyRow('property', propertyId);
    await showOn(propertyId, row.id);
    // What Oxy fetched is not what the bucket holds.
    fakeOxyFiles.servedSources.set(
      legacyImageUrl(row.keysOriginal as string),
      Buffer.from('altered in transit'),
    );

    const [candidate] = await findLegacyImages(null, 10);
    expect((await migrateLegacyImage(candidate)).outcome).toBe('hash_mismatch');
    const [after] = await getDb().select().from(images).where(eq(images.id, row.id));
    expect(after.oxyFileId).toBeNull();
  });

  it("refuses to point a host's row at bytes Oxy says it stored differently", async () => {
    const propertyId = await listing({ oxyUserId: 'host-z' });
    const { row } = await legacyRow('property', propertyId);
    await showOn(propertyId, row.id);
    const api = fakeOxyFiles.api();
    const realUpload = api.uploadUserMedia;
    api.uploadUserMedia = async (...args) => {
      const answer = await realUpload(...args);
      return { ...answer, sha256: '0'.repeat(64) };
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

  it('imports a page of Homiio-owned photos in one metered request, and waits out a 429 instead of failing them', async () => {
    const rows = [];
    for (let i = 0; i < 3; i += 1) {
      const propertyId = await scrapedListing();
      const legacy = await legacyRow('property', propertyId);
      await showOn(propertyId, legacy.row.id);
      rows.push(legacy.row.id);
    }
    // Oxy's per-app budget is spent (the live ingest shares it): twice.
    fakeOxyFiles.batchImportErrors.push(
      Object.assign(oxyError(429, 'RATE_LIMITED'), { details: { retryAfterSeconds: 20 } }),
      Object.assign(oxyError(429, 'RATE_LIMITED'), { details: { retryAfterSeconds: 20 } }),
    );
    const pacer = instantPacer();

    const lines = await migrateLegacyImages(await findLegacyImages(null, 10), { pacer });

    expect(lines.map((line) => line.outcome)).toEqual(['migrated', 'migrated', 'migrated']);
    expect(lines.map((line) => line.imageId)).toEqual(rows);
    expect(pacer.rateLimited).toBe(2);
    // The same batch, sent three times; never split into uploads.
    const calls = fakeOxyFiles.callsOf('importAppFiles');
    expect(calls).toHaveLength(3);
    expect(calls.every(([items]) => (items as unknown[]).length === 3)).toBe(true);
    expect(fakeOxyFiles.callsOf('uploadAppFile')).toEqual([]);
    expect(await countLegacyImages()).toEqual([]);
  });

  it('reports a photo Oxy could not fetch as failed and leaves it for the next run', async () => {
    const propertyId = await scrapedListing();
    const { row } = await legacyRow('property', propertyId);
    await showOn(propertyId, row.id);
    fakeOxyFiles.failingSources.set(legacyImageUrl(row.keysOriginal as string), 502);

    const [candidate] = await findLegacyImages(null, 10);
    expect(await migrateLegacyImage(candidate)).toMatchObject({
      outcome: 'upload_failed',
      error: '502 SOURCE_FETCH_FAILED',
    });
    expect(await findLegacyImages(null, 10)).toHaveLength(1);
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
    (global as { fetch: typeof originalFetch }).fetch = commonsAnswers();

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

  it('keeps a legacy city cover when Commons does not answer, and clears it only when Commons has nothing creditable', async () => {
    const city = await legacyRow('city', chain.cityId);
    await getDb()
      .update(cities)
      .set({ coverImageId: city.row.id })
      .where(eq(cities.id, chain.cityId));

    // Commons is rate-limiting or down: nothing is decided, nothing cleared.
    (global as { fetch: typeof originalFetch }).fetch = jest.fn(
      async () => new Response('slow down', { status: 429 }),
    ) as unknown as typeof fetch;
    const [candidate] = await findLegacyImages(null, 10);
    expect(await migrateLegacyImage(candidate)).toMatchObject({
      outcome: 'cover_failed',
      error: 'commons 429',
    });
    let [cityAfter] = await getDb().select().from(cities).where(eq(cities.id, chain.cityId));
    expect(cityAfter.coverImageId).toBe(city.row.id);

    // Oxy refuses the import (not a rate limit): also kept for the next run.
    (global as { fetch: typeof originalFetch }).fetch = commonsAnswers();
    fakeOxyFiles.failingSources.set('https://upload.wikimedia.org/x/1280px-y.jpg', 502);
    expect((await migrateLegacyImage(candidate)).outcome).toBe('cover_failed');
    [cityAfter] = await getDb().select().from(cities).where(eq(cities.id, chain.cityId));
    expect(cityAfter.coverImageId).toBe(city.row.id);

    // Commons answers every query, with nothing Homiio may credit: cleared.
    (global as { fetch: typeof originalFetch }).fetch = jest.fn(async () =>
      Response.json({ query: { pages: {} } }),
    ) as unknown as typeof fetch;
    expect((await migrateLegacyImage(candidate)).outcome).toBe('cleared_cover');
    [cityAfter] = await getDb().select().from(cities).where(eq(cities.id, chain.cityId));
    expect(cityAfter.coverImageId).toBeNull();
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
    // Counted every day of the soak, with redirects only.
    await countedDays(14);
    await getDb()
      .update(legacyMediaReads)
      .set({ reads: 5 })
      .where(eq(legacyMediaReads.outcome, 'redirected'));
    let status = await storageRetirementStatus(14);
    expect(status.daysCounted).toBe(14);
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

  it('never reads a day nothing counted as a quiet one', async () => {
    // Zero reads everywhere, and counting began long ago — but one soak day
    // has no rows at all (no counter ran), and the gate stays shut.
    await countedDays(20, { skip: 5 });
    let status = await storageRetirementStatus(14);
    expect(status.recentReads.every((row) => row.reads === 0)).toBe(true);
    expect(status.daysCounted).toBe(13);
    expect(status.publicImagesRetirable).toBe(false);

    // A day holding only some of its pairs is not counted either.
    await getDb()
      .insert(legacyMediaReads)
      .values({
        day: sql`(now() at time zone 'utc')::date - 5` as unknown as string,
        surface: 'public_image',
        outcome: 'served',
        reads: 0,
      });
    status = await storageRetirementStatus(14);
    expect(status.daysCounted).toBe(13);
    expect(status.publicImagesRetirable).toBe(false);

    // Today does not count towards the soak: it is not a whole day yet.
    await getDb().delete(legacyMediaReads);
    await countedDays(13);
    await flushLegacyReads();
    status = await storageRetirementStatus(14);
    expect(status.daysCounted).toBe(13);
    expect(status.publicImagesRetirable).toBe(false);
  });
});

/** The rows that counted a read (the counter also writes zeros). */
async function readRows() {
  return (await getDb().select().from(legacyMediaReads)).filter((row) => row.reads > 0);
}

/**
 * Zero rows for every pair of the `days` whole UTC days before today, as a
 * counter running all day writes them — except `skip` days ago.
 */
async function countedDays(days: number, options: { skip?: number } = {}): Promise<void> {
  const rows = [];
  for (let back = 1; back <= days; back += 1) {
    if (back === options.skip) continue;
    for (const [surface, outcome] of LEGACY_MEDIA_READ_PAIRS) {
      rows.push({
        day: sql`(now() at time zone 'utc')::date - ${back}::int` as unknown as string,
        surface,
        outcome,
        reads: 0,
      });
    }
  }
  await getDb().insert(legacyMediaReads).values(rows);
}
