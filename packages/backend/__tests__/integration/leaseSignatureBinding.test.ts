/**
 * A signature binds to what was signed, and the timeline is made of events
 * (#518 §7.4, #519 §7.4), against the REAL Postgres.
 *
 * ## What has a way to be wrong
 *
 *  - **A binding that does not bind.** A signature naming a document proves
 *    nothing if the digest can be invented, copied from another document or
 *    left behind when the bytes change. Each of those is asserted as a REFUSAL
 *    by the database, not by a caller.
 *  - **The lease activating too early.** Co-tenants sign now, so a lease that
 *    went `active` on the two principals alone would call itself active while a
 *    named tenant had not signed. Every activation case re-reads the row.
 *  - **The cache drifting from the truth.** `leases.signatures_*` and
 *    `lease_co_tenants.status` are derived from `lease_signatures`; every
 *    signing path re-reads both and compares.
 *  - **Two people signing at once.** Without the row lock each transaction
 *    reads a set of signatures without the other's and neither activates, which
 *    a `Promise.all` of two supertest requests does NOT reliably reproduce. The
 *    case below forces the interleaving with a held-open transaction, the
 *    pattern `leasePaymentLedger.test.ts` established.
 *  - **The timeline claiming something that did not happen.** Positions are
 *    read back as NUMBERS — `coalesce(max(position), 0) + 1` computed in
 *    JavaScript reads `int8` as a string and appends `'1' + 1 = '11'`, which a
 *    test appending once cannot see.
 *
 * Every authorization refusal RE-READS the table, because a handler that 403s
 * or 404s and writes anyway satisfies any assertion made on its response alone.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { and, eq, sql } from 'drizzle-orm';
import {
  CHECK_VIOLATION,
  FOREIGN_KEY_VIOLATION,
  constraintNameOf,
  sqlStateOf,
} from '@oxy.so/db';
import { LeaseStatus, PropertyStatus } from '@homiio/shared-types';

import leaseController from '../../controllers/leaseController';
import { getDb } from '../../db/postgres';
import { leaseTermsFingerprint } from '../../db/leases/leaseTerms';
import { findLeaseById, signLease } from '../../db/leases/leaseReads';
import {
  leaseCoTenants,
  leaseDocuments,
  leaseEvents,
  leasePaymentSchedule,
  leaseSignatures,
  leases,
} from '../../db/schema';
import { errorHandler } from '../../middlewares/errorHandler';
import { resetGeoTables, seedListingWithGeo } from '../helpers/postgresGeoFixtures';

const LANDLORD = 'oxy-landlord';
const TENANT = 'oxy-tenant';
const CO_TENANT = 'oxy-co-tenant';
const STRANGER = 'oxy-stranger';

/** The statuses a signature may still move, as `leaseController` declares them. */
const SIGNABLE = [LeaseStatus.DRAFT, LeaseStatus.PENDING_SIGNATURES] as const;

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);

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
  app.put('/leases/:id', (req, res, next) => leaseController.updateLease(req, res, next));
  app.delete('/leases/:id', (req, res, next) => leaseController.deleteLease(req, res, next));
  app.post('/leases/:id/sign', (req, res, next) => leaseController.signLease(req, res, next));
  app.post('/leases/:id/terminate', (req, res, next) =>
    leaseController.terminateLease(req, res, next),
  );
  app.use(errorHandler);
  return app;
}

let counter = 0;

interface Fixture {
  leaseId: string;
  propertyId: string;
}

/** A draft lease. `coTenants` defaults to none. */
async function seedLease(coTenants: string[] = []): Promise<Fixture> {
  counter += 1;
  const { propertyId } = await seedListingWithGeo({
    countryCode: `S${counter.toString().padStart(2, '0')}`,
    cityName: `Signville ${counter}`,
    overrides: { status: PropertyStatus.PUBLISHED, oxyUserId: LANDLORD },
  });
  const created = await request(authed(LANDLORD))
    .post('/leases')
    .send({
      propertyId,
      tenantOxyUserId: TENANT,
      coTenants: coTenants.map((oxyUserId) => ({ oxyUserId })),
      leaseTerms: { startDate: '2026-01-01T00:00:00.000Z', endDate: '2026-12-31T00:00:00.000Z' },
      rentDetails: { monthlyRent: 1200, currency: 'EUR', dueDate: 1, securityDeposit: 2400 },
    });
  expect(created.status).toBe(201);
  return { leaseId: created.body.data.id, propertyId };
}

