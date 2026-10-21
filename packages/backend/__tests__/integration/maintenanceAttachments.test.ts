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
 * **The door.** A case asks the PUBLIC image route for a key under the old
 * private prefix and asserts it is refused. A private path that quietly served
 * over the public one would pass every authorization test in this file.
 *
 * Every authorization refusal re-reads the table, because a handler that 404s
 * and writes anyway satisfies any assertion made on its response alone — and
 * here it also has to leave Oxy alone, which is asserted separately.
 */

import express, { type Express } from 'express';
import multer from 'multer';
import request from 'supertest';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { LeaseStatus, PropertyStatus } from '@homiio/shared-types';
import { CHECK_VIOLATION, constraintNameOf, sqlStateOf } from '@oxy.so/db';

import * as maintenanceController from '../../controllers/maintenanceController';
import imageController from '../../controllers/imageController';
import { getDb } from '../../db/postgres';
import {
  fileReferenceChanges,
  leaseCoTenants,
  leases,
  maintenanceRequestAttachments,
  maintenanceRequests,
} from '../../db/schema';
import { errorHandler } from '../../middlewares/errorHandler';
import { serializeWireIds } from '../../middlewares/wireIds';
import { setPrivateDocumentSleepForTests } from '../../services/files/privateDocuments';
import { fakeOxyFiles, oxyError } from '../helpers/fakeOxyFiles';
import { objectIdHex, resetGeoTables, seedListingWithGeo } from '../helpers/postgresGeoFixtures';

// A retry of a transient Oxy failure waits for nothing here: the waits are the
// module's, not the test's.
beforeAll(() => {
  setPrivateDocumentSleepForTests(() => Promise.resolve());
});

afterAll(() => {
  setPrivateDocumentSleepForTests(null);
});

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
  app.get('/maintenance/:id/attachments/:attachmentId', maintenanceController.getRequestAttachment);
  app.use(errorHandler);
  return app;
}

/** The PUBLIC image route, mounted exactly as `routes/public.ts` mounts it. */
function publicImages(): Express {
  const app = express();
  app.get('/images/file/*', (req, res) => imageController.serveLegacyImage(req, res));
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
async function photoWithLocation(shade = 0): Promise<Buffer> {
  return blankPhoto(shade, {
    IFD0: { Make: 'Homiio Test' },
    IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '41/1 23/1 5/1' },
  });
}

/** The same photo with EXIF but NO GPS directory — the floor's control. */
async function photoWithoutLocation(): Promise<Buffer> {
  return blankPhoto(0, { IFD0: { Make: 'Homiio Test' } });
}

