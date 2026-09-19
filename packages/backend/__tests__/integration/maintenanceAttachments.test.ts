/**
 * Photos on a repair request (#518 §7.1, #519 §7.1) — the open half of this
 * domain, against the REAL Postgres.
 *
 * ## The two things that have a way to be wrong and look fine
 *
 * **The EXIF.** A phone writes GPS into a photo taken indoors. Storing an
 * upload verbatim would publish the home's exact coordinates to everyone who
 * can read the request — the precision leak ADR 0003 exists to stop, arriving
 * through a door nobody was watching. The photo would still render, and
 * nothing would fail. So a case uploads an image carrying a GPS tag and asserts
 * the stored object no longer has one.
 *
 * **The door.** These are the first rows written under the private prefix, so
 * a case fetches the stored key through the PUBLIC image route and asserts it
 * is refused. A private path that quietly served over the public one would pass
 * every authorization test in this file.
 *
 * Every authorization refusal re-reads the table, because a handler that 404s
 * and writes anyway satisfies any assertion made on its response alone — and
 * here it also has to leave the BUCKET alone, which is asserted separately.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import express, { type Express } from 'express';
import multer from 'multer';
import request from 'supertest';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { LeaseStatus, PropertyStatus } from '@homiio/shared-types';

import * as maintenanceController from '../../controllers/maintenanceController';
import imageController from '../../controllers/imageController';
import { getDb } from '../../db/postgres';
import {
  leaseCoTenants,
  leases,
  maintenanceRequestAttachments,
  maintenanceRequests,
} from '../../db/schema';
import { errorHandler } from '../../middlewares/errorHandler';
import { serializeWireIds } from '../../middlewares/wireIds';
import { LOCAL_IMAGE_STORE_DIR } from '../../services/imageUploadService';
import { objectIdHex, resetGeoTables, seedListingWithGeo } from '../helpers/postgresGeoFixtures';

const LANDLORD = 'oxy-landlord';
const TENANT = 'oxy-tenant';
const STRANGER = 'oxy-stranger';

/** Multer, mounted exactly as `routes/maintenance.ts` mounts it. */
const upload = multer({ storage: multer.memoryStorage(), limits: { files: 1 } });

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
  app.post('/maintenance', maintenanceController.createRequest);
  app.get('/maintenance/:id', maintenanceController.getRequest);
  app.post(
    '/maintenance/:id/attachments',
    upload.single('photo'),
    maintenanceController.attachToRequest,
  );
  app.get(
    '/maintenance/:id/attachments/:attachmentId',
    maintenanceController.getRequestAttachment,
  );
  app.use(errorHandler);
  return app;
}

/** The PUBLIC image route, mounted exactly as `routes/public.ts` mounts it. */
function publicImages(): Express {
  const app = express();
  app.get('/images/file/*', (req, res) => imageController.serveLocalImage(req, res));
  app.use(errorHandler);
  return app;
}

/**
 * A small JPEG carrying a GPS tag, which is what a phone actually produces.
 *
 * `IFD3` is the GPS directory: libvips numbers the EXIF IFDs and exposes the
 * GPS one as `exif-ifd3-*`, which is why the tag goes there rather than under a
 * `GPS` key sharp's types do not have.
 */
async function photoWithLocation(): Promise<Buffer> {
  return blankPhoto({
    IFD0: { Make: 'Homiio Test' },
    IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '41/1 23/1 5/1' },
  });
}

/** The same photo with EXIF but NO GPS directory — the floor's control. */
async function photoWithoutLocation(): Promise<Buffer> {
  return blankPhoto({ IFD0: { Make: 'Homiio Test' } });
}

async function blankPhoto(exif: Parameters<sharp.Sharp['withExifMerge']>[0]): Promise<Buffer> {
  return sharp({
    create: { width: 64, height: 48, channels: 3, background: { r: 120, g: 90, b: 60 } },
  })
    .withExifMerge(exif)
    .jpeg()
    .toBuffer();
}

let geoCounter = 0;

