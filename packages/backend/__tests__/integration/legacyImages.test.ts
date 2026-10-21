/**
 * The legacy photo door (`GET /api/images/file/*`) after the bucket was
 * retired: an old URL redirects to its Oxy rendition or answers 404, every
 * answer is counted, and the unused-image sweep ends the orphans.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { uuidv7 } from '@oxy.so/db';

import imageController from '../../controllers/imageController';
import { countUnusedImages, sweepUnusedImages } from '../../db/images/unusedImages';
import { getDb } from '../../db/postgres';
import { images, legacyMediaReads, type properties } from '../../db/schema';
import { replacePropertyImages } from '../../db/properties/propertyWrites';
import { errorHandler } from '../../middlewares/errorHandler';
import { flushLegacyReads, LEGACY_MEDIA_READ_PAIRS } from '../../services/files/legacyReadCounter';
import { fakeOxyFiles } from '../helpers/fakeOxyFiles';
import {
  resetGeoTables,
  seedAddress,
  seedGeoChain,
  seedProperty,
  type GeoChain,
} from '../helpers/postgresGeoFixtures';

let chain: GeoChain;

function door(): Express {
  const app = express();
  app.get('/images/file/*', (req, res) => imageController.serveLegacyImage(req, res));
  app.use(errorHandler);
  return app;
}

/**
 * A photo copied out of the bucket: an Oxy file, and the bucket key of its
 * original that old URLs still name.
 */
async function copiedRow(
  entityType: 'property' | 'city' | 'region',
  entityId: string,
  options: { createdAt?: Date; status?: 'active' | 'blocked' } = {},
) {
  const uuid = uuidv7();
  const keysOriginal = `${entityType}/${uuid}-original.jpeg`;
  const fileId = `moved-${uuid}`;
  const [row] = await getDb()
    .insert(images)
    .values({
      entityType,
      entityId,
      keysOriginal,
      oxyFileId: fileId,
      oxyFileOwner: 'application',
      oxyFileStatus: options.status ?? 'active',
      oxyFileVisibility: 'public',
      urlsOriginal: `https://cloud.oxy.test/${fileId}?variant=w2048`,
      urlsSmall: `https://cloud.oxy.test/${fileId}?variant=w320`,
      urlsMedium: `https://cloud.oxy.test/${fileId}?variant=w640`,
      urlsLarge: `https://cloud.oxy.test/${fileId}?variant=w1280`,
      format: 'jpeg',
      bytes: 10,
      ...(options.createdAt ? { createdAt: options.createdAt } : {}),
    })
    .returning();
  return { row, uuid, fileId };
}

async function listing(overrides: Partial<typeof properties.$inferInsert> = {}): Promise<string> {
  const addressId = await seedAddress({ chain, street: `Carrer ${uuidv7()}` });
  return seedProperty({ addressId, overrides });
}

async function showOn(propertyId: string, imageId: string): Promise<void> {
  await replacePropertyImages(propertyId, [{ imageId, isPrimary: true }]);
}

/** The rows that counted a read (the counter also writes zeros). */
async function readRows() {
  return (await getDb().select().from(legacyMediaReads)).filter((row) => row.reads > 0);
}

beforeEach(async () => {
  await resetGeoTables();
  // Counts are buffered per process: write out the previous test's, then clear.
  await flushLegacyReads();
  await getDb().delete(legacyMediaReads);
  fakeOxyFiles.reset();
  chain = await seedGeoChain({ cityName: 'Valladolid' });
});

afterAll(async () => {
  await resetGeoTables();
});

describe('the legacy door', () => {
  it('redirects any rendition of a photo to its Oxy rendition, and counts it', async () => {
    const { row, uuid, fileId } = await copiedRow('property', 'p2');

    const medium = await request(door()).get(`/images/file/property/${uuid}-medium.webp`);
    expect(medium.status).toBe(301);
    expect(medium.headers.location).toBe(`https://cloud.oxy.test/${fileId}?variant=w640`);
    const original = await request(door()).get(`/images/file/${row.keysOriginal}`);
    expect(original.status).toBe(301);
    expect(original.headers.location).toBe(`https://cloud.oxy.test/${fileId}?variant=w2048`);

    await flushLegacyReads();
    expect(await readRows()).toEqual([
      expect.objectContaining({ surface: 'public_image', outcome: 'redirected', reads: 2 }),
    ]);
  });

  it('answers 404 for a photo Oxy no longer serves', async () => {
    const { uuid } = await copiedRow('property', 'p3', { status: 'blocked' });

    expect((await request(door()).get(`/images/file/property/${uuid}-small.webp`)).status).toBe(
      404,
    );
  });

  it('answers 404 for a key no row names — there is no bucket to read it from', async () => {
    const res = await request(door()).get(`/images/file/property/${uuidv7()}-original.jpeg`);
    expect(res.status).toBe(404);
    // Not a rendition the old pipeline wrote: nothing to look up, still a 404.
    expect((await request(door()).get('/images/file/property/not-a-rendition.jpeg')).status).toBe(
      404,
    );

    await flushLegacyReads();
    expect(await readRows()).toEqual([
      expect.objectContaining({ surface: 'public_image', outcome: 'missing', reads: 2 }),
    ]);
  });

  it('still 400s a key it refuses to consider at all', async () => {
    // The refusals stay distinct from absence: a private prefix and a traversal
    // are not "no such image", and collapsing them into 404 would lose the
    // difference between a key the door will not consider and one it does not
    // have.
    expect(
      (await request(door()).get('/images/file/applications/documents/x-original.jpeg')).status,
    ).toBe(400);
    expect((await request(door()).get('/images/file/property/x-original.txt')).status).toBe(400);
  });

  it('adds counts from several flushes into one row per day', async () => {
    await request(door()).get('/images/file/property/not-there-original.jpeg');
    await flushLegacyReads();
    await request(door()).get('/images/file/property/not-there-original.jpeg');
    await flushLegacyReads();
    expect(await readRows()).toEqual([expect.objectContaining({ outcome: 'missing', reads: 2 })]);
  });

  it('writes a zero row for every pair the door can produce, with nothing read', async () => {
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
    // The bucket's own pairs are not written any more.
    expect(rows.some((row) => row.outcome === 'served')).toBe(false);
    expect(rows.some((row) => row.surface === 'private_document')).toBe(false);
  });
});

describe('the unused-image sweep', () => {
  it('deletes only rows nothing has shown for the grace period', async () => {
    const shownOn = await listing();
    const old = new Date(Date.now() - 48 * 3_600_000);
    const shown = await copiedRow('property', shownOn, { createdAt: old });
    await showOn(shownOn, shown.row.id);
    const orphan = await copiedRow('property', 'expired-listing', { createdAt: old });
    const fresh = await copiedRow('property', 'publishing-now');

    expect(await countUnusedImages(getDb())).toEqual([{ entityType: 'property', rows: 1 }]);
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
      created.push(await copiedRow('property', `expired-${i}`, { createdAt: old }));
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
