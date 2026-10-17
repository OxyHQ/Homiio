/**
 * Moving private documents off Homiio's bucket into their owners' Oxy accounts
 * (ADR 0043 stage 4c; `services/files/privateDocumentMigration.ts`), against
 * the REAL Postgres and the in-memory Oxy.
 *
 * What has a way to be wrong and look fine:
 *
 * - **An Oxy that stores but cannot hand back.** Before stage 4c an upload
 *   into a person's account succeeds, but Homiio has no consent to read it.
 *   Switching the row then would turn a readable document into a 404 for
 *   every party. So the row moves only after a read-back, and a refused
 *   read-back leaves it on the bucket.
 * - **A signed lease document.** Its signatures are bound to a SHA-256; bytes
 *   that no longer hash to it must not become the document.
 * - **An applicant's own link.** A row that names nothing Homiio stores never
 *   moves, and must not hold the bucket's retirement hostage.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';

import applicationController from '../../controllers/applicationController';
import leaseController from '../../controllers/leaseController';
import { getDb } from '../../db/postgres';
import {
  fileReferenceChanges,
  leaseDocuments,
  leases,
  tenantApplicationDocuments,
  tenantApplications,
} from '../../db/schema';
import { errorHandler } from '../../middlewares/errorHandler';
import { legacyImageUrl } from '../../services/files/legacyImages';
import { legacyObjectStore } from '../../services/files/legacyObjectStore';
import {
  countLegacyPrivateDocuments,
  findLegacyPrivateDocuments,
  migratePrivateDocument,
} from '../../services/files/privateDocumentMigration';
import { fakeOxyFiles } from '../helpers/fakeOxyFiles';
import { objectIdHex, resetGeoTables, seedListingWithGeo } from '../helpers/postgresGeoFixtures';

const LANDLORD = 'oxy-landlord';
const TENANT = 'oxy-tenant';
const APPLICANT = 'oxy-applicant';

function authed(oxyUserId: string): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const withUser = req as unknown as { user: { id: string }; userId: string };
    withUser.user = { id: oxyUserId };
    withUser.userId = oxyUserId;
    next();
  });
  app.get('/leases/:id/documents/:documentId', (req, res, next) =>
    leaseController.getLeaseDocument(req, res, next),
  );
  app.get('/applications/:id/documents/:documentId', (req, res, next) =>
    applicationController.getApplicationDocument(req, res, next),
  );
  app.use(errorHandler);
  return app;
}

let counter = 0;

async function listing(prefix: string): Promise<string> {
  counter += 1;
  const { propertyId } = await seedListingWithGeo({
    countryCode: `${prefix}${counter}`,
    cityName: `Movetown ${prefix}${counter}`,
    overrides: { oxyUserId: LANDLORD },
  });
  return propertyId;
}

/** A lease with one document stored the OLD way, in the bucket. */
async function legacyLeaseDocument(options: { sha256?: string } = {}) {
  const propertyId = await listing('M');
  const [lease] = await getDb()
    .insert(leases)
    .values({
      id: objectIdHex(),
      propertyId,
      landlordOxyUserId: LANDLORD,
      tenantOxyUserId: TENANT,
      status: 'active',
      leaseTermsStartDate: new Date('2026-01-01T00:00:00.000Z'),
      leaseTermsEndDate: new Date('2027-01-01T00:00:00.000Z'),
      rentDetailsMonthlyRent: 900,
    })
    .returning({ id: leases.id });
  const bytes = Buffer.from(`%PDF-1.7 agreement ${lease.id}`);
  const key = `private/leases/${lease.id}/${objectIdHex()}.pdf`;
  await legacyObjectStore().putPrivate(key, bytes, 'application/pdf');
  const [row] = await getDb()
    .insert(leaseDocuments)
    .values({
      leaseId: lease.id,
      name: 'Agreement',
      url: legacyImageUrl(key),
      type: 'lease_agreement',
      uploadedByOxyUserId: LANDLORD,
      uploadedDate: new Date('2026-01-02T00:00:00.000Z'),
      ...(options.sha256 ? { contentSha256: options.sha256 } : {}),
    })
    .returning();
  return { leaseId: lease.id, documentId: row.id, url: row.url, bytes };
}

