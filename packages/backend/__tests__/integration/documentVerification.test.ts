/**
 * Only the landlord verifies, and only through the server (#518 §7.4).
 *
 * §7.4: "Pulsar un botón no convierte localmente un documento en verificado."
 *
 * The rule is enforced in one place — the repository's WHERE — and these pin
 * both halves of it: who may write a verification, and what the database
 * refuses to store even if a caller got past the controller.
 *
 * Every refusal RE-READS the row, because a handler that 404s and writes anyway
 * satisfies any assertion made on its response alone.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { PropertyStatus } from '@homiio/shared-types';

import applicationController from '../../controllers/applicationController';
import { getDb } from '../../db/postgres';
import { properties, tenantApplicationDocuments, tenantApplications } from '../../db/schema';
import { errorHandler } from '../../middlewares/errorHandler';
import { objectIdHex, resetGeoTables, seedListingWithGeo } from '../helpers/postgresGeoFixtures';

const APPLICANT = 'oxy-applicant';
const LANDLORD = 'oxy-landlord';
const STRANGER = 'oxy-stranger';

function buildApp(oxyUserId: string): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const authed = req as unknown as { user: { id: string }; userId: string };
    authed.user = { id: oxyUserId };
    authed.userId = oxyUserId;
    next();
  });
  app.post('/applications/:id/documents/:documentId/verification', (req, res, next) =>
    applicationController.verifyApplicationDocument(req, res, next),
  );
  app.get('/applications/:id', (req, res, next) =>
    applicationController.getApplicationById(req, res, next),
  );
  app.use(errorHandler);
  return app;
}

let counter = 0;

async function seedApplication(required: string[] = ['id', 'income']) {
  counter += 1;
  const { propertyId } = await seedListingWithGeo({
    countryCode: `V${counter}`,
    cityName: `Verifyton ${counter}`,
    overrides: { status: PropertyStatus.PUBLISHED, oxyUserId: LANDLORD },
  });
  await getDb()
    .update(properties)
    .set({ applicationRequiredDocuments: required })
    .where(eq(properties.id, propertyId));

  const applicationId = objectIdHex();
  await getDb().insert(tenantApplications).values({
    id: applicationId,
    propertyId,
    applicantOxyUserId: APPLICANT,
    landlordOxyUserId: LANDLORD,
    moveInDate: new Date('2026-11-01T00:00:00.000Z'),
    leaseTermMonths: 12,
    monthlyIncome: 2400,
    employmentStatus: 'employed',
    status: 'submitted',
    submittedAt: new Date('2026-09-20T00:00:00.000Z'),
  });

  const documentId = objectIdHex();
  await getDb().insert(tenantApplicationDocuments).values({
    id: documentId,
    applicationId,
    type: 'income',
    url: 'https://api.homiio.test/api/images/file/applications/documents/x-original.jpeg',
    filename: 'payslip.jpeg',
  });

  return { applicationId, documentId, propertyId };
}

const documentRow = async (id: string) => {
  const [row] = await getDb()
    .select()
    .from(tenantApplicationDocuments)
    .where(eq(tenantApplicationDocuments.id, id))
    .limit(1);
  return row;
};

/**
 * Applications hold their property down — `tenant_applications.property_id` is
 * ON DELETE RESTRICT — so they go before the geo reset, and the suite leaves
 * the shared tables as it found them. A file that does not is a file that
 * breaks whichever suite the worker runs next, with the failure landing there
 * rather than here.
 */
async function reset(): Promise<void> {
  await getDb().delete(tenantApplications);
  await resetGeoTables();
}

beforeEach(reset);
afterAll(reset);

