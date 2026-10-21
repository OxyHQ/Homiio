/**
 * No request to the API carries more than `UPLOAD_REQUEST_MAX_BYTES`, and the
 * multi-file uploads still arrive whole.
 *
 * The API is going behind a proxy that refuses bodies over 100 MB, and two
 * routes accepted ten 10 MB files in ONE request. What these pin:
 *
 *  - a request DECLARING more than the budget is refused 413 with a JSON body
 *    before any byte is read, and the route behind it never runs;
 *  - after multer, files that TOTAL more than the budget are refused 413 too
 *    (a chunked body declares no length);
 *  - `planUploadBatches` — what the app splits a set with — never plans a
 *    request over the budget and keeps the order;
 *  - an application's documents that do not fit one request are attached to it
 *    afterwards through the real router: by its applicant only (404 for anyone
 *    else), only while it is pending, never past ten in all — and a refused
 *    attach stores nothing in Oxy.
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';

import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import {
  APPLICATION_DOCUMENT_MAX_BYTES,
  APPLICATION_DOCUMENT_MAX_COUNT,
  IMAGE_UPLOAD_MAX_FILE_BYTES,
  IMAGE_UPLOAD_MAX_FILES_PER_REQUEST,
  UPLOAD_REQUEST_ENVELOPE_BYTES,
  UPLOAD_REQUEST_MAX_BYTES,
  planUploadBatches,
} from '@homiio/shared-types';

import createApplicationRoutes from '../../routes/applications';
import { getDb } from '../../db/postgres';
import { tenantApplicationDocuments, tenantApplications } from '../../db/schema';
import { errorHandler } from '../../middlewares/errorHandler';
import { rejectOversizedRequest, requireFilesWithinBudget } from '../../middlewares/uploadBudget';
import { fakeOxyFiles } from '../helpers/fakeOxyFiles';
import { resetGeoTables, seedListingWithGeo } from '../helpers/postgresGeoFixtures';

const MIB = 1024 * 1024;
const LANDLORD = 'oxy-budget-landlord';
const APPLICANT = 'oxy-budget-applicant';
const STRANGER = 'oxy-budget-stranger';

// ── The declared length ────────────────────────────────────────────────────

describe('rejectOversizedRequest', () => {
  let server: http.Server;
  let reached = 0;

  beforeAll(async () => {
    const app = express();
    app.use(rejectOversizedRequest);
    app.post('/upload', (req, res) => {
      reached += 1;
      req.resume();
      req.on('end', () => res.status(200).json({ ok: true }));
    });
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  /** Send only the headers: a refusal must come without the body being read. */
  function declare(length: number): Promise<{ status: number; body: Record<string, unknown> }> {
    const { port } = server.address() as AddressInfo;
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          method: 'POST',
          path: '/upload',
          headers: {
            'Content-Type': 'multipart/form-data; boundary=x',
            'Content-Length': String(length),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            req.destroy();
            resolve({
              status: res.statusCode ?? 0,
              body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>,
            });
          });
        },
      );
      req.on('error', reject);
      req.flushHeaders();
    });
  }

  it('answers 413 JSON to a declared length over the budget, without running the route', async () => {
    reached = 0;
    const res = await declare(UPLOAD_REQUEST_MAX_BYTES + 1);
    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({
      success: false,
      error: { code: 'PAYLOAD_TOO_LARGE', statusCode: 413 },
    });
    expect(typeof res.body.message).toBe('string');
    expect(reached).toBe(0);
  });

  it('lets a request under the budget through', async () => {
    const res = await request(server)
      .post('/upload')
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.alloc(1024));
    expect(res.status).toBe(200);
  });
});

// ── The received total ─────────────────────────────────────────────────────

describe('requireFilesWithinBudget', () => {
  function run(files: { size: number }[]): { status: number; nextCalled: boolean } {
    let status = 0;
    let nextCalled = false;
    const res = {
      setHeader: () => res,
      status(code: number) {
        status = code;
        return res;
      },
      json: () => res,
    } as unknown as Response;
    requireFilesWithinBudget({ files } as unknown as Request, res, (() => {
      nextCalled = true;
    }) as NextFunction);
    return { status, nextCalled };
  }

  it('passes files that total at most the budget', () => {
    expect(run([{ size: UPLOAD_REQUEST_MAX_BYTES }])).toEqual({ status: 0, nextCalled: true });
    expect(run([])).toEqual({ status: 0, nextCalled: true });
  });

  it('refuses files that total more, which ten 10 MB files do', () => {
    const tenFull = Array.from({ length: 10 }, () => ({ size: IMAGE_UPLOAD_MAX_FILE_BYTES }));
    expect(run(tenFull)).toEqual({ status: 413, nextCalled: false });
  });
});