/** An application with one uploaded document and one link the applicant supplied. */
async function legacyApplication() {
  const propertyId = await listing('N');
  const applicationId = objectIdHex();
  await getDb()
    .insert(tenantApplications)
    .values({
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
  const bytes = Buffer.from(`payslip ${applicationId}`);
  const key = `private/applications/${applicationId}/${objectIdHex()}.webp`;
  await legacyObjectStore().putPrivate(key, bytes, 'image/webp');
  const uploaded = objectIdHex();
  const linked = objectIdHex();
  await getDb()
    .insert(tenantApplicationDocuments)
    .values([
      { id: uploaded, applicationId, type: 'income', url: legacyImageUrl(key), filename: 'p.webp' },
      {
        id: linked,
        applicationId,
        type: 'reference',
        url: 'https://references.example/letter.pdf',
        filename: 'letter.pdf',
      },
    ]);
  return { applicationId, uploaded, linked, bytes };
}

async function moveAll(table: 'lease_documents' | 'tenant_application_documents') {
  const rows = await findLegacyPrivateDocuments(table, null, 1000);
  return Promise.all(rows.map((row) => migratePrivateDocument(row)));
}

beforeEach(async () => {
  fakeOxyFiles.reset();
  await getDb().delete(leases);
  await getDb().delete(tenantApplications);
  await getDb().delete(fileReferenceChanges);
  await resetGeoTables();
});

// Leave the shared per-worker tables as this file found them: a lease or an
// application left behind holds a property down for the next file's reset.
afterAll(async () => {
  await getDb().delete(leases);
  await getDb().delete(tenantApplications);
  await getDb().delete(fileReferenceChanges);
  await resetGeoTables();
});

describe('a lease document', () => {
  it('moves into the uploader’s Oxy account as a private file and still reads, byte for byte', async () => {
    const doc = await legacyLeaseDocument();

    const [line] = await moveAll('lease_documents');

    expect(line).toMatchObject({
      table: 'lease_documents',
      id: doc.documentId,
      outcome: 'migrated',
    });
    const [row] = await getDb()
      .select()
      .from(leaseDocuments)
      .where(eq(leaseDocuments.id, doc.documentId));
    expect(row.url).toMatch(/^oxy:/);
    expect(fakeOxyFiles.files.get(row.url.slice(4))).toMatchObject({
      ownerUserId: LANDLORD,
      visibility: 'private',
      mime: 'application/pdf',
    });
    const res = await request(authed(TENANT)).get(
      `/leases/${doc.leaseId}/documents/${doc.documentId}`,
    );
    expect(res.status).toBe(200);
    expect(Buffer.from(res.body.data.base64, 'base64').equals(doc.bytes)).toBe(true);
    // The row is now a use of the file: marked for the drain.
    const marks = await getDb()
      .select()
      .from(fileReferenceChanges)
      .where(eq(fileReferenceChanges.oxyFileId, row.url.slice(4)));
    expect(marks.map((mark) => [mark.entityType, mark.entityId])).toEqual([['lease', doc.leaseId]]);
    // And it is never selected again.
    expect(await findLegacyPrivateDocuments('lease_documents', null, 10)).toEqual([]);
  });

  it('keeps the digest a signature is bound to, and refuses bytes that lost it', async () => {
    const doc = await legacyLeaseDocument({ sha256: 'f'.repeat(64) });

    const [line] = await moveAll('lease_documents');

    expect(line.outcome).toBe('hash_mismatch');
    const [row] = await getDb()
      .select()
      .from(leaseDocuments)
      .where(eq(leaseDocuments.id, doc.documentId));
    expect(row.url).toBe(doc.url);
    expect(fakeOxyFiles.callsOf('uploadUserMediaLarge')).toHaveLength(0);
  });

  it('stays on the bucket when Oxy will not hand it back (no stage 4c)', async () => {
    const doc = await legacyLeaseDocument();
    fakeOxyFiles.consentReadUnavailable = true;

    const [line] = await moveAll('lease_documents');

    expect(line.outcome).toBe('read_back_refused');
    const [row] = await getDb()
      .select()
      .from(leaseDocuments)
      .where(eq(leaseDocuments.id, doc.documentId));
    expect(row.url).toBe(doc.url);
    const res = await request(authed(TENANT)).get(
      `/leases/${doc.leaseId}/documents/${doc.documentId}`,
    );
    expect(res.status).toBe(200);
  });

  it('reports an object the bucket no longer has, and moves nothing', async () => {
    const doc = await legacyLeaseDocument();
    const key = doc.url.slice(doc.url.indexOf('/api/images/file/') + '/api/images/file/'.length);
    await legacyObjectStore().delete(key);

    const [line] = await moveAll('lease_documents');

    expect(line.outcome).toBe('missing_object');
  });
});

describe('an application document', () => {
  it('becomes the applicant’s file; the applicant’s own link never moves', async () => {
    const app = await legacyApplication();

    const before = await countLegacyPrivateDocuments();
    expect(before.find((count) => count.table === 'tenant_application_documents')).toEqual({
      table: 'tenant_application_documents',
      onBucket: 1,
      notStoredHere: 1,
    });

    const lines = await moveAll('tenant_application_documents');

    expect(Object.fromEntries(lines.map((line) => [line.id, line.outcome]))).toEqual({
      [app.uploaded]: 'migrated',
      [app.linked]: 'not_stored_here',
    });
    const [row] = await getDb()
      .select()
      .from(tenantApplicationDocuments)
      .where(eq(tenantApplicationDocuments.id, app.uploaded));
    expect(fakeOxyFiles.files.get(row.url.slice(4))?.ownerUserId).toBe(APPLICANT);
    const res = await request(authed(LANDLORD)).get(
      `/applications/${app.applicationId}/documents/${app.uploaded}`,
    );
    expect(res.status).toBe(200);

    const after = await countLegacyPrivateDocuments();
    expect(after.find((count) => count.table === 'tenant_application_documents')).toEqual({
      table: 'tenant_application_documents',
      onBucket: 0,
      notStoredHere: 1,
    });
  });

  it('no longer reads once the applicant revokes Homiio', async () => {
    const app = await legacyApplication();
    await moveAll('tenant_application_documents');
    const [row] = await getDb()
      .select()
      .from(tenantApplicationDocuments)
      .where(eq(tenantApplicationDocuments.id, app.uploaded));

    fakeOxyFiles.revokeAccess(row.url.slice(4));

    const res = await request(authed(LANDLORD)).get(
      `/applications/${app.applicationId}/documents/${app.uploaded}`,
    );
    expect(res.status).toBe(404);
  });
});
