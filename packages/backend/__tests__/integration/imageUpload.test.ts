/**
 * A person's photo, from upload to what a listing or a case shows — against
 * Postgres and the suite's in-memory Oxy Files.
 *
 * - `POST /api/images/upload` stores the photo in the UPLOADER's Oxy account,
 *   stripped of EXIF, and writes nothing to Homiio's storage; the answer keeps
 *   the shape app builds already read.
 * - Publishing names the photo by its Oxy file id, and the file must be the
 *   publisher's own (Oxy is asked): a stranger's photo is refused.
 * - An eviction case's cover is resolved the same way, and no longer trusts a
 *   client URL or a storage-key segment as a row id.
 */

import express, { type Express } from 'express';
import multer from 'multer';
import request from 'supertest';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { OfferingType, PropertyType } from '@homiio/shared-types';

import * as eviction from '../../controllers/eviction';
import imageController from '../../controllers/imageController';
import { createProperty } from '../../controllers/property/create';
import { getDb } from '../../db/postgres';
import { evictionCases, images } from '../../db/schema';
import { findPropertyById } from '../../db/properties/propertyReads';
import { errorHandler } from '../../middlewares/errorHandler';
import { serializeWireIds } from '../../middlewares/wireIds';
import { createAddress } from '../helpers/factories';
import { setOxyFilesForTests } from '../../services/files/oxyFilesClient';
import { fakeOxyFiles, oxyError } from '../helpers/fakeOxyFiles';
import { assertFound } from '../helpers/assertFound';

const HOST = 'oxy-host-1';
const STRANGER = 'oxy-stranger-1';

const upload = multer({ storage: multer.memoryStorage(), limits: { files: 10 } });

function buildApp(oxyUserId: string): Express {
  const app = express();
  app.use(express.json());
  app.use(serializeWireIds);
  app.use((req, _res, next) => {
    const authed = req as unknown as { user: { id: string }; userId: string };
    authed.user = { id: oxyUserId };
    authed.userId = oxyUserId;
    next();
  });
  app.post('/images/upload', upload.single('image'), imageController.uploadImage);
  app.post(
    '/images/upload-multiple',
    upload.array('images', 10),
    imageController.uploadMultipleImages,
  );
  app.delete('/images/:imageKey', imageController.forgetUpload);
  app.post('/properties', createProperty);
  app.post('/evictions', (req, res, next) => eviction.createEviction(req, res, next));
  app.put('/evictions/:id', (req, res, next) => eviction.updateEviction(req, res, next));
  app.use(errorHandler);
  return app;
}

/** A JPEG carrying a GPS tag, the way a phone writes one. */
async function photoWithLocation(background = '#88aacc'): Promise<Buffer> {
  return sharp({ create: { width: 32, height: 24, channels: 3, background } })
    .withExif({
      IFD0: { Make: 'Homiio Test' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '41/1 23/1 5/1' },
    })
    .jpeg()
    .toBuffer();
}

async function uploadAs(
  oxyUserId: string,
  background?: string,
): Promise<{ fileId: string; body: Record<string, unknown> }> {
  const res = await request(buildApp(oxyUserId))
    .post('/images/upload')
    .field('folder', '../../../../tmp')
    .attach('image', await photoWithLocation(background), {
      filename: 'p.jpg',
      contentType: 'image/jpeg',
    });
  expect(res.status).toBe(200);
  return { fileId: res.body.data.fileId as string, body: res.body.data as Record<string, unknown> };
}

async function listingBody(images: unknown[]) {
  const address = await createAddress();
  return {
    type: PropertyType.APARTMENT,
    bedrooms: 2,
    bathrooms: 1,
    offerings: [OfferingType.LONG_TERM_RENT],
    longTermRent: { monthlyAmount: 1200, currency: 'EUR' },
    addressId: address.id,
    images,
  };
}

function caseBody(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Desahucio en Carrer de Sants',
    description: 'Familia con menores. Necesitamos presencia para pararlo.',
    location: {
      label: 'Carrer de Sants, Barcelona',
      coordinates: [2.132456, 41.375678],
      city: 'Barcelona',
      countryCode: 'ES',
    },
    scheduledAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  fakeOxyFiles.reset();
});

afterAll(async () => {
  await getDb().delete(evictionCases);
});