/** `shade` changes the PIXELS — the stored photo is re-encoded, so EXIF alone would not differ. */
async function blankPhoto(
  shade: number,
  exif: Parameters<sharp.Sharp['withExifMerge']>[0],
): Promise<Buffer> {
  return sharp({
    create: {
      width: 64,
      height: 48,
      channels: 3,
      background: { r: 120, g: 90, b: (60 + shade * 7) % 256 },
    },
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

let photoCounter = 0;

/**
 * Attach a photo — a DIFFERENT one each call unless `photo` is given: Oxy
 * answers the same bytes from the same person with the file they already
 * hold, which is a case of its own.
 */
async function attach(requestId: string, as: string, photo?: Buffer) {
  photoCounter += 1;
  return request(buildApp(as))
    .post(`/maintenance/${requestId}/attachments`)
    .attach('photo', photo ?? (await photoWithLocation(photoCounter)), 'damp.jpg');
}

const rowsOf = async (requestId: string) =>
  getDb()
    .select()
    .from(maintenanceRequestAttachments)
    .where(eq(maintenanceRequestAttachments.requestId, requestId));

beforeEach(async () => {
  await getDb().delete(maintenanceRequests);
  await resetGeoTables();
  fakeOxyFiles.reset();
});

/** The bytes Oxy holds for a row's `oxy:<fileId>`. */
function storedBytes(storageKey: string): Buffer {
  const file = fakeOxyFiles.files.get(storageKey.slice(4));
  if (!file) throw new Error('the attachment was not stored');
  return file.bytes as Buffer;
}

describe('attaching a photo', () => {
  it('stores it in Oxy and answers a path, never a link', async () => {
    const { requestId } = await seedRequest();

    const res = await attach(requestId, TENANT);

    expect(res.status).toBe(201);
    expect(res.body.data.downloadPath).toBe(
      `/api/maintenance/${requestId}/attachments/${res.body.data.id}`,
    );
    // The ref names a private Oxy file. It never leaves the server: a ref in a
    // payload is a ref in a log, a screenshot and a bug report.
    expect(JSON.stringify(res.body)).not.toContain('oxy:');

    const [row] = await rowsOf(requestId);
    expect(row.storageKey).toMatch(/^oxy:[A-Za-z0-9_-]+$/);
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
    const stored = storedBytes(row.storageKey);

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
    // And nothing was stored — authorization runs before any byte leaves
    // Homiio, so a stranger's upload never reaches storage of any kind.
    expect(fakeOxyFiles.callsOf('uploadUserMediaLarge')).toHaveLength(0);
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
  it('refuses a key under the private prefix, as stored before the move', async () => {
    const { requestId } = await seedRequest();
    const key = `private/maintenance/${requestId}/0192f4a2-aaaa-7bbb-8ccc-1234567890ab.webp`;

    const res = await request(publicImages()).get(`/images/file/${key}`);

    // A path that quietly answered for private keys over the public route
    // would pass every authorization case above.
    expect(res.status).toBe(400);
  });
});

/**
 * Oxy stage 4c (ADR 0043): the photo is a
 * PRIVATE file in the uploader's own Oxy account, read back through Homiio's
 * consent — and every refusal of Oxy's still leaves a working photo.
 */
describe("in the uploader's Oxy account (stage 4c)", () => {
  it('stores a private file the uploader owns, re-encoded', async () => {
    const { requestId } = await seedRequest();

    const res = await attach(requestId, TENANT);

    expect(res.status).toBe(201);
    const [row] = await rowsOf(requestId);
    expect(row.storageKey).toMatch(/^oxy:[A-Za-z0-9_-]+$/);
    const file = fakeOxyFiles.files.get(row.storageKey.slice(4));
    expect(file).toMatchObject({ ownerUserId: TENANT, visibility: 'private', mime: 'image/webp' });
    // The GPS went before the bytes left Homiio.
    expect((await sharp(file?.bytes as Buffer).metadata()).exif).toBeUndefined();
    // The row is the use: its trigger marked the pair for the drain.
    const marks = await getDb()
      .select()
      .from(fileReferenceChanges)
      .where(eq(fileReferenceChanges.oxyFileId, row.storageKey.slice(4)));
    expect(marks.map((mark) => [mark.entityType, mark.entityId])).toEqual([
      ['maintenance_request', requestId],
    ]);
  });

  it('gives both sides of the lease the bytes, and a stranger a 404', async () => {
    const { requestId } = await seedRequest();
    const attachmentId = (await attach(requestId, TENANT)).body.data.id;
    const [row] = await rowsOf(requestId);
    const stored = fakeOxyFiles.files.get(row.storageKey.slice(4))?.bytes as Buffer;

    for (const viewer of [TENANT, LANDLORD]) {
      const res = await request(buildApp(viewer)).get(
        `/maintenance/${requestId}/attachments/${attachmentId}`,
      );
      expect(res.status).toBe(200);
      expect(Buffer.from(res.body.data.base64, 'base64').equals(stored)).toBe(true);
      expect(res.headers['cache-control']).toBe('private, no-store');
    }
    const stranger = await request(buildApp(STRANGER)).get(
      `/maintenance/${requestId}/attachments/${attachmentId}`,
    );
    expect(stranger.status).toBe(404);
    // Homiio's party check refused the stranger; Oxy was never asked.
    expect(fakeOxyFiles.callsOf('linkedDownloadUrls')).toHaveLength(2);
  });

  it('honours a revocation of Homiio on the same bytes: it says so and stores nothing', async () => {
    const { requestId } = await seedRequest();
    const photo = await photoWithLocation();
    await attach(requestId, TENANT, photo);
    const [first] = await rowsOf(requestId);
    fakeOxyFiles.revokeAccess(first.storageKey.slice(4));

    // The same photo again: Oxy answers the person's existing file, whose
    // revocation survives a re-upload. That is the person's decision about
    // these bytes, so they are not stored anywhere else instead.
    const again = await attach(requestId, TENANT, photo);

    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('DOCUMENT_ACCESS_REVOKED');
    expect(await rowsOf(requestId)).toHaveLength(1);
  });

  it('answers 404 once the owner revokes Homiio, and nothing else', async () => {
    const { requestId } = await seedRequest();
    const attachmentId = (await attach(requestId, TENANT)).body.data.id;
    const [row] = await rowsOf(requestId);

    fakeOxyFiles.revokeAccess(row.storageKey.slice(4));

    const res = await request(buildApp(LANDLORD)).get(
      `/maintenance/${requestId}/attachments/${attachmentId}`,
    );
    expect(res.status).toBe(404);
  });

  it('never hands out bytes that do not hash to what Oxy recorded', async () => {
    const { requestId } = await seedRequest();
    const attachmentId = (await attach(requestId, TENANT)).body.data.id;
    const [row] = await rowsOf(requestId);
    fakeOxyFiles.tamperedDownloads.set(
      fakeOxyFiles.linkedUrl(row.storageKey.slice(4)),
      Buffer.from('not the photo'),
    );

    const res = await request(buildApp(TENANT)).get(
      `/maintenance/${requestId}/attachments/${attachmentId}`,
    );
    expect(res.status).toBe(500);
    expect(res.body.data?.base64).toBeUndefined();
  });

  it.each([
    [
      'an outage that does not pass',
      () => (fakeOxyFiles.largeUploadError = oxyError(503, 'UNAVAILABLE')),
      503,
      'DOCUMENT_STORAGE_UNAVAILABLE',
    ],
    [
      'a refusal of Homiio’s credential',
      () => (fakeOxyFiles.largeUploadError = oxyError(403, 'INSUFFICIENT_SCOPE')),
      503,
      'DOCUMENT_STORAGE_UNAVAILABLE',
    ],
    [
      'a full Oxy account',
      () => (fakeOxyFiles.largeUploadError = oxyError(413, 'STORAGE_QUOTA_EXCEEDED')),
      413,
      'STORAGE_QUOTA_EXCEEDED',
    ],
    [
      'blocked bytes',
      () => (fakeOxyFiles.largeUploadError = oxyError(451, 'CONTENT_BLOCKED')),
      451,
      'DOCUMENT_BLOCKED',
    ],
    [
      'a long rate limit',
      () => (fakeOxyFiles.largeUploadError = oxyError(429, 'RATE_LIMITED')),
      503,
      'DOCUMENT_STORAGE_BUSY',
    ],
    [
      'an answer that is not private',
      () => (fakeOxyFiles.largeUploadVisibilityOverride = 'public'),
      502,
      'DOCUMENT_STORAGE_MISMATCH',
    ],
  ])(
    'fails the upload on %s, and writes nothing anywhere',
    async (_label, arrange, status, code) => {
      const { requestId } = await seedRequest();
      arrange();

      const res = await attach(requestId, TENANT);

      expect(res.status).toBe(status);
      expect(res.body.error.code).toBe(code);
      expect(await rowsOf(requestId)).toHaveLength(0);
    },
  );

  it('retries a failure that passes, and stores the photo in Oxy', async () => {
    const { requestId } = await seedRequest();
    fakeOxyFiles.largeUploadErrors.push(
      oxyError(503, 'UNAVAILABLE'),
      Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
    );

    const res = await attach(requestId, TENANT);

    expect(res.status).toBe(201);
    const [row] = await rowsOf(requestId);
    expect(row.storageKey).toMatch(/^oxy:/);
    expect(fakeOxyFiles.callsOf('uploadUserMediaLarge')).toHaveLength(3);
  });

  it('waits out a short rate limit once', async () => {
    const { requestId } = await seedRequest();
    fakeOxyFiles.largeUploadErrors.push(
      Object.assign(oxyError(429, 'RATE_LIMITED'), { details: { retryAfterSeconds: 1 } }),
    );

    const res = await attach(requestId, TENANT);

    expect(res.status).toBe(201);
    expect(fakeOxyFiles.callsOf('uploadUserMediaLarge')).toHaveLength(2);
  });

  it('refuses an oxy ref that is not an Oxy file id, in the database', async () => {
    const { requestId } = await seedRequest();
    await expect(
      getDb().insert(maintenanceRequestAttachments).values({
        requestId,
        uploadedByOxyUserId: TENANT,
        role: 'tenant',
        storageKey: 'oxy:../../etc',
        contentType: 'image/webp',
        bytes: 1,
      }),
    ).rejects.toThrow();
  });

  it('refuses a bucket key, in the database: the bucket is retired', async () => {
    const { requestId } = await seedRequest();
    const error = await getDb()
      .insert(maintenanceRequestAttachments)
      .values({
        requestId,
        uploadedByOxyUserId: TENANT,
        role: 'tenant',
        storageKey: `private/maintenance/${requestId}/0192f4a2-aaaa-7bbb-8ccc-1234567890ab.webp`,
        contentType: 'image/webp',
        bytes: 1,
      })
      .then(
        () => undefined,
        (rejected: unknown) => rejected,
      );

    expect(sqlStateOf(error)).toBe(CHECK_VIOLATION);
    expect(constraintNameOf(error)).toBe('maintenance_request_attachments_private_key_check');
  });
});