async function seedRequest(): Promise<{ requestId: string; leaseId: string }> {
  geoCounter += 1;
  const { propertyId } = await seedListingWithGeo({
    countryCode: `A${geoCounter}`,
    cityName: `Repairtown ${geoCounter}`,
    overrides: { status: PropertyStatus.PUBLISHED, oxyUserId: LANDLORD },
  });
  const [lease] = await getDb()
    .insert(leases)
    .values({
      id: objectIdHex(),
      propertyId,
      landlordOxyUserId: LANDLORD,
      tenantOxyUserId: TENANT,
      status: LeaseStatus.ACTIVE,
      leaseTermsStartDate: new Date('2026-01-01T00:00:00.000Z'),
      leaseTermsEndDate: new Date('2027-01-01T00:00:00.000Z'),
      rentDetailsMonthlyRent: 900,
    })
    .returning({ id: leases.id });
  await getDb()
    .insert(leaseCoTenants)
    .values({ leaseId: lease.id, oxyUserId: 'oxy-co-tenant', role: 'secondary', status: 'signed' });

  const created = await request(buildApp(TENANT)).post('/maintenance').send({
    leaseId: lease.id,
    category: 'plumbing',
    urgency: 'high',
    title: 'Damp patch on the bedroom wall',
    description: 'It has spread since the weekend.',
  });
  expect(created.status).toBe(201);
  return { requestId: created.body.data.id, leaseId: lease.id };
}

async function attach(requestId: string, as: string) {
  return request(buildApp(as))
    .post(`/maintenance/${requestId}/attachments`)
    .attach('photo', await photoWithLocation(), 'damp.jpg');
}

const rowsOf = async (requestId: string) =>
  getDb()
    .select()
    .from(maintenanceRequestAttachments)
    .where(eq(maintenanceRequestAttachments.requestId, requestId));

beforeEach(async () => {
  await getDb().delete(maintenanceRequests);
  await resetGeoTables();
});

describe('attaching a photo', () => {
  it('stores it under a private key and answers a path, never a link', async () => {
    const { requestId } = await seedRequest();

    const res = await attach(requestId, TENANT);

    expect(res.status).toBe(201);
    expect(res.body.data.downloadPath).toBe(
      `/api/maintenance/${requestId}/attachments/${res.body.data.id}`,
    );
    // The key names an object in a private bucket. It never leaves the server:
    // a key in a payload is a key in a log, a screenshot and a bug report.
    expect(JSON.stringify(res.body)).not.toContain('private/');

    const [row] = await rowsOf(requestId);
    expect(row.storageKey.startsWith(`private/maintenance/${requestId}/`)).toBe(true);
    expect(row.role).toBe('tenant');
    expect(row.contentType).toBe('image/webp');
    expect(row.bytes).toBeGreaterThan(0);
  });

  it('strips the GPS the phone wrote into it', async () => {
    const { requestId } = await seedRequest();

    // The floor first: the fixture really does carry a GPS block, so a test that
    // asserted its absence over a photo that never had one would pass for the
    // wrong reason.
    //
    // Measured by SIZE against the same photo without the GPS directory, rather
    // than by looking for the tag's name: EXIF stores numeric tag ids, not
    // names, so a string search finds nothing even when the coordinates are
    // there. A longer block is the GPS directory being present.
    const [withGps, withoutGps] = await Promise.all([
      sharp(await photoWithLocation()).metadata(),
      sharp(await photoWithoutLocation()).metadata(),
    ]);
    expect(withGps.exif).toBeDefined();
    expect(withoutGps.exif).toBeDefined();
    expect(withGps.exif!.length).toBeGreaterThan(withoutGps.exif!.length);

    await attach(requestId, TENANT);
    const [row] = await rowsOf(requestId);
    const stored = await fs.readFile(path.join(LOCAL_IMAGE_STORE_DIR, row.storageKey));

    const metadata = await sharp(stored).metadata();
    // Re-encoded, so the whole EXIF block is gone — not the GPS tag edited out
    // of one that survived.
    expect(metadata.exif).toBeUndefined();
    expect(metadata.format).toBe('webp');
  });

  it('lets the landlord attach one too, recorded as theirs', async () => {
    const { requestId } = await seedRequest();

    const res = await attach(requestId, LANDLORD);

    expect(res.status).toBe(201);
    const [row] = await rowsOf(requestId);
    // The role is stored at write time, so a later change of tenancy does not
    // relabel who photographed what.
    expect(row.role).toBe('landlord');
  });

  it('refuses a stranger, and stores nothing', async () => {
    const { requestId } = await seedRequest();

    const res = await attach(requestId, STRANGER);

    expect(res.status).toBe(404);
    // Re-read: a handler that 404s and writes anyway satisfies the line above.
    expect(await rowsOf(requestId)).toHaveLength(0);
    // And the BUCKET is untouched — authorization runs before any object is
    // written, so a stranger's upload never reaches storage.
    const folder = path.join(LOCAL_IMAGE_STORE_DIR, 'private', 'maintenance', requestId);
    await expect(fs.readdir(folder)).rejects.toThrow();
  });

  it('refuses past the per-request ceiling', async () => {
    const { requestId } = await seedRequest();
    for (let index = 0; index < 6; index += 1) {
      expect((await attach(requestId, TENANT)).status).toBe(201);
    }

    const res = await attach(requestId, TENANT);

    expect(res.status).toBe(409);
    expect(await rowsOf(requestId)).toHaveLength(6);
  });
});

