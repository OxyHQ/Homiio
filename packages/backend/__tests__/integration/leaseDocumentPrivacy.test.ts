/**
 * A tenancy contract is not a listing photo (#518 §7.4).
 *
 * ## The defect these pin
 *
 * `leaseService.uploadLeaseDocument` put the file through the ORDINARY image
 * pipeline (`leases/documents`) and posted the resulting
 * `<publicUrl>/api/images/file/<key>` back to `POST /api/leases/:id/documents`,
 * which stored whatever string arrived as `url`. That URL then went out in the
 * lease's own wire shape. The route it names is mounted on `routes/public.ts`:
 * no session, no viewer, a key in and bytes out, with a year of `public` cache
 * on the response.
 *
 * So the signed tenancy agreement, the inspection report that photographs the
 * inside of somebody's home and the insurance certificate were each a
 * permanent, cacheable, shareable link — held by every party, forwardable to
 * anyone, and readable by every proxy in between. The bucket has never been
 * public (`block_public_acls` in `oxy-infra/terraform-uswest2/s3-apps.tf`);
 * that route was the entire reason these objects were reachable.
 *
 * ## The two halves, and why both are needed
 *
 * Shutting the public door without opening an authorized one makes every lease
 * document unreachable; opening an authorized one without shutting the public
 * door fixes nothing, because the old URL keeps working. So:
 *
 *  - `GET /api/images/file/leases/documents/…` must **refuse**, for the objects
 *    ALREADY stored — no bytes move, only the door changes;
 *  - `GET /api/leases/:id/documents/:documentId` must serve, to the landlord,
 *    the tenant and a co-tenant, and to nobody else.
 *
 * Each case names the id or the bytes it expects rather than counting, because
 * "refused" and "served the wrong household's contract" are both non-200s to a
 * length check.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import express, { type Express } from 'express';
import multer from 'multer';
import request from 'supertest';
import { eq } from 'drizzle-orm';

import leaseController from '../../controllers/leaseController';
import imageController from '../../controllers/imageController';
import { getDb } from '../../db/postgres';
import { leaseCoTenants, leaseDocuments, leases } from '../../db/schema';
import { errorHandler } from '../../middlewares/errorHandler';
import imageUploadService, { LOCAL_IMAGE_STORE_DIR } from '../../services/imageUploadService';
import config from '../../config';
import { resetGeoTables, seedListingWithGeo } from '../helpers/postgresGeoFixtures';

const LANDLORD = 'oxy-landlord';
const TENANT = 'oxy-tenant';
const CO_TENANT = 'oxy-co-tenant';
const STRANGER = 'oxy-stranger';

/** Memory storage, as `routes/leases.ts` configures it. */
const documentUpload = multer({ storage: multer.memoryStorage() });

function authed(oxyUserId: string): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const withUser = req as unknown as { user: { id: string }; userId: string };
    withUser.user = { id: oxyUserId };
    withUser.userId = oxyUserId;
    next();
  });
  app.post('/leases', (req, res, next) => leaseController.createLease(req, res, next));
  app.get('/leases/:id', (req, res, next) => leaseController.getLeaseById(req, res, next));
  app.get('/leases/:id/documents/:documentId', (req, res, next) =>
    leaseController.getLeaseDocument(req, res, next),
  );
  app.post('/leases/:id/documents', documentUpload.single('document'), (req, res, next) =>
    leaseController.uploadLeaseDocument(req, res, next),
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
  leaseId: string;
  documentId: string;
  key: string;
  bytes: Buffer;
}

let counter = 0;

/** A lease with a co-tenant, plus one document stored the OLD way. */
async function seedLeaseWithDocument(): Promise<Fixture> {
  const { propertyId } = await seedListingWithGeo({
    countryCode: `L${counter}`,
    cityName: `Leaseville ${counter}`,
    overrides: { oxyUserId: LANDLORD },
  });
  counter += 1;

  const created = await request(authed(LANDLORD))
    .post('/leases')
    .send({
      propertyId,
      tenantOxyUserId: TENANT,
      coTenants: [{ oxyUserId: CO_TENANT }],
      leaseTerms: {
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-12-31T00:00:00.000Z',
      },
      rentDetails: { monthlyRent: 1200, currency: 'EUR', dueDate: 1, securityDeposit: 2400 },
    });
  expect(created.status).toBe(201);
  const leaseId: string = created.body.data.id;

  // A JPEG, because that is the only shape the old path could produce: the
  // picker was `MediaTypeOptions.Images` and the upload Sharp-processed the
  // buffer, so a scanned contract arrived as a photograph of one.
  const bytes = Buffer.from(`tenancy-agreement-${leaseId}`);
  const key = `leases/documents/${leaseId}-original.jpeg`;
  const url = await storeDocument(key, bytes);

  const [row] = await getDb()
    .insert(leaseDocuments)
    .values({
      leaseId,
      name: 'Tenancy agreement',
      url,
      type: 'lease_agreement',
      uploadedByOxyUserId: LANDLORD,
      uploadedDate: new Date('2026-01-02T00:00:00.000Z'),
    })
    .returning();

  return { leaseId, documentId: row.id, key, bytes };
}