// ── The plan the app sends ─────────────────────────────────────────────────

describe('planUploadBatches', () => {
  const limits = {
    maxFileBytes: IMAGE_UPLOAD_MAX_FILE_BYTES,
    maxFilesPerRequest: IMAGE_UPLOAD_MAX_FILES_PER_REQUEST,
  };
  const fileBudget = UPLOAD_REQUEST_MAX_BYTES - UPLOAD_REQUEST_ENVELOPE_BYTES;

  it('sends a set that fits in one request', () => {
    const sizes = Array.from({ length: 10 }, () => 3 * MIB);
    expect(planUploadBatches(sizes, (size) => size, limits)).toEqual([sizes]);
  });

  it('splits ten full-size files, in order, each request within the budget', () => {
    const items = Array.from({ length: 10 }, (_, index) => ({ index, size: 10 * MIB }));
    const batches = planUploadBatches(items, (item) => item.size, limits);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flat().map((item) => item.index)).toEqual(items.map((item) => item.index));
    for (const batch of batches) {
      expect(batch.reduce((sum, item) => sum + item.size, 0)).toBeLessThanOrEqual(fileBudget);
    }
  });

  it('plans a file of unknown size at the per-file cap', () => {
    const unknown = Array.from({ length: 10 }, () => undefined);
    const batches = planUploadBatches(unknown, (size) => size, limits);
    for (const batch of batches) {
      expect(batch.length * IMAGE_UPLOAD_MAX_FILE_BYTES).toBeLessThanOrEqual(fileBudget);
    }
    expect(batches.flat()).toHaveLength(10);
  });

  it('never puts more files in a request than the route accepts', () => {
    const tiny = Array.from({ length: 25 }, () => 1);
    const batches = planUploadBatches(tiny, (size) => size, limits);
    expect(batches.map((batch) => batch.length)).toEqual([10, 10, 5]);
  });
});

// ── An application's documents, across requests ───────────────────────────

let countryCounter = 0;

async function seedRental(): Promise<string> {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const { propertyId } = await seedListingWithGeo({
    countryCode: `U${alphabet[countryCounter++ % 26]}`,
    overrides: {
      oxyUserId: LANDLORD,
      status: 'published',
      isExternal: false,
      offerings: ['long_term_rent'],
      longTermRentMonthlyAmount: 1200,
      longTermRentCurrency: 'EUR',
    },
  });
  return propertyId;
}

function appAs(oxyUserId: string): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const withUser = req as unknown as { user: { id: string }; userId: string };
    withUser.user = { id: oxyUserId };
    withUser.userId = oxyUserId;
    next();
  });
  app.use('/applications', createApplicationRoutes());
  app.use(errorHandler);
  return app;
}

/** A small PDF-typed document; its bytes are stored as-is. */
function pdf(label: string): Buffer {
  return Buffer.from(`%PDF-1.4\n% ${label}\n`);
}

async function submitWith(propertyId: string, count: number): Promise<request.Response> {
  let req = request(appAs(APPLICANT))
    .post('/applications')
    .field('propertyId', propertyId)
    .field('moveInDate', '2026-12-01')
    .field('leaseTermMonths', '12')
    .field('monthlyIncome', '3800')
    .field('employmentStatus', 'employed')
    .field('documentTypes', JSON.stringify(Array.from({ length: count }, () => 'income')));
  for (let i = 0; i < count; i += 1) {
    req = req.attach('documents', pdf(`submit-${i}`), {
      filename: `payslip-${i}.pdf`,
      contentType: 'application/pdf',
    });
  }
  return req;
}

function attachAs(
  oxyUserId: string,
  applicationId: string,
  count: number,
  type = 'id',
): request.Test {
  let req = request(appAs(oxyUserId))
    .post(`/applications/${applicationId}/documents`)
    .field('documentTypes', JSON.stringify(Array.from({ length: count }, () => type)));
  for (let i = 0; i < count; i += 1) {
    req = req.attach('documents', pdf(`more-${i}`), {
      filename: `more-${i}.pdf`,
      contentType: 'application/pdf',
    });
  }
  return req;
}