describe('reading a photo back', () => {
  it('gives both sides of the lease the bytes', async () => {
    const { requestId } = await seedRequest();
    const created = await attach(requestId, TENANT);
    const attachmentId = created.body.data.id;

    for (const viewer of [TENANT, LANDLORD]) {
      const res = await request(buildApp(viewer)).get(
        `/maintenance/${requestId}/attachments/${attachmentId}`,
      );
      expect(res.status).toBe(200);
      expect(res.body.data.contentType).toBe('image/webp');
      expect(Buffer.from(res.body.data.base64, 'base64').length).toBeGreaterThan(0);
      // Somebody's home. A proxy keeping a copy would undo the private path.
      expect(res.headers['cache-control']).toBe('private, no-store');
    }
  });

  it('gives a stranger a 404', async () => {
    const { requestId } = await seedRequest();
    const attachmentId = (await attach(requestId, TENANT)).body.data.id;

    const res = await request(buildApp(STRANGER)).get(
      `/maintenance/${requestId}/attachments/${attachmentId}`,
    );

    expect(res.status).toBe(404);
  });

  it('refuses an attachment id from another request', async () => {
    const mine = await seedRequest();
    const theirs = await seedRequest();
    const theirAttachment = (await attach(theirs.requestId, TENANT)).body.data.id;

    // The TENANT of both, so participation passes and only the parent check can
    // refuse: knowing an id grants no access.
    const res = await request(buildApp(TENANT)).get(
      `/maintenance/${mine.requestId}/attachments/${theirAttachment}`,
    );

    expect(res.status).toBe(404);
  });

  it('lists them on the request, as paths', async () => {
    const { requestId } = await seedRequest();
    await attach(requestId, TENANT);
    await attach(requestId, LANDLORD);

    const res = await request(buildApp(TENANT)).get(`/maintenance/${requestId}`);

    expect(res.status).toBe(200);
    expect(res.body.data.attachments).toHaveLength(2);
    for (const attachment of res.body.data.attachments) {
      expect(attachment.downloadPath).toContain(`/api/maintenance/${requestId}/attachments/`);
      expect(attachment).not.toHaveProperty('storageKey');
      expect(attachment).not.toHaveProperty('url');
    }
  });
});

describe('the public image route cannot reach them', () => {
  it('refuses the stored key', async () => {
    const { requestId } = await seedRequest();
    await attach(requestId, TENANT);
    const [row] = await rowsOf(requestId);

    const res = await request(publicImages()).get(`/images/file/${row.storageKey}`);

    // These are the first rows under the private prefix. A path that quietly
    // served over the public route would pass every authorization case above.
    expect(res.status).toBe(400);
  });
});