/**
 * `leases.property_id` holds a property down, so the leases go before the geo
 * reset — the same order `leaseOwnership.test.ts` uses, for the same key.
 */
async function reset(): Promise<void> {
  await getDb().delete(leases);
  await resetGeoTables();
}

beforeEach(reset);
afterAll(reset);

describe('the public image route does not serve a tenancy contract', () => {
  it('refuses the key that used to work', async () => {
    const fixture = await seedLeaseWithDocument();

    const res = await request(publicImages()).get(`/images/file/${fixture.key}`);

    // Not a 404 and not the bytes: a flat refusal of the PREFIX, so the object
    // stays exactly where it is and only the door changes.
    expect(res.status).toBe(400);
    expect(res.text).not.toContain(fixture.bytes.toString());
  });

  it('refuses it however the key is spelled', async () => {
    const fixture = await seedLeaseWithDocument();
    const app = publicImages();

    for (const spelling of [
      `leases/./documents/${path.basename(fixture.key)}`,
      `property/../leases/documents/${path.basename(fixture.key)}`,
      `leases//documents/${path.basename(fixture.key)}`,
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
    const key = 'property/lease-floor-photo-original.jpeg';
    const bytes = Buffer.from('a listing photo');
    await storeDocument(key, bytes);

    const res = await request(publicImages()).get(`/images/file/${key}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(bytes);
  });
});

describe('the authorized route serves them, to the parties', () => {
  it.each([
    ['the landlord', LANDLORD],
    ['the tenant', TENANT],
    ['a co-tenant', CO_TENANT],
  ])('gives %s the document', async (_who, oxyUserId) => {
    const fixture = await seedLeaseWithDocument();

    const res = await request(authed(oxyUserId)).get(
      `/leases/${fixture.leaseId}/documents/${fixture.documentId}`,
    );

    expect(res.status).toBe(200);
    expect(Buffer.from(res.body.data.base64, 'base64')).toEqual(fixture.bytes);
    expect(res.body.data.contentType).toBe('image/jpeg');
    // The label is a name a person typed; the extension comes from what the
    // store actually returned, so the phone opens it with the right app.
    expect(res.body.data.filename).toBe('Tenancy agreement.jpeg');
    // It is a tenancy contract. A proxy keeping a copy would undo the move.
    expect(res.headers['cache-control']).toBe('private, no-store');
  });

  it('gives a stranger a 404, not a 403', async () => {
    const fixture = await seedLeaseWithDocument();

    const res = await request(authed(STRANGER)).get(
      `/leases/${fixture.leaseId}/documents/${fixture.documentId}`,
    );

    // "There is a tenancy here and you may not read it" is itself a fact about
    // two named people and an address.
    expect(res.status).toBe(404);
    expect(res.text).not.toContain(fixture.bytes.toString('base64'));
  });

  it("refuses a document id from somebody else's lease", async () => {
    const mine = await seedLeaseWithDocument();
    const theirs = await seedLeaseWithDocument();

    // The landlord of BOTH here, so authorization on the lease passes and only
    // the parent check can refuse: knowing an id grants no access.
    const res = await request(authed(LANDLORD)).get(
      `/leases/${mine.leaseId}/documents/${theirs.documentId}`,
    );

    expect(res.status).toBe(404);
    expect(res.text).not.toContain(theirs.bytes.toString('base64'));
  });

  it('answers 404 when the row points at nothing we store', async () => {
    const fixture = await seedLeaseWithDocument();
    await getDb()
      .update(leaseDocuments)
      .set({ url: 'https://evil.example/somebody-elses.jpeg' })
      .where(eq(leaseDocuments.id, fixture.documentId));

    const res = await request(authed(TENANT)).get(
      `/leases/${fixture.leaseId}/documents/${fixture.documentId}`,
    );

    // A row is data. A parser that fell through to "treat the whole string as a
    // key" would let one name any object in the bucket.
    expect(res.status).toBe(404);
  });

  it('refuses a co-tenant who was removed from the lease', async () => {
    const fixture = await seedLeaseWithDocument();
    await getDb().delete(leaseCoTenants).where(eq(leaseCoTenants.leaseId, fixture.leaseId));

    const res = await request(authed(CO_TENANT)).get(
      `/leases/${fixture.leaseId}/documents/${fixture.documentId}`,
    );

    // Membership is read at request time from `lease_co_tenants`, not inferred
    // from ever having been on it.
    expect(res.status).toBe(404);
  });
});

describe('the wire shape no longer hands out a storage link', () => {
  it('serializes a path that needs the session, not a URL that does not', async () => {
    const fixture = await seedLeaseWithDocument();

    const res = await request(authed(TENANT)).get(`/leases/${fixture.leaseId}`);

    expect(res.status).toBe(200);
    const [document] = res.body.data.documents as Array<Record<string, unknown>>;
    expect(document.downloadPath).toBe(
      `/api/leases/${fixture.leaseId}/documents/${fixture.documentId}`,
    );
    expect(document.url).toBeUndefined();
    // The storage URL is GONE from the payload, under any name. A tenant who
    // saved an old response still holds one; a tenant reading today does not.
    expect(JSON.stringify(res.body)).not.toContain('/api/images/file/');
    expect(JSON.stringify(res.body)).not.toContain(config.s3.bucketName || '__no_bucket__');
  });
});

describe('a lease document can be a PDF, and the client no longer names where it lives', () => {
  async function seedLease(): Promise<string> {
    const fixture = await seedLeaseWithDocument();
    await getDb().delete(leaseDocuments).where(eq(leaseDocuments.leaseId, fixture.leaseId));
    return fixture.leaseId;
  }

  it('stores a PDF byte for byte and serves it back', async () => {
    const leaseId = await seedLease();
    // Not a real PDF, but PDF-shaped: the point is that whatever goes in comes
    // back unchanged. Sharp would have thrown on this, which is why the upload
    // path splits on the type rather than re-encoding everything.
    const pdf = Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\nthe signed agreement', 'binary');

    const created = await request(authed(LANDLORD))
      .post(`/leases/${leaseId}/documents`)
      .field('name', 'Signed agreement')
      .field('type', 'lease_agreement')
      .attach('document', pdf, { filename: 'contract.pdf', contentType: 'application/pdf' });

    expect(created.status).toBe(201);
    const documentId: string = created.body.data.id;
    expect(created.body.data.downloadPath).toBe(
      `/api/leases/${leaseId}/documents/${documentId}`,
    );
    expect(JSON.stringify(created.body)).not.toContain('/api/images/file/');

    const fetched = await request(authed(TENANT)).get(
      `/leases/${leaseId}/documents/${documentId}`,
    );
    expect(fetched.status).toBe(200);
    expect(fetched.body.data.contentType).toBe('application/pdf');
    expect(Buffer.from(fetched.body.data.base64, 'base64')).toEqual(pdf);
    expect(fetched.body.data.filename).toBe('Signed agreement.pdf');
  });

  it('stores it under a private key the public route refuses', async () => {
    const leaseId = await seedLease();

    await request(authed(LANDLORD))
      .post(`/leases/${leaseId}/documents`)
      .field('name', 'Insurance')
      .attach('document', Buffer.from('%PDF-1.7 policy'), {
        filename: 'policy.pdf',
        contentType: 'application/pdf',
      });

    const [row] = await getDb()
      .select()
      .from(leaseDocuments)
      .where(eq(leaseDocuments.leaseId, leaseId));
    expect(row.url).toContain(`/api/images/file/private/leases/${leaseId}/`);

    const key = row.url.slice(row.url.indexOf('/api/images/file/') + '/api/images/file/'.length);
    const res = await request(publicImages()).get(`/images/file/${key}`);
    // The new objects are private by their KEY, so they never depend on the
    // `leases/documents/` entry that covers the ones already stored.
    expect(res.status).toBe(400);
  });

  it('refuses a request that carries no file at all', async () => {
    const leaseId = await seedLease();

    const res = await request(authed(LANDLORD))
      .post(`/leases/${leaseId}/documents`)
      .field('name', 'Nothing')
      .field('url', 'https://evil.example/whatever.pdf');

    // The old endpoint would have taken that `url` and stored it. There is no
    // longer a way to tell this endpoint where a document lives.
    expect(res.status).toBe(400);
    expect(
      await getDb().select().from(leaseDocuments).where(eq(leaseDocuments.leaseId, leaseId)),
    ).toHaveLength(0);
  });

  it('never lets a stranger put an object in the bucket', async () => {
    const leaseId = await seedLease();

    const res = await request(authed(STRANGER))
      .post(`/leases/${leaseId}/documents`)
      .field('name', 'Not mine')
      .attach('document', Buffer.from('%PDF-1.7 intruder'), {
        filename: 'intruder.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(403);
    expect(
      await getDb().select().from(leaseDocuments).where(eq(leaseDocuments.leaseId, leaseId)),
    ).toHaveLength(0);
  });
});