async function documentCount(applicationId: string): Promise<number> {
  const rows = await getDb()
    .select({ id: tenantApplicationDocuments.id })
    .from(tenantApplicationDocuments)
    .where(eq(tenantApplicationDocuments.applicationId, applicationId));
  return rows.length;
}

describe('POST /applications/:id/documents', () => {
  beforeEach(async () => {
    fakeOxyFiles.reset();
    await getDb().delete(tenantApplications);
    await resetGeoTables();
  });

  afterAll(async () => {
    await getDb().delete(tenantApplications);
    await resetGeoTables();
  });

  it('shares the per-document limits with the app', () => {
    expect(APPLICATION_DOCUMENT_MAX_BYTES).toBe(10 * MIB);
    expect(APPLICATION_DOCUMENT_MAX_COUNT).toBe(10);
  });

  it("attaches the rest of a submission's documents, privately, and answers the whole application", async () => {
    const propertyId = await seedRental();
    const submitted = await submitWith(propertyId, 2);
    expect(submitted.status).toBe(201);
    const id = submitted.body.data.id as string;

    const res = await attachAs(APPLICANT, id, 3);
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(id);
    expect(res.body.data.documents).toHaveLength(5);
    expect(
      (res.body.data.documents as { type: string }[]).filter((doc) => doc.type === 'id'),
    ).toHaveLength(3);
    expect(await documentCount(id)).toBe(5);

    const rows = await getDb()
      .select()
      .from(tenantApplicationDocuments)
      .where(eq(tenantApplicationDocuments.applicationId, id));
    for (const row of rows) {
      expect(row.url).toMatch(/^oxy:/);
      expect(fakeOxyFiles.files.get(row.url.slice(4))).toMatchObject({
        ownerUserId: APPLICANT,
        visibility: 'private',
      });
    }
  });

  it('is the applicant’s alone: the landlord and a stranger get 404 and store nothing', async () => {
    const propertyId = await seedRental();
    const id = (await submitWith(propertyId, 1)).body.data.id as string;
    const stored = fakeOxyFiles.files.size;

    for (const who of [LANDLORD, STRANGER]) {
      const res = await attachAs(who, id, 1);
      expect(res.status).toBe(404);
    }
    expect(await documentCount(id)).toBe(1);
    expect(fakeOxyFiles.files.size).toBe(stored);
  });

  it('refuses once the application is no longer pending', async () => {
    const propertyId = await seedRental();
    const id = (await submitWith(propertyId, 1)).body.data.id as string;
    await getDb()
      .update(tenantApplications)
      .set({ status: 'withdrawn', decidedAt: new Date() })
      .where(eq(tenantApplications.id, id));

    const res = await attachAs(APPLICANT, id, 1);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_STATE');
    expect(await documentCount(id)).toBe(1);
  });

  it('never lets an application hold more than ten documents, and stores nothing when it refuses', async () => {
    const propertyId = await seedRental();
    const id = (await submitWith(propertyId, 7)).body.data.id as string;
    const stored = fakeOxyFiles.files.size;

    const over = await attachAs(APPLICANT, id, 4);
    expect(over.status).toBe(400);
    expect(over.body.error.code).toBe('TOO_MANY_FILES');
    expect(fakeOxyFiles.files.size).toBe(stored);

    const fits = await attachAs(APPLICANT, id, 3);
    expect(fits.status).toBe(201);
    expect(await documentCount(id)).toBe(10);
  });

  it('refuses a request with no documents, or types that do not match them', async () => {
    const propertyId = await seedRental();
    const id = (await submitWith(propertyId, 1)).body.data.id as string;

    const none = await request(appAs(APPLICANT))
      .post(`/applications/${id}/documents`)
      .field('documentTypes', '[]');
    expect(none.status).toBe(400);

    const mismatched = await request(appAs(APPLICANT))
      .post(`/applications/${id}/documents`)
      .field('documentTypes', JSON.stringify(['id', 'income']))
      .attach('documents', pdf('one'), { filename: 'one.pdf', contentType: 'application/pdf' });
    expect(mismatched.status).toBe(400);
    expect(mismatched.body.error.code).toBe('INVALID_DOCUMENT_TYPES');
    expect(await documentCount(id)).toBe(1);
  });
});
