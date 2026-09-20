/**
 * Publishing a listing that carries photos — the REAL controllers, the REAL
 * upload endpoint, a REAL Postgres.
 *
 * ## Why this suite had to be written this way
 *
 * `__tests__/db/propertyImages.test.ts` inserts its `images` rows by hand, and
 * that is exactly why nobody noticed that NO product path ever created one.
 * `property_images.image_id` is `NOT NULL`, the write path read it off the
 * request, and the publish wizard's body carried `{ url, caption, isPrimary }`
 * — so every publish with a photo raised
 *
 *     23502  null value in column "image_id" of relation "property_images"
 *
 * and answered 500, from the day the property write path moved to Postgres.
 * A suite that mints its own `images` row asks "does the constraint hold?" when
 * the question that mattered was "can the product satisfy it?".
 *
 * So: nothing here inserts into `images`. The photo goes through
 * `POST /images/upload` and the publish body is built from that response, the
 * way `packages/frontend/hooks/useCreatePropertyWizard.ts` builds it. If the
 * upload's response ever stops carrying what a publish needs, these fail.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { PropertyType, OfferingType } from '@homiio/shared-types';

import { createProperty } from '../../controllers/property/create';
import { updateProperty } from '../../controllers/property/updateDelete';
import imageRoutes from '../../routes/images';
import { createAddress } from '../helpers/factories';
import { getDb } from '../../db/postgres';
import { images } from '../../db/schema';
import { findPropertyById } from '../../db/properties/propertyReads';
import { errorHandler } from '../../middlewares/errorHandler';
import { serializeWireIds } from '../../middlewares/wireIds';
import { assertFound } from '../helpers/assertFound';

/** The upload endpoint's response body, as the wizard receives it. */
interface UploadedPhoto {
  urls: Record<string, string>;
  keys: { original: string; variants: Record<string, string> };
  metadata: { originalSize: number; originalFormat: string; width?: number; height?: number };
}

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
  app.use('/images', imageRoutes);
  app.post('/properties', createProperty);
  app.put('/properties/:propertyId', updateProperty);
  app.use(errorHandler);
  return app;
}

const app = buildApp('oxy-owner');

/** A real JPEG, so Sharp has real bytes and real dimensions to report. */
async function photoBytes(width: number): Promise<Buffer> {
  return sharp({
    create: { width, height: 30, channels: 3, background: { r: 200, g: 120, b: 60 } },
  })
    .jpeg()
    .toBuffer();
}

/** Upload one photo through the real endpoint, exactly as the wizard does. */
async function uploadPhoto(width = 40): Promise<UploadedPhoto> {
  const response = await request(app)
    .post('/images/upload')
    .field('folder', 'properties')
    .attach('image', await photoBytes(width), 'room.jpg');
  expect(response.status).toBe(200);
  return response.body.data as UploadedPhoto;
}

/**
 * The publish body's `images[]` entry for an uploaded photo — the same fields
 * `buildPropertyPayload` sends.
 */
function wizardPhoto(
  uploaded: UploadedPhoto,
  extra: { caption?: string; isPrimary?: boolean } = {},
) {
  return {
    keys: {
      original: uploaded.keys.original,
      small: uploaded.keys.variants.small,
      medium: uploaded.keys.variants.medium,
      large: uploaded.keys.variants.large,
    },
    caption: extra.caption ?? '',
    isPrimary: extra.isPrimary ?? false,
    bytes: uploaded.metadata.originalSize,
    width: uploaded.metadata.width,
    height: uploaded.metadata.height,
  };
}

async function baseBody() {
  const address = await createAddress();
  return {
    type: PropertyType.APARTMENT,
    bedrooms: 2,
    bathrooms: 1,
    offerings: [OfferingType.LONG_TERM_RENT],
    longTermRent: { monthlyAmount: 1200, currency: 'EUR' },
    addressId: address.id,
  };
}

async function publish(images: unknown[]) {
  return request(app)
    .post('/properties')
    .send({ ...(await baseBody()), images });
}

