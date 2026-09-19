/**
 * A tenant's payslip is not a listing photo (#518 §7.4, #519 §7.4).
 *
 * ## The defect these pin
 *
 * Application documents — identity, payslips, employment letters, landlord
 * references — were uploaded through `imageUploadService`, which builds its URL
 * with `getImageUrl()`: `<publicUrl>/api/images/file/<key>`, a route mounted on
 * `routes/public.ts`. No session, no viewer, no check. That URL then went out
 * in the application's own wire shape, and the response carried
 * `Cache-Control: public, max-age=31536000, immutable`, so anyone who ever saw
 * it kept a permanent link to somebody's identity document — and so did every
 * proxy in between.
 *
 * The bucket has never been public (`block_public_acls` in
 * `oxy-infra/terraform-uswest2/s3-apps.tf`). That route was the entire reason
 * these objects were reachable.
 *
 * ## The two halves, and why both are needed
 *
 * Shutting the public door without opening an authorized one makes every
 * document unreachable; opening an authorized one without shutting the public
 * door fixes nothing, because the old URL keeps working. So:
 *
 *  - `GET /api/images/file/applications/documents/…` must **refuse**, for the
 *    objects ALREADY stored — no bytes move, only the door changes;
 *  - `GET /api/applications/:id/documents/:documentId` must serve, and only to
 *    the applicant and the landlord.
 *
 * Each case names the id it expects rather than counting, because "refused"
 * and "served the wrong person's document" are both non-200s to a length check.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import express, { type Express } from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';

import applicationController from '../../controllers/applicationController';
import imageController from '../../controllers/imageController';
import { getDb } from '../../db/postgres';
import { tenantApplicationDocuments, tenantApplications } from '../../db/schema';
import { errorHandler } from '../../middlewares/errorHandler';
import imageUploadService, {
  LOCAL_IMAGE_STORE_DIR,
} from '../../services/imageUploadService';
import config from '../../config';
import { objectIdHex, resetGeoTables, seedListingWithGeo } from '../helpers/postgresGeoFixtures';

const APPLICANT = 'oxy-applicant';
const LANDLORD = 'oxy-landlord';
const STRANGER = 'oxy-stranger';

function authed(oxyUserId: string): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const withUser = req as unknown as { user: { id: string }; userId: string };
    withUser.user = { id: oxyUserId };
    withUser.userId = oxyUserId;
    next();
  });
  app.get('/applications/:id/documents/:documentId', (req, res, next) =>
    applicationController.getApplicationDocument(req, res, next),
  );
  app.get('/applications/:id', (req, res, next) =>
    applicationController.getApplicationById(req, res, next),
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

/** Write bytes into the local store under a key and return the URL a row holds. */
async function storeDocument(key: string, bytes: Buffer): Promise<string> {
  const target = path.join(LOCAL_IMAGE_STORE_DIR, key);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, bytes);
  return imageUploadService.getImageUrl(key);
}

interface Fixture {
  applicationId: string;
  documentId: string;
  key: string;
  bytes: Buffer;
}

let counter = 0;

async function seedApplicationWithDocument(): Promise<Fixture> {
  const db = getDb();
  const { propertyId } = await seedListingWithGeo({
    countryCode: `D${counter}`,
    cityName: `Docville ${counter}`,
  });
  counter += 1;

  const applicationId = objectIdHex();
  await db.insert(tenantApplications).values({
    id: applicationId,
    propertyId,
    applicantOxyUserId: APPLICANT,
    landlordOxyUserId: LANDLORD,
    moveInDate: new Date('2026-11-01T00:00:00.000Z'),
    leaseTermMonths: 12,
    monthlyIncome: 2400,
    employmentStatus: 'employed',
    status: 'submitted',
    submittedAt: new Date('2026-09-19T00:00:00.000Z'),
  });

  // A JPEG, on purpose: `.pdf` was already refused by the public route's
  // extension allowlist, so a photographed payslip is the shape that leaked.
  const bytes = Buffer.from(`payslip-${applicationId}`);
  const key = `applications/documents/${applicationId}-original.jpeg`;
  const url = await storeDocument(key, bytes);

  const documentId = objectIdHex();
  await db.insert(tenantApplicationDocuments).values({
    id: documentId,
    applicationId,
    type: 'income',
    url,
    filename: 'payslip.jpeg',
  });

  return { applicationId, documentId, key, bytes };
}

/**
 * `tenant_applications.property_id` holds a property down, so the applications
 * go before the geo reset — the same order `tenantApplications.test.ts` uses,
 * for the same foreign key.
 */
async function reset(): Promise<void> {
  await getDb().delete(tenantApplications);
  await resetGeoTables();
}

beforeEach(reset);
afterAll(reset);