describe('POST /api/images/upload', () => {
  it("stores the photo in the uploader's own Oxy account, EXIF stripped, and nothing in Homiio", async () => {
    const { fileId, body } = await uploadAs(HOST);

    const file = fakeOxyFiles.files.get(fileId);
    assertFound(file, 'stored file');
    expect(file.ownerUserId).toBe(HOST);
    expect(file.visibility).toBe('public');
    // Re-encoded: no EXIF block at all, so no GPS tag.
    expect((await sharp(file.bytes).metadata()).exif).toBeUndefined();

    // The answer every app build reads, plus the file id.
    expect(body.imageId).toBe(fileId);
    expect((body.urls as Record<string, string>).medium).toBe(
      `https://cloud.oxy.test/${fileId}?variant=w640`,
    );
    expect((body.keys as { original: string }).original).toBe(`oxy:${fileId}`);
  });

  it('passes on a takedown (451) as itself', async () => {
    const api = fakeOxyFiles.api();
    api.uploadUserMedia = async () => {
      throw oxyError(451, 'CONTENT_BLOCKED');
    };
    setOxyFilesForTests(api);
    try {
      const res = await request(buildApp(HOST))
        .post('/images/upload')
        .attach('image', await photoWithLocation(), {
          filename: 'p.jpg',
          contentType: 'image/jpeg',
        });
      expect(res.status).toBe(451);
    } finally {
      setOxyFilesForTests(fakeOxyFiles.api());
    }
  });

  it('removing a photo from the picker deletes nothing', async () => {
    const { fileId } = await uploadAs(HOST);
    const res = await request(buildApp(STRANGER)).delete(`/images/oxy:${fileId}`);
    expect(res.status).toBe(200);
    expect(fakeOxyFiles.files.get(fileId)?.status).toBe('active');
  });
});

describe('publishing an uploaded photo', () => {
  it("mints the row from the publisher's own file — by fileId, and by an old build's oxy: keys", async () => {
    const first = await uploadAs(HOST, '#112233');
    const second = await uploadAs(HOST, '#445566');
    const res = await request(buildApp(HOST))
      .post('/properties')
      .send(
        await listingBody([
          { fileId: first.fileId, isPrimary: true },
          { keys: { original: `oxy:${second.fileId}`, small: 'x', medium: 'x', large: 'x' } },
        ]),
      );
    expect(res.status).toBe(201);

    const persisted = await findPropertyById(res.body.data.id);
    assertFound(persisted, 'persisted');
    expect(persisted.images).toHaveLength(2);
    const rows = await getDb()
      .select()
      .from(images)
      .where(eq(images.entityId, String(res.body.data.id)));
    expect(rows.map((row) => row.oxyFileId).sort()).toEqual([first.fileId, second.fileId].sort());
    expect(rows.every((row) => row.oxyFileOwner === 'account' && row.keysOriginal === null)).toBe(
      true,
    );
    expect(persisted.images[0].urlsMedium).toContain('variant=w640');
  });

  it("refuses a photo that is not the publisher's own", async () => {
    const theirs = await uploadAs(STRANGER);
    const res = await request(buildApp(HOST))
      .post('/properties')
      .send(await listingBody([{ fileId: theirs.fileId }]));
    expect(res.status).toBe(400);
    expect(res.body.message ?? res.body.error?.message ?? '').toMatch(/not an image you uploaded/);
  });
});

describe('an eviction case cover', () => {
  it("becomes the case's own row, and the client URL is not trusted", async () => {
    const { fileId } = await uploadAs(HOST);
    const res = await request(buildApp(HOST))
      .post('/evictions')
      .send(caseBody({ coverImage: { imageId: fileId, url: 'https://evil.example/x.jpg' } }));
    expect(res.status).toBe(201);

    const caseId = String(res.body.data.eviction.id);
    const [row] = await getDb().select().from(evictionCases).where(eq(evictionCases.id, caseId));
    expect(row.coverImageUrl).toBe(`https://cloud.oxy.test/${fileId}?variant=w640`);
    const [cover] = await getDb()
      .select()
      .from(images)
      .where(eq(images.id, row.coverImageId as string));
    expect(cover.entityType).toBe('eviction_case');
    expect(cover.entityId).toBe(caseId);

    // An edit naming the existing row keeps it.
    const kept = await request(buildApp(HOST))
      .put(`/evictions/${caseId}`)
      .send({ coverImage: { imageId: cover.id } });
    expect(kept.status).toBe(200);
    const [after] = await getDb().select().from(evictionCases).where(eq(evictionCases.id, caseId));
    expect(after.coverImageId).toBe(cover.id);
  });

  it("refuses a cover that is not the organiser's photo, and creates no case", async () => {
    const theirs = await uploadAs(STRANGER);
    const before = await getDb().select().from(evictionCases);
    const res = await request(buildApp(HOST))
      .post('/evictions')
      .send(caseBody({ coverImage: { imageId: theirs.fileId } }));
    expect(res.status).toBe(400);
    expect(await getDb().select().from(evictionCases)).toHaveLength(before.length);
  });
});