describe('publishing a listing with photos', () => {
  it('mints the canonical images row and attaches the photo', async () => {
    const uploaded = await uploadPhoto();
    const res = await publish([wizardPhoto(uploaded, { caption: 'Living room', isPrimary: true })]);

    // The assertion the defect failed: a publish carrying a photo is a 201.
    expect(res.status).toBe(201);

    const persisted = await findPropertyById(res.body.data.id);
    assertFound(persisted, 'persisted');
    expect(persisted.images).toHaveLength(1);
    const [photo] = persisted.images;
    expect(photo.imageId).toBeTruthy();
    expect(photo.isPrimary).toBe(true);
    expect(photo.caption).toBe('Living room');
    // `has_images` is derived by the one writer, and a listing whose photo did
    // not land would still read `false` here.
    expect(persisted.property.hasImages).toBe(true);

    // The canonical row exists, belongs to THIS listing, and carries the
    // pipeline's own numbers — not the request's.
    const [row] = await getDb().select().from(images).where(eq(images.id, photo.imageId));
    expect(row.entityType).toBe('property');
    expect(row.entityId).toBe(res.body.data.id);
    expect(row.keysOriginal).toBe(uploaded.keys.original);
    expect(row.format).toBe('jpeg');
    expect(row.bytes).toBeGreaterThan(0);
    expect(row.width).toBe(40);
    expect(row.height).toBe(30);

    // Every URL is DERIVED from the validated key, so the stored URL ends in
    // the key and nothing the client sent could have replaced it.
    expect(row.urlsMedium.endsWith(uploaded.keys.variants.medium)).toBe(true);
    expect(photo.url).toBe(row.urlsMedium);
  });

  it('keeps the order the host arranged the photos in', async () => {
    const first = await uploadPhoto(41);
    const second = await uploadPhoto(42);
    const third = await uploadPhoto(43);

    // Published in a deliberately non-upload order: third, first, second.
    const res = await publish([
      wizardPhoto(third, { caption: 'kitchen', isPrimary: true }),
      wizardPhoto(first, { caption: 'bedroom' }),
      wizardPhoto(second, { caption: 'balcony' }),
    ]);
    expect(res.status).toBe(201);

    const persisted = await findPropertyById(res.body.data.id);
    assertFound(persisted, 'persisted');
    // Read back through the repository, which orders by `property_images.order`
    // — so this passes only if the order reached the server AND was stored.
    expect(persisted.images.map((image) => image.caption)).toEqual([
      'kitchen',
      'bedroom',
      'balcony',
    ]);
    expect(persisted.images.map((image) => image.order)).toEqual([0, 1, 2]);
    expect(persisted.images.map((image) => image.isPrimary)).toEqual([true, false, false]);
  });

  it('rejects a second primary rather than failing the whole publish', async () => {
    const res = await publish([
      wizardPhoto(await uploadPhoto(44), { caption: 'a', isPrimary: true }),
      wizardPhoto(await uploadPhoto(45), { caption: 'b', isPrimary: true }),
    ]);
    // `property_images_one_primary_key` is a partial unique index; a body with
    // two covers must not become a 500 the host cannot act on.
    expect(res.status).toBe(201);
    const persisted = await findPropertyById(res.body.data.id);
    assertFound(persisted, 'persisted');
    expect(persisted.images.map((image) => image.isPrimary)).toEqual([true, false]);
  });

  it('refuses a storage key that climbs out of the store', async () => {
    const uploaded = await uploadPhoto(46);
    const photo = wizardPhoto(uploaded);
    photo.keys.medium = '../../../etc/passwd.webp';
    const res = await publish([photo]);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PROPERTY_IMAGE');
  });

  it('refuses a key under the private documents prefix', async () => {
    const uploaded = await uploadPhoto(47);
    const photo = wizardPhoto(uploaded);
    // A tenant's payslip lives here. The publish path must not be able to
    // republish one as a listing photo.
    photo.keys.large = 'applications/documents/some-uuid-original.jpeg';
    const res = await publish([photo]);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PROPERTY_IMAGE');
  });

  it('refuses an imageId that names no row, instead of a foreign-key 500', async () => {
    const res = await publish([{ imageId: 'no-such-image', caption: 'ghost' }]);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PROPERTY_IMAGE');
  });
});

describe('editing a listing with photos', () => {
  it('reorders by id without minting a second images row', async () => {
    const created = await publish([
      wizardPhoto(await uploadPhoto(48), { caption: 'hall', isPrimary: true }),
      wizardPhoto(await uploadPhoto(49), { caption: 'study' }),
    ]);
    expect(created.status).toBe(201);
    const propertyId = created.body.data.id as string;

    const before = await findPropertyById(propertyId);
    assertFound(before, 'before');
    const ids = before.images.map((image) => image.imageId);

    // The edit screen loads the saved photos back and saves them swapped —
    // by id, which is what the server returned.
    const res = await request(app)
      .put(`/properties/${propertyId}`)
      .send({
        images: [
          { imageId: ids[1], caption: 'study', isPrimary: true },
          { imageId: ids[0], caption: 'hall', isPrimary: false },
        ],
      });
    expect(res.status).toBe(200);

    const after = await findPropertyById(propertyId);
    assertFound(after, 'after');
    expect(after.images.map((image) => image.caption)).toEqual(['study', 'hall']);
    expect(after.images.map((image) => image.imageId)).toEqual([ids[1], ids[0]]);

    // No new canonical rows: a re-save reuses what the publish minted.
    const rows = await getDb().select().from(images).where(eq(images.entityId, propertyId));
    expect(rows).toHaveLength(2);
  });

  it('saves the same freshly uploaded photo twice without duplicating its row', async () => {
    const created = await publish([]);
    expect(created.status).toBe(201);
    const propertyId = created.body.data.id as string;

    const uploaded = await uploadPhoto(50);
    const body = { images: [wizardPhoto(uploaded, { caption: 'patio', isPrimary: true })] };
    expect((await request(app).put(`/properties/${propertyId}`).send(body)).status).toBe(200);
    expect((await request(app).put(`/properties/${propertyId}`).send(body)).status).toBe(200);

    const rows = await getDb().select().from(images).where(eq(images.entityId, propertyId));
    expect(rows).toHaveLength(1);
  });
});