/** Attach a document directly, with or without a content digest. */
async function seedDocument(
  leaseId: string,
  options: { type?: 'lease_agreement' | 'addendum'; sha256?: string | null; name?: string } = {},
): Promise<{ id: string; name: string }> {
  const [row] = await getDb()
    .insert(leaseDocuments)
    .values({
      leaseId,
      name: options.name ?? 'Tenancy agreement.pdf',
      url: `https://example.invalid/private/leases/${leaseId}/${counter}.pdf`,
      type: options.type ?? 'lease_agreement',
      uploadedByOxyUserId: LANDLORD,
      uploadedDate: new Date('2026-01-02T00:00:00.000Z'),
      contentSha256: options.sha256 === undefined ? DIGEST_A : options.sha256,
    })
    .returning({ id: leaseDocuments.id, name: leaseDocuments.name });
  return row;
}

const sign = (leaseId: string, as: string, body: Record<string, unknown> = {}) =>
  request(authed(as)).post(`/leases/${leaseId}/sign`).send({ acceptTerms: true, ...body });

const signaturesOf = (leaseId: string) =>
  getDb().select().from(leaseSignatures).where(eq(leaseSignatures.leaseId, leaseId));

const eventsOf = (leaseId: string) =>
  getDb()
    .select()
    .from(leaseEvents)
    .where(eq(leaseEvents.leaseId, leaseId))
    .orderBy(leaseEvents.position);

/**
 * The SQLSTATE, constraint name and message of whatever `run` threw.
 *
 * Drizzle wraps the driver failure, so `code` and `constraint_name` live on
 * `cause` and the message it prints is its own `Failed query: …`. Matching on
 * that message would pass against ANY failure of the same statement — which is
 * exactly the check that cannot distinguish success from failure. `@oxy.so/db`
 * walks the chain.
 */
async function violation(
  run: () => Promise<unknown>,
): Promise<{ state?: string; constraint?: string; message: string }> {
  try {
    await run();
    return { message: '(no error)' };
  } catch (error) {
    return {
      state: sqlStateOf(error),
      constraint: constraintNameOf(error),
      // `cause` is not on this tsconfig's `Error` lib, and it is exactly where
      // drizzle puts the driver's own message.
      message: [
        (error as Error).message,
        (error as { cause?: { message?: string } }).cause?.message,
      ]
        .filter(Boolean)
        .join(' | '),
    };
  }
}

const leaseRow = async (leaseId: string) => {
  const [row] = await getDb().select().from(leases).where(eq(leases.id, leaseId));
  return row;
};

async function reset(): Promise<void> {
  await getDb().delete(leases);
  await resetGeoTables();
}

beforeEach(reset);
afterAll(reset);