describe('the public image route does not serve tenancy evidence', () => {

  it('refuses the key that used to work', async () => {
    const fixture = await seedApplicationWithDocument();

    const res = await request(publicImages()).get(`/images/file/${fixture.key}`);

    // Not a 404 and not the bytes: a flat refusal of the PREFIX, so the object
    // stays exactly where it is and only the door changes.
    expect(res.status).toBe(400);
    expect(res.text).not.toContain(fixture.bytes.toString());
  });

  it('refuses it however the key is spelled', async () => {
    const fixture = await seedApplicationWithDocument();
    const app = publicImages();

    for (const spelling of [
      `applications/./documents/${path.basename(fixture.key)}`,
      `listings/../applications/documents/${path.basename(fixture.key)}`,
      `applications//documents/${path.basename(fixture.key)}`,
    ]) {
      const res = await request(app).get(`/images/file/${spelling}`);
      // The prefix is checked after normalization, so a key that RESOLVES into
      // the private prefix is refused even when it does not start with it.
      expect(res.status).toBe(400);
    }
  });

  it('still serves an ordinary listing photo', async () => {
    // The floor: a gate that refused everything would pass every case above
    // while breaking every listing on the site.
    const key = 'property/public-photo-original.jpeg';
    const bytes = Buffer.from('a listing photo');
    await storeDocument(key, bytes);

    const res = await request(publicImages()).get(`/images/file/${key}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(bytes);
  });
});

describe('the authorized route serves them, to two people', () => {

  it('gives the applicant their own document', async () => {
    const fixture = await seedApplicationWithDocument();

    const res = await request(authed(APPLICANT)).get(
      `/applications/${fixture.applicationId}/documents/${fixture.documentId}`,
    );

    expect(res.status).toBe(200);
    expect(Buffer.from(res.body.data.base64, 'base64')).toEqual(fixture.bytes);
    expect(res.body.data.filename).toBe('payslip.jpeg');
    expect(res.body.data.contentType).toBe('image/jpeg');
    // Somebody's identity document. A proxy keeping a copy would undo the move.
    expect(res.headers['cache-control']).toBe('private, no-store');
  });

  it('gives the landlord the applicant\'s document', async () => {
    const fixture = await seedApplicationWithDocument();

    const res = await request(authed(LANDLORD)).get(
      `/applications/${fixture.applicationId}/documents/${fixture.documentId}`,
    );

    expect(res.status).toBe(200);
    expect(Buffer.from(res.body.data.base64, 'base64')).toEqual(fixture.bytes);
  });

  it('gives a stranger a 404, not a 403', async () => {
    const fixture = await seedApplicationWithDocument();

    const res = await request(authed(STRANGER)).get(
      `/applications/${fixture.applicationId}/documents/${fixture.documentId}`,
    );

    // "There is an application here and you may not see it" is itself something
    // a stranger should not learn.
    expect(res.status).toBe(404);
    expect(res.text).not.toContain(fixture.bytes.toString('base64'));
  });

  it('refuses a document id from somebody else\'s application', async () => {
    const mine = await seedApplicationWithDocument();
    const theirs = await seedApplicationWithDocument();

    // The applicant of BOTH here, so authorization on the application passes
    // and only the parent check can refuse: knowing an id grants no access.
    const res = await request(authed(APPLICANT)).get(
      `/applications/${mine.applicationId}/documents/${theirs.documentId}`,
    );

    expect(res.status).toBe(404);
    expect(res.text).not.toContain(theirs.bytes.toString('base64'));
  });

  it('answers 404 when the row points at nothing we store', async () => {
    const fixture = await seedApplicationWithDocument();
    await getDb()
      .update(tenantApplicationDocuments)
      .set({ url: 'https://evil.example/somebody-elses.jpeg' })
      .where(eq(tenantApplicationDocuments.id, fixture.documentId));

    const res = await request(authed(APPLICANT)).get(
      `/applications/${fixture.applicationId}/documents/${fixture.documentId}`,
    );

    // A row is data. A parser that fell through to "treat the whole string as a
    // key" would let one name any object in the bucket.
    expect(res.status).toBe(404);
  });
});

describe('the wire shape no longer hands out a storage link', () => {

  it('serializes a path that needs the session, not a URL that does not', async () => {
    const fixture = await seedApplicationWithDocument();

    const res = await request(authed(LANDLORD)).get(`/applications/${fixture.applicationId}`);

    expect(res.status).toBe(200);
    const [document] = res.body.data.documents as Array<Record<string, unknown>>;
    expect(document.downloadPath).toBe(
      `/api/applications/${fixture.applicationId}/documents/${fixture.documentId}`,
    );
    // The storage URL is GONE from the payload, under any name. A landlord who
    // saved an old response still holds one; a landlord reading today does not.
    expect(JSON.stringify(res.body)).not.toContain('/api/images/file/');
    expect(JSON.stringify(res.body)).not.toContain(config.s3.bucketName || '__no_bucket__');
  });
});