describe('who may verify', () => {
  it('lets the landlord, recording who and when', async () => {
    const fixture = await seedApplication();

    const res = await request(buildApp(LANDLORD))
      .post(`/applications/${fixture.applicationId}/documents/${fixture.documentId}/verification`)
      .send({ status: 'verified' });

    expect(res.status).toBe(200);
    const row = await documentRow(fixture.documentId);
    expect(row.verificationStatus).toBe('verified');
    // A tick nobody stands behind is the thing the CHECK exists to refuse.
    expect(row.verifiedByOxyUserId).toBe(LANDLORD);
    expect(row.verifiedAt).not.toBeNull();
  });

  it('refuses the APPLICANT, and writes nothing', async () => {
    const fixture = await seedApplication();

    const res = await request(buildApp(APPLICANT))
      .post(`/applications/${fixture.applicationId}/documents/${fixture.documentId}/verification`)
      .send({ status: 'verified' });

    // The person whose document it is cannot verify it. That is the whole rule:
    // a button on their screen must not be able to produce a tick.
    expect(res.status).toBe(404);
    expect((await documentRow(fixture.documentId)).verificationStatus).toBe('pending');
  });

  it('refuses a stranger, and writes nothing', async () => {
    const fixture = await seedApplication();

    const res = await request(buildApp(STRANGER))
      .post(`/applications/${fixture.applicationId}/documents/${fixture.documentId}/verification`)
      .send({ status: 'verified' });

    expect(res.status).toBe(404);
    expect((await documentRow(fixture.documentId)).verificationStatus).toBe('pending');
  });

  it('refuses a document id from another application', async () => {
    const mine = await seedApplication();
    const theirs = await seedApplication();

    // The landlord of BOTH, so ownership passes and only the parent scoping can
    // refuse: knowing an id grants nothing.
    const res = await request(buildApp(LANDLORD))
      .post(`/applications/${mine.applicationId}/documents/${theirs.documentId}/verification`)
      .send({ status: 'verified' });

    expect(res.status).toBe(404);
    expect((await documentRow(theirs.documentId)).verificationStatus).toBe('pending');
  });
});

describe('a rejection carries a reason', () => {
  it('refuses one without', async () => {
    const fixture = await seedApplication();

    const res = await request(buildApp(LANDLORD))
      .post(`/applications/${fixture.applicationId}/documents/${fixture.documentId}/verification`)
      .send({ status: 'rejected' });

    // A refusal with no reason tells an applicant that something is wrong and
    // not what to send instead.
    expect(res.status).toBe(400);
    expect((await documentRow(fixture.documentId)).verificationStatus).toBe('pending');
  });

  it('stores it, and clears it when the verdict changes', async () => {
    const fixture = await seedApplication();
    const app = buildApp(LANDLORD);
    const path = `/applications/${fixture.applicationId}/documents/${fixture.documentId}/verification`;

    await request(app).post(path).send({ status: 'rejected', reason: 'The photo is cut off' });
    expect((await documentRow(fixture.documentId)).rejectionReason).toBe('The photo is cut off');

    await request(app).post(path).send({ status: 'verified' });
    const row = await documentRow(fixture.documentId);
    // A reason on a verified document reads as a caveat on an approval, so the
    // CHECK refuses it and the write must clear it rather than rely on luck.
    expect(row.verificationStatus).toBe('verified');
    expect(row.rejectionReason).toBeNull();
  });

  it('clears the verifier when a decision is withdrawn', async () => {
    const fixture = await seedApplication();
    const app = buildApp(LANDLORD);
    const path = `/applications/${fixture.applicationId}/documents/${fixture.documentId}/verification`;

    await request(app).post(path).send({ status: 'verified' });
    await request(app).post(path).send({ status: 'pending' });

    const row = await documentRow(fixture.documentId);
    // A verifier on a `pending` row is a decision the status denies.
    expect(row.verificationStatus).toBe('pending');
    expect(row.verifiedByOxyUserId).toBeNull();
    expect(row.verifiedAt).toBeNull();
  });

  it('refuses a status nobody defined', async () => {
    const fixture = await seedApplication();

    const res = await request(buildApp(LANDLORD))
      .post(`/applications/${fixture.applicationId}/documents/${fixture.documentId}/verification`)
      .send({ status: 'approved_probably' });

    expect(res.status).toBe(400);
  });
});

describe('the checklist reaches the wire', () => {
  it('carries what the listing asked for AND what each document reached', async () => {
    const fixture = await seedApplication(['id', 'income']);
    await request(buildApp(LANDLORD))
      .post(`/applications/${fixture.applicationId}/documents/${fixture.documentId}/verification`)
      .send({ status: 'verified' });

    const res = await request(buildApp(APPLICANT)).get(`/applications/${fixture.applicationId}`);

    expect(res.status).toBe(200);
    // Both halves. Without the requirement list a screen can only report what
    // arrived, so nothing is ever missing.
    expect(res.body.data.requiredDocuments).toEqual(['id', 'income']);
    expect(res.body.data.documents[0].verification).toBe('verified');
  });

  it('reports an empty requirement list for a listing that asks for nothing', async () => {
    const fixture = await seedApplication([]);

    const res = await request(buildApp(APPLICANT)).get(`/applications/${fixture.applicationId}`);

    // Silence is not a demand, and it is not unknown either.
    expect(res.body.data.requiredDocuments).toEqual([]);
  });
});