describe('a signature names the version it was made against', () => {
  it('records the digest of the terms, with no document attached', async () => {
    const fixture = await seedLease();

    const res = await sign(fixture.leaseId, TENANT);
    expect(res.status).toBe(200);

    const [signature] = await signaturesOf(fixture.leaseId);
    expect(signature.party).toBe('tenant');
    expect(signature.signerOxyUserId).toBe(TENANT);
    expect(signature.method).toBe('in_app_acceptance');
    // The binding with no document: the terms alone, and NOT nothing.
    expect(signature.termsSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(signature.documentId).toBeNull();
    expect(signature.documentSha256).toBeNull();

    // And it is the digest of THIS lease, not an arbitrary one.
    const hydrated = await findLeaseById(getDb(), fixture.leaseId);
    expect(signature.termsSha256).toBe(leaseTermsFingerprint(hydrated!));
  });

  it('binds to the contract document AND its content digest', async () => {
    const fixture = await seedLease();
    const document = await seedDocument(fixture.leaseId);

    expect((await sign(fixture.leaseId, TENANT)).status).toBe(200);

    const [signature] = await signaturesOf(fixture.leaseId);
    expect(signature.documentId).toBe(document.id);
    expect(signature.documentSha256).toBe(DIGEST_A);
  });

  it('binds to a document that predates hashing by id, with NO digest', async () => {
    const fixture = await seedLease();
    const document = await seedDocument(fixture.leaseId, { sha256: null });

    expect((await sign(fixture.leaseId, TENANT)).status).toBe(200);

    const [signature] = await signaturesOf(fixture.leaseId);
    // The weakest binding the schema can express, and it says so rather than
    // pretending there was no document or refusing to sign at all.
    expect(signature.documentId).toBe(document.id);
    expect(signature.documentSha256).toBeNull();
  });

  it('picks the newest lease_agreement, not the newest document', async () => {
    const fixture = await seedLease();
    const agreement = await seedDocument(fixture.leaseId, {
      type: 'lease_agreement',
      name: 'Contract.pdf',
    });
    // Uploaded LATER and of another kind: evidence about the tenancy, not the
    // agreement being entered into.
    await getDb()
      .insert(leaseDocuments)
      .values({
        leaseId: fixture.leaseId,
        name: 'Insurance.pdf',
        url: 'https://example.invalid/private/insurance.pdf',
        type: 'insurance',
        uploadedByOxyUserId: LANDLORD,
        uploadedDate: new Date('2026-06-01T00:00:00.000Z'),
        contentSha256: DIGEST_B,
      });

    expect((await sign(fixture.leaseId, TENANT)).status).toBe(200);

    const [signature] = await signaturesOf(fixture.leaseId);
    expect(signature.documentId).toBe(agreement.id);
    expect(signature.documentSha256).toBe(DIGEST_A);
  });

  it('refuses a signature against terms that changed since the client saw them', async () => {
    const fixture = await seedLease();
    const before = await request(authed(TENANT)).get(`/leases/${fixture.leaseId}`);
    const shown: string = before.body.data.termsSha256;
    expect(shown).toMatch(/^[0-9a-f]{64}$/);

    // The landlord amends the lease between the read and the signature.
    const amended = await request(authed(LANDLORD))
      .put(`/leases/${fixture.leaseId}`)
      .send({ rentDetails: { monthlyRent: 1400 } });
    expect(amended.status).toBe(200);

    const res = await sign(fixture.leaseId, TENANT, { termsSha256: shown });

    expect(res.status).toBe(409);
    expect(res.body.error?.code ?? res.body.code).toBe('LEASE_TERMS_CHANGED');
    // The refusal RE-READS: a handler that answered 409 and signed anyway
    // satisfies every assertion on the response.
    expect(await signaturesOf(fixture.leaseId)).toHaveLength(0);
    expect((await leaseRow(fixture.leaseId)).signaturesTenantSigned).toBe(false);
  });

  it('permits a signature that names the CURRENT terms', async () => {
    const fixture = await seedLease();
    const before = await request(authed(TENANT)).get(`/leases/${fixture.leaseId}`);

    const res = await sign(fixture.leaseId, TENANT, {
      termsSha256: before.body.data.termsSha256,
    });

    expect(res.status).toBe(200);
    expect(await signaturesOf(fixture.leaseId)).toHaveLength(1);
  });

  it('reports a signature as no longer binding the current terms after an amendment', async () => {
    const fixture = await seedLease();
    expect((await sign(fixture.leaseId, TENANT)).status).toBe(200);

    const fresh = await request(authed(TENANT)).get(`/leases/${fixture.leaseId}`);
    expect(fresh.body.data.signatureRecords[0].bindsCurrentTerms).toBe(true);

    await request(authed(LANDLORD))
      .put(`/leases/${fixture.leaseId}`)
      .send({ rentDetails: { monthlyRent: 1400 } });

    const after = await request(authed(TENANT)).get(`/leases/${fixture.leaseId}`);
    expect(after.body.data.signatureRecords[0].bindsCurrentTerms).toBe(false);
    // The signature itself is untouched — it still names what was signed.
    expect(after.body.data.signatureRecords[0].termsSha256).toBe(
      fresh.body.data.signatureRecords[0].termsSha256,
    );
  });
});

describe('the database refuses a binding that does not bind', () => {
  it('refuses a digest that names no document', async () => {
    const fixture = await seedLease();
    const { state, constraint } = await violation(() =>
      getDb().insert(leaseSignatures).values({
        leaseId: fixture.leaseId,
        signerOxyUserId: TENANT,
        party: 'tenant',
        termsSha256: DIGEST_A,
        documentId: null,
        documentSha256: DIGEST_B,
      }),
    );
    expect(state).toBe(CHECK_VIOLATION);
    expect(constraint).toBe('lease_signatures_document_hash_check');
  });

  it('refuses a digest the document does not have', async () => {
    const fixture = await seedLease();
    const document = await seedDocument(fixture.leaseId);
    const { state, constraint } = await violation(() =>
      getDb().insert(leaseSignatures).values({
        leaseId: fixture.leaseId,
        signerOxyUserId: TENANT,
        party: 'tenant',
        termsSha256: DIGEST_A,
        documentId: document.id,
        // Not this document's digest. The composite foreign key is what makes
        // this a refusal rather than a value somebody has to check.
        documentSha256: DIGEST_B,
      }),
    );
    expect(state).toBe(FOREIGN_KEY_VIOLATION);
    expect(constraint).toBe('lease_signatures_document_content_fk');
  });

  it('refuses a document id that names nothing', async () => {
    const fixture = await seedLease();
    const { state, constraint } = await violation(() =>
      getDb().insert(leaseSignatures).values({
        leaseId: fixture.leaseId,
        signerOxyUserId: TENANT,
        party: 'tenant',
        termsSha256: DIGEST_A,
        documentId: 'no-such-document',
        // MATCH SIMPLE satisfies the COMPOSITE key whenever a column is null,
        // so this shape is caught only by the single-column key beside it —
        // which is the whole reason both exist.
        documentSha256: null,
      }),
    );
    expect(state).toBe(FOREIGN_KEY_VIOLATION);
    expect(constraint).toBe('lease_signatures_document_id_lease_documents_id_fk');
  });

  it('refuses a terms digest that is not a digest', async () => {
    const fixture = await seedLease();
    const { state, constraint } = await violation(() =>
      getDb().insert(leaseSignatures).values({
        leaseId: fixture.leaseId,
        signerOxyUserId: TENANT,
        party: 'tenant',
        // Uppercase: `crypto` never produces it, and it compares unequal to the
        // real one, so a screen would read a tampered document.
        termsSha256: DIGEST_A.toUpperCase(),
      }),
    );
    expect(state).toBe(CHECK_VIOLATION);
    expect(constraint).toBe('lease_signatures_terms_sha256_check');
  });

  it('refuses to delete a document somebody signed, and still deletes the lease', async () => {
    const fixture = await seedLease();
    const document = await seedDocument(fixture.leaseId);
    expect((await sign(fixture.leaseId, TENANT)).status).toBe(200);

    const { state, constraint } = await violation(() =>
      getDb().delete(leaseDocuments).where(eq(leaseDocuments.id, document.id)),
    );
    expect(state).toBe(FOREIGN_KEY_VIOLATION);
    expect(constraint).toMatch(/^lease_signatures_document/);
    // The document is still there — a refusal that deleted anyway is the shape
    // a response-only assertion cannot see.
    expect(
      await getDb().select().from(leaseDocuments).where(eq(leaseDocuments.id, document.id)),
    ).toHaveLength(1);

    // The lease's own cascade still works, and that is not obvious: both tables
    // cascade from `leases` while one RESTRICTs against the other, so the
    // delete depends on Postgres queueing the cascades ahead of the referential
    // check. Pinned here rather than assumed.
    await getDb().delete(leases).where(eq(leases.id, fixture.leaseId));
    expect(await signaturesOf(fixture.leaseId)).toHaveLength(0);
  });

  it('refuses to MODIFY a signature', async () => {
    const fixture = await seedLease();
    expect((await sign(fixture.leaseId, TENANT)).status).toBe(200);
    const [signature] = await signaturesOf(fixture.leaseId);

    const { message } = await violation(() =>
      getDb()
        .update(leaseSignatures)
        .set({ termsSha256: DIGEST_B })
        .where(eq(leaseSignatures.id, signature.id)),
    );
    expect(message).toMatch(/append-only/);

    const [unchanged] = await signaturesOf(fixture.leaseId);
    expect(unchanged.termsSha256).toBe(signature.termsSha256);
  });

  it('refuses to MODIFY a timeline entry', async () => {
    const fixture = await seedLease();
    const [created] = await eventsOf(fixture.leaseId);
    const { message } = await violation(() =>
      getDb()
        .update(leaseEvents)
        .set({ detail: 'rewritten' })
        .where(eq(leaseEvents.id, created.id)),
    );
    expect(message).toMatch(/append-only/);
    const [unchanged] = await eventsOf(fixture.leaseId);
    expect(unchanged.detail).toBe(created.detail);
  });
});

describe('who may sign', () => {
  it('lets a co-tenant sign, and records the seat they signed from', async () => {
    const fixture = await seedLease([CO_TENANT]);

    const res = await sign(fixture.leaseId, CO_TENANT);

    expect(res.status).toBe(200);
    const [signature] = await signaturesOf(fixture.leaseId);
    expect(signature.party).toBe('co_tenant');
    expect(signature.signerOxyUserId).toBe(CO_TENANT);
  });

  it('refuses a stranger and writes nothing', async () => {
    const fixture = await seedLease([CO_TENANT]);

    const res = await sign(fixture.leaseId, STRANGER);

    expect(res.status).toBe(403);
    expect(await signaturesOf(fixture.leaseId)).toHaveLength(0);
    const events = await eventsOf(fixture.leaseId);
    expect(events.map((event) => event.eventType)).toEqual(['created']);
  });

  it('answers 404 for a lease that does not exist, and creates nothing', async () => {
    const res = await sign('no-such-lease', TENANT);
    expect(res.status).toBe(404);
    expect(await getDb().select().from(leaseSignatures)).toHaveLength(0);
  });

  it('is idempotent on a double tap: one signature, one event', async () => {
    const fixture = await seedLease();

    expect((await sign(fixture.leaseId, TENANT)).status).toBe(200);
    expect((await sign(fixture.leaseId, TENANT)).status).toBe(200);

    expect(await signaturesOf(fixture.leaseId)).toHaveLength(1);
    const signedEvents = (await eventsOf(fixture.leaseId)).filter(
      (event) => event.eventType === 'signed',
    );
    expect(signedEvents).toHaveLength(1);
  });
});

describe('a lease waits for EVERY party', () => {
  it('stays pending while a co-tenant has not signed', async () => {
    const fixture = await seedLease([CO_TENANT]);

    expect((await sign(fixture.leaseId, LANDLORD)).status).toBe(200);
    const res = await sign(fixture.leaseId, TENANT);

    // Both principals have signed. The old rule activated here; a named tenant
    // had not signed and had no way to.
    expect(res.body.data.status).toBe(LeaseStatus.PENDING_SIGNATURES);
    expect((await leaseRow(fixture.leaseId)).status).toBe(LeaseStatus.PENDING_SIGNATURES);
    expect(res.body.data.isFullySigned).toBe(false);
    // And no schedule, because the lease is not active.
    expect(
      await getDb()
        .select()
        .from(leasePaymentSchedule)
        .where(eq(leasePaymentSchedule.leaseId, fixture.leaseId)),
    ).toHaveLength(0);
  });

  it('activates on the last signature and generates the schedule exactly once', async () => {
    const fixture = await seedLease([CO_TENANT]);

    await sign(fixture.leaseId, LANDLORD);
    await sign(fixture.leaseId, TENANT);
    const res = await sign(fixture.leaseId, CO_TENANT);

    expect(res.body.data.status).toBe(LeaseStatus.ACTIVE);
    expect(res.body.data.isFullySigned).toBe(true);
    expect((await leaseRow(fixture.leaseId)).status).toBe(LeaseStatus.ACTIVE);

    const schedule = await getDb()
      .select()
      .from(leasePaymentSchedule)
      .where(eq(leasePaymentSchedule.leaseId, fixture.leaseId));
    expect(schedule.length).toBeGreaterThan(0);

    // A signature on an already-active lease must not append a second schedule.
    await sign(fixture.leaseId, CO_TENANT);
    expect(
      await getDb()
        .select()
        .from(leasePaymentSchedule)
        .where(eq(leasePaymentSchedule.leaseId, fixture.leaseId)),
    ).toHaveLength(schedule.length);
  });

  it('activates on the two principals when there are no co-tenants', async () => {
    const fixture = await seedLease();

    await sign(fixture.leaseId, LANDLORD);
    const res = await sign(fixture.leaseId, TENANT);

    expect(res.body.data.status).toBe(LeaseStatus.ACTIVE);
  });
});

describe('the cache is derived from the signatures', () => {
  it('writes the lease booleans and the co-tenant row from the signature rows', async () => {
    const fixture = await seedLease([CO_TENANT]);

    await sign(fixture.leaseId, LANDLORD);
    await sign(fixture.leaseId, CO_TENANT);

    const row = await leaseRow(fixture.leaseId);
    const signatures = await signaturesOf(fixture.leaseId);
    const landlordSignature = signatures.find((s) => s.signerOxyUserId === LANDLORD)!;

    expect(row.signaturesLandlordSigned).toBe(true);
    expect(row.signaturesLandlordSignedDate?.toISOString()).toBe(
      landlordSignature.signedAt.toISOString(),
    );
    expect(row.signaturesTenantSigned).toBe(false);
    expect(row.signaturesTenantSignedDate).toBeNull();

    const [coTenant] = await getDb()
      .select()
      .from(leaseCoTenants)
      .where(eq(leaseCoTenants.leaseId, fixture.leaseId));
    expect(coTenant.status).toBe('signed');
    expect(coTenant.signedDate).not.toBeNull();
  });

  it('never writes the dead client-supplied signature column', async () => {
    const fixture = await seedLease();
    await sign(fixture.leaseId, TENANT, { signature: 'accepted-in-app' });

    // A bare select, because `publicColumns` excludes it from every read path.
    const [row] = await getDb().execute<{
      signatures_tenant_digital_signature: string | null;
    }>(sql`select signatures_tenant_digital_signature from leases where id = ${fixture.leaseId}`);
    expect(row.signatures_tenant_digital_signature).toBeNull();
  });

  it('does NOT un-sign a co-tenant when the landlord amends the roster', async () => {
    const fixture = await seedLease([CO_TENANT]);
    await sign(fixture.leaseId, CO_TENANT);

    // `updateLease` REPLACES the co-tenant set wholesale, with fresh rows
    // carrying the default `pending` — which would silently discard the
    // signature and, now that activation waits for every party, keep the lease
    // from ever activating.
    const amended = await request(authed(LANDLORD))
      .put(`/leases/${fixture.leaseId}`)
      .send({ coTenants: [{ oxyUserId: CO_TENANT, role: 'guarantor' }] });
    expect(amended.status).toBe(200);

    const [coTenant] = await getDb()
      .select()
      .from(leaseCoTenants)
      .where(eq(leaseCoTenants.leaseId, fixture.leaseId));
    expect(coTenant.role).toBe('guarantor');
    expect(coTenant.status).toBe('signed');
    expect(coTenant.signedDate).not.toBeNull();
    // The signature itself never moved.
    expect(await signaturesOf(fixture.leaseId)).toHaveLength(1);
  });
});

describe('two people signing at the same instant', () => {
  /**
   * The guarantee, forced rather than hoped for.
   *
   * Two supertest requests in a `Promise.all` do not reliably interleave across
   * pooled connections — the first usually finishes before the second looks —
   * so a version with no row lock passes that shape and fails this one. Here
   * the tenant's transaction inserts a signature and is HELD OPEN; the
   * landlord's request then runs while that row is invisible to it. Without
   * `SELECT … FOR UPDATE` on the lease the landlord reads a set of signatures
   * without the tenant's, concludes the lease is incomplete and leaves it
   * `pending_signatures` forever — a state no retry can repair, because the
   * unique index refuses the second signature.
   */
  it('activates the lease even when the other signature commits after it looked', async () => {
    const fixture = await seedLease();
    const db = getDb();

    let inserted: () => void = () => undefined;
    const hasInserted = new Promise<void>((resolve) => {
      inserted = resolve;
    });
    let commit: () => void = () => undefined;
    const mayCommit = new Promise<void>((resolve) => {
      commit = resolve;
    });

    // The tenant's REAL signing transaction, held open after it finishes.
    // Hand-writing a stand-in here is what makes this kind of test lie: a
    // stand-in that took `FOR UPDATE` while the code under test did not would
    // serialize the two by itself and stay green through the very mutation it
    // exists to catch. Measured — that is what the first draft did.
    const holder = db.transaction(async (tx) => {
      await signLease(tx, {
        leaseId: fixture.leaseId,
        signerOxyUserId: TENANT,
        party: 'tenant',
        activeStatus: LeaseStatus.ACTIVE,
        pendingStatus: LeaseStatus.PENDING_SIGNATURES,
        signableStatuses: SIGNABLE,
      });
      inserted();
      await mayCommit;
    });

    await hasInserted;
    // The repository, NOT a supertest request. A supertest `Test` is lazy: it
    // dispatches on `.then()`, so `const racing = sign(...)` would not start
    // until the `await` below — after the holder had committed — and the case
    // would measure the sequential path while claiming to measure a race.
    // Mutation-tested: that is exactly what it did, and removing the row lock
    // left it green.
    const racing = db.transaction((tx) =>
      signLease(tx, {
        leaseId: fixture.leaseId,
        signerOxyUserId: LANDLORD,
        party: 'landlord',
        activeStatus: LeaseStatus.ACTIVE,
        pendingStatus: LeaseStatus.PENDING_SIGNATURES,
        signableStatuses: SIGNABLE,
      }),
    );
    // Long enough for the landlord's transaction to reach the lock and block.
    await new Promise((resolve) => setTimeout(resolve, 100));
    commit();
    await holder;

    const outcome = await racing;
    expect(outcome.kind).toBe('signed');
    expect((await leaseRow(fixture.leaseId)).status).toBe(LeaseStatus.ACTIVE);
    expect(await signaturesOf(fixture.leaseId)).toHaveLength(2);
    // The cache follows the truth even though the landlord's transaction began
    // before the tenant's signature was visible to it.
    const row = await leaseRow(fixture.leaseId);
    expect(row.signaturesLandlordSigned).toBe(true);
    expect(row.signaturesTenantSigned).toBe(true);
  });
});

describe('the timeline is made of rows', () => {
  it('records creation, each signature, activation and a document', async () => {
    const fixture = await seedLease([CO_TENANT]);
    await seedDocument(fixture.leaseId);
    await sign(fixture.leaseId, LANDLORD);
    await sign(fixture.leaseId, TENANT);
    await sign(fixture.leaseId, CO_TENANT);

    const events = await eventsOf(fixture.leaseId);
    expect(events.map((event) => event.eventType)).toEqual([
      'created',
      'signed',
      'signed',
      'signed',
      'activated',
    ]);
    // Positions are NUMBERS and they are consecutive. `max + 1` computed in
    // JavaScript reads `int8` as a STRING and lands the second entry at 11.
    expect(events.map((event) => event.position)).toEqual([1, 2, 3, 4, 5]);
    // `signed` and `activated` are written in ONE transaction and therefore
    // share `occurred_at` to the millisecond — which is why the position
    // exists, and why ordering by the timestamp would be a coin flip.
    expect(events[3].occurredAt.toISOString()).toBe(events[4].occurredAt.toISOString());
    // The activation has no actor: it was caused by every party, not by
    // whoever happened to sign last.
    expect(events[4].actorOxyUserId).toBeNull();
    expect(events[1].actorOxyUserId).toBe(LANDLORD);
    expect(events[1].detail).toBe('landlord');
    expect(events[3].detail).toBe('co_tenant');
  });

  it('records a termination with the reason that was given', async () => {
    const fixture = await seedLease();
    await sign(fixture.leaseId, LANDLORD);
    await sign(fixture.leaseId, TENANT);

    const res = await request(authed(TENANT))
      .post(`/leases/${fixture.leaseId}/terminate`)
      .send({ reason: 'Moving abroad' });
    expect(res.status).toBe(200);

    const events = await eventsOf(fixture.leaseId);
    const terminated = events[events.length - 1];
    expect(terminated.eventType).toBe('terminated');
    expect(terminated.actorOxyUserId).toBe(TENANT);
    expect(terminated.detail).toBe('Moving abroad');
  });

  it('records an amendment only once a signature exists to invalidate', async () => {
    const fixture = await seedLease();

    // Nobody has signed: editing a draft is drafting, not an event.
    await request(authed(LANDLORD))
      .put(`/leases/${fixture.leaseId}`)
      .send({ rentDetails: { monthlyRent: 1300 } });
    expect((await eventsOf(fixture.leaseId)).map((e) => e.eventType)).toEqual(['created']);

    await sign(fixture.leaseId, TENANT);
    await request(authed(LANDLORD))
      .put(`/leases/${fixture.leaseId}`)
      .send({ rentDetails: { monthlyRent: 1400 } });

    expect((await eventsOf(fixture.leaseId)).map((e) => e.eventType)).toEqual([
      'created',
      'signed',
      'amended',
    ]);
  });

  it('publishes the timeline on the detail read and not on the list', async () => {
    const fixture = await seedLease();
    await sign(fixture.leaseId, TENANT);

    const detail = await request(authed(TENANT)).get(`/leases/${fixture.leaseId}`);
    expect(detail.body.data.events.map((event: { type: string }) => event.type)).toEqual([
      'created',
      'signed',
    ]);
    expect(detail.body.data.signatureRecords).toHaveLength(1);
  });

  it('gives a stranger no timeline at all', async () => {
    const fixture = await seedLease();
    const res = await request(authed(STRANGER)).get(`/leases/${fixture.leaseId}`);
    expect(res.status).toBe(403);
    expect(res.body.data).toBeUndefined();
  });
});

describe('the terms fingerprint covers what an amendment can change', () => {
  const fingerprintOf = async (leaseId: string) =>
    leaseTermsFingerprint((await findLeaseById(getDb(), leaseId))!);

  it('changes when the rent changes', async () => {
    const fixture = await seedLease();
    const before = await fingerprintOf(fixture.leaseId);
    await request(authed(LANDLORD))
      .put(`/leases/${fixture.leaseId}`)
      .send({ rentDetails: { monthlyRent: 1500 } });
    expect(await fingerprintOf(fixture.leaseId)).not.toBe(before);
  });

  it('changes when a CO-TENANT is added — the child-table case a generated column could not see', async () => {
    const fixture = await seedLease();
    const before = await fingerprintOf(fixture.leaseId);
    await request(authed(LANDLORD))
      .put(`/leases/${fixture.leaseId}`)
      .send({ coTenants: [{ oxyUserId: CO_TENANT, role: 'guarantor' }] });
    expect(await fingerprintOf(fixture.leaseId)).not.toBe(before);
  });

  it('does NOT change when something outside the terms moves', async () => {
    const fixture = await seedLease();
    const before = await fingerprintOf(fixture.leaseId);
    // A document arriving is not a change to the terms, and a fingerprint that
    // moved here would mark every existing signature stale for no reason.
    await seedDocument(fixture.leaseId);
    expect(await fingerprintOf(fixture.leaseId)).toBe(before);
  });

  it('is stable across two reads of an untouched lease', async () => {
    const fixture = await seedLease([CO_TENANT]);
    expect(await fingerprintOf(fixture.leaseId)).toBe(await fingerprintOf(fixture.leaseId));
  });

  it('differs between two leases with identical terms', async () => {
    const first = await seedLease();
    const second = await seedLease();
    // A fingerprint that ignored identity would let a signature be lifted from
    // one lease onto another with the same numbers.
    expect(await fingerprintOf(first.leaseId)).not.toBe(await fingerprintOf(second.leaseId));
  });
});

describe('a document carries the digest of the bytes that were stored', () => {
  it('publishes it on the wire so a party can check it themselves', async () => {
    const fixture = await seedLease();
    await seedDocument(fixture.leaseId);
    await sign(fixture.leaseId, TENANT);

    const res = await request(authed(TENANT)).get(`/leases/${fixture.leaseId}`);
    expect(res.body.data.documents[0].contentSha256).toBe(DIGEST_A);
    expect(res.body.data.signatureRecords[0].documentSha256).toBe(DIGEST_A);
    expect(res.body.data.signatureRecords[0].documentName).toBe('Tenancy agreement.pdf');
  });

  it('refuses a digest that is not one', async () => {
    const fixture = await seedLease();
    const { state, constraint } = await violation(() =>
      getDb().insert(leaseDocuments).values({
        leaseId: fixture.leaseId,
        name: 'bad.pdf',
        url: 'https://example.invalid/x.pdf',
        type: 'lease_agreement',
        uploadedByOxyUserId: LANDLORD,
        uploadedDate: new Date(),
        contentSha256: 'not-a-digest',
      }),
    );
    expect(state).toBe(CHECK_VIOLATION);
    expect(constraint).toBe('lease_documents_content_sha256_check');
  });

  it('permits a document with no digest at all', async () => {
    const fixture = await seedLease();
    const document = await seedDocument(fixture.leaseId, { sha256: null });
    const [row] = await getDb()
      .select()
      .from(leaseDocuments)
      .where(and(eq(leaseDocuments.id, document.id), eq(leaseDocuments.leaseId, fixture.leaseId)));
    expect(row.contentSha256).toBeNull();
  });
});
