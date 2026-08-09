/**
 * Leases — ownership, the signature lifecycle, and the rules the schema now
 * carries, against the REAL Postgres this worker owns.
 *
 * ## What makes these tests non-vacuous
 *
 * `leases` was empty in production, so "insert one and read it back" would pass
 * against almost any implementation. Every case below targets something with a
 * way to be wrong:
 *
 *  - each ownership refusal RE-READS the row, because a handler that 403s and
 *    writes anyway passes any assertion made on its response alone,
 *  - the payment schedule is asserted on its CONTENT (a deposit plus one rent
 *    row per month), not merely on being non-empty,
 *  - `lease_payment_schedule_paid_evidence_check` is asserted in BOTH
 *    directions — what it permits and what it refuses,
 *  - the two protected signature columns are asserted absent from the response
 *    AND present in the table, which is the only pair that distinguishes
 *    "excluded from the DTO" from "never stored".
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { and, asc, eq } from 'drizzle-orm';

import leaseController from '../../controllers/leaseController';
import { getDb } from '../../db/postgres';
import { leaseCoTenants, leaseDocuments, leasePaymentSchedule, leases } from '../../db/schema';
import { errorHandler } from '../../middlewares/errorHandler';
import { serializeWireIds } from '../../middlewares/wireIds';
import { resetGeoTables, seedListingWithGeo } from '../helpers/postgresGeoFixtures';

function buildApp(oxyUserId: string): Express {
  const app = express();
  app.use(express.json());
  // Production mounts every one of these handlers behind `routes()`, whose
  // first middleware is the wire-id serializer. Without it here the suite
  // would assert a body shape the API no longer serves.
  app.use(serializeWireIds);

  app.use((req, _res, next) => {
    const authed = req as unknown as { user: { id: string }; userId: string };
    authed.user = { id: oxyUserId };
    authed.userId = oxyUserId;
    next();
  });
  app.get('/leases', (req, res, next) => leaseController.getLeases(req, res, next));
  app.post('/leases', (req, res, next) => leaseController.createLease(req, res, next));
  app.get('/leases/:id/payments', (req, res, next) => leaseController.getLeasePayments(req, res, next));
  app.get('/leases/:id', (req, res, next) => leaseController.getLeaseById(req, res, next));
  app.put('/leases/:id', (req, res, next) => leaseController.updateLease(req, res, next));
  app.delete('/leases/:id', (req, res, next) => leaseController.deleteLease(req, res, next));
  app.post('/leases/:id/sign', (req, res, next) => leaseController.signLease(req, res, next));
  app.post('/leases/:id/documents', (req, res, next) => leaseController.uploadLeaseDocument(req, res, next));
  app.post('/leases/:id/renew', (req, res, next) => leaseController.renewLease(req, res, next));
  app.use(errorHandler);
  return app;
}

/** A listing owned by `oxyUserId`, on a real geo chain. */
async function seedOwnedProperty(oxyUserId = 'oxy-landlord'): Promise<string> {
  const { propertyId } = await seedListingWithGeo({ overrides: { oxyUserId } });
  return propertyId;
}

function leaseBody(propertyId: string, overrides: Record<string, unknown> = {}) {
  return {
    propertyId,
    tenantOxyUserId: 'oxy-tenant',
    leaseTerms: {
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-12-31T00:00:00.000Z',
    },
    rentDetails: { monthlyRent: 1200, currency: 'EUR', dueDate: 1, securityDeposit: 2400 },
    ...overrides,
  };
}

/** Create a draft lease through the API and return its id. */
async function createDraftLease(
  propertyId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const res = await request(buildApp('oxy-landlord'))
    .post('/leases')
    .send(leaseBody(propertyId, overrides));
  expect(res.status).toBe(201);
  return res.body.data.id;
}

async function leaseRow(id: string) {
  const [row] = await getDb().select().from(leases).where(eq(leases.id, id)).limit(1);
  return row;
}

async function scheduleOf(leaseId: string) {
  return getDb()
    .select()
    .from(leasePaymentSchedule)
    .where(eq(leasePaymentSchedule.leaseId, leaseId))
    .orderBy(asc(leasePaymentSchedule.dueDate));
}

beforeEach(async () => {
  await resetGeoTables();
});

/**
 * Leave the shared tables as this file found them.
 *
 * Not tidiness — a real, reproduced failure. `__tests__/db/geoBackfill.test.ts`
 * does NOT truncate; it deletes only the rows it created, by id, and copies a
 * fixture country with `code: 'ES'` using `on conflict do nothing`. Since
 * `countries_code_key` is UNIQUE on `code`, ANY leftover `ES` country from an
 * earlier file in the same worker makes that insert a silent no-op — and its
 * region then fails `regions_country_id_countries_id_fk` on a country id that
 * was never written. Ten of geoBackfill's tests go red, none of them naming the
 * file that actually caused it.
 *
 * Measured: `jest --maxWorkers=1 geoBackfill leaseOwnership` is 10 failed with
 * this hook removed and green with it. The trap is geoBackfill's to close
 * properly (its fixture is order-dependent by construction); this hook is what
 * stops THIS file springing it.
 */
afterAll(async () => {
  await resetGeoTables();
});

describe('leaseController.createLease', () => {
  it('creates a draft lease with a server-resolved landlord', async () => {
    const propertyId = await seedOwnedProperty();
    const res = await request(buildApp('oxy-landlord'))
      .post('/leases')
      // A forged landlord and status in the body must be ignored: neither is in
      // `CREATABLE_LEASE_FIELDS`, and both are resolved server-side.
      .send(leaseBody(propertyId, { landlordOxyUserId: 'attacker', status: 'active' }));

    expect(res.status).toBe(201);
    expect(res.body.data.landlordOxyUserId).toBe('oxy-landlord');
    expect(res.body.data.status).toBe('draft');

    const persisted = await leaseRow(res.body.data.id);
    expect(persisted.landlordOxyUserId).toBe('oxy-landlord');
    expect(persisted.status).toBe('draft');
    expect(persisted.rentDetailsMonthlyRent).toBe(1200);
  });

  it('rejects create for a property the requester does not own', async () => {
    const propertyId = await seedOwnedProperty('oxy-someone-else');
    const res = await request(buildApp('oxy-landlord'))
      .post('/leases')
      .send(leaseBody(propertyId));

    expect(res.status).toBe(403);
    expect(await getDb().select().from(leases)).toHaveLength(0);
  });

  it('answers 404 for a property that does not exist', async () => {
    const res = await request(buildApp('oxy-landlord'))
      .post('/leases')
      .send(leaseBody('0198f0a1-0000-7000-8000-000000000000'));
    expect(res.status).toBe(404);
  });

  it('stores co-tenants in the SAME transaction as the lease', async () => {
    const propertyId = await seedOwnedProperty();
    const id = await createDraftLease(propertyId, {
      coTenants: [
        { oxyUserId: 'oxy-co-1', role: 'secondary' },
        { oxyUserId: 'oxy-co-2', role: 'guarantor' },
        // No `oxyUserId`: dropped rather than inserted as a `23502` naming a
        // column the client never sent.
        { role: 'secondary' },
      ],
    });

    const rows = await getDb()
      .select()
      .from(leaseCoTenants)
      .where(eq(leaseCoTenants.leaseId, id));
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === 'pending')).toBe(true);
  });

  it('refuses an inverted term — the CHECK, not the controller', async () => {
    // `leases_term_order_check` was expressible only because the table is
    // empty. Mongo had no validator here at all, and `generatePaymentSchedule`
    // on an inverted term silently produces a lease nobody ever has to pay.
    const propertyId = await seedOwnedProperty();
    const res = await request(buildApp('oxy-landlord'))
      .post('/leases')
      .send(
        leaseBody(propertyId, {
          leaseTerms: {
            startDate: '2026-12-31T00:00:00.000Z',
            endDate: '2026-01-01T00:00:00.000Z',
          },
        }),
      );
    expect(res.status).toBe(500);
    expect(await getDb().select().from(leases)).toHaveLength(0);
  });
});

describe('leaseController.getLeaseById', () => {
  it('lets the landlord read the lease', async () => {
    const id = await createDraftLease(await seedOwnedProperty());
    const res = await request(buildApp('oxy-landlord')).get(`/leases/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(id);
  });

  it('lets a CO-TENANT read the lease', async () => {
    // The co-tenant arm of the party filter is an `EXISTS` over
    // `lease_co_tenants` now, where it used to be an embedded-array path match.
    const id = await createDraftLease(await seedOwnedProperty(), {
      coTenants: [{ oxyUserId: 'oxy-co' }],
    });
    const res = await request(buildApp('oxy-co')).get(`/leases/${id}`);
    expect(res.status).toBe(200);
  });

  it('rejects a non-party with 403', async () => {
    const id = await createDraftLease(await seedOwnedProperty());
    const res = await request(buildApp('oxy-stranger')).get(`/leases/${id}`);
    expect(res.status).toBe(403);
  });

  it('answers 404 for a malformed id rather than 400 or 500', async () => {
    const res = await request(buildApp('oxy-landlord')).get('/leases/not-an-id');
    expect(res.status).toBe(404);
  });
});

describe('leaseController.getLeases — the party filter', () => {
  it('returns a lease to the landlord, the tenant and a co-tenant, and nobody else', async () => {
    const id = await createDraftLease(await seedOwnedProperty(), {
      coTenants: [{ oxyUserId: 'oxy-co' }],
    });

    for (const viewer of ['oxy-landlord', 'oxy-tenant', 'oxy-co']) {
      const res = await request(buildApp(viewer)).get('/leases');
      expect(res.status).toBe(200);
      expect(res.body.data.map((row: { id: string }) => row.id)).toEqual([id]);
    }

    const stranger = await request(buildApp('oxy-stranger')).get('/leases');
    expect(stranger.body.data).toHaveLength(0);
  });

  it('counts a co-tenant lease ONCE even with two co-tenant rows for one person', async () => {
    // The party filter must not DUPLICATE the lease per matching child row —
    // which a join would, making the page and its `count(*)` disagree about the
    // total. Note `EXISTS` and `IN (subquery)` are equivalent here (both
    // deduplicate); only a join is the wrong shape, which is what this pins.
    const id = await createDraftLease(await seedOwnedProperty(), {
      coTenants: [{ oxyUserId: 'oxy-co', role: 'secondary' }],
    });
    await getDb()
      .insert(leaseCoTenants)
      .values({ leaseId: id, oxyUserId: 'oxy-co', role: 'guarantor' });

    const res = await request(buildApp('oxy-co')).get('/leases');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.pagination.total).toBe(1);
  });
});

describe('leaseController.updateLease', () => {
  it('lets the landlord update a draft lease', async () => {
    const id = await createDraftLease(await seedOwnedProperty());
    const res = await request(buildApp('oxy-landlord'))
      .put(`/leases/${id}`)
      .send({ notes: 'agreed by phone' });
    expect(res.status).toBe(200);
    expect(res.body.data.notes).toBe('agreed by phone');
  });

  it('rejects a tenant update with 403 and changes nothing', async () => {
    const id = await createDraftLease(await seedOwnedProperty());
    const res = await request(buildApp('oxy-tenant'))
      .put(`/leases/${id}`)
      .send({ notes: 'hijacked' });
    expect(res.status).toBe(403);

    expect((await leaseRow(id)).notes).toBeNull();
  });

  it('REPLACES the co-tenant roster rather than merging it', async () => {
    // Assigning an embedded array replaced it wholesale in Mongoose. Merging
    // would be a new behaviour, and a landlord removing a co-tenant would find
    // them still on the lease.
    const id = await createDraftLease(await seedOwnedProperty(), {
      coTenants: [{ oxyUserId: 'oxy-co-1' }, { oxyUserId: 'oxy-co-2' }],
    });

    const res = await request(buildApp('oxy-landlord'))
      .put(`/leases/${id}`)
      .send({ coTenants: [{ oxyUserId: 'oxy-co-2' }] });
    expect(res.status).toBe(200);

    const rows = await getDb().select().from(leaseCoTenants).where(eq(leaseCoTenants.leaseId, id));
    expect(rows.map((row) => row.oxyUserId)).toEqual(['oxy-co-2']);
  });

  it('leaves the roster ALONE when the body carries no `coTenants` key', async () => {
    // `undefined` and `[]` mean different things: without this distinction,
    // editing `notes` would wipe the roster.
    const id = await createDraftLease(await seedOwnedProperty(), {
      coTenants: [{ oxyUserId: 'oxy-co-1' }],
    });

    await request(buildApp('oxy-landlord')).put(`/leases/${id}`).send({ notes: 'unrelated' });

    const rows = await getDb().select().from(leaseCoTenants).where(eq(leaseCoTenants.leaseId, id));
    expect(rows).toHaveLength(1);
  });
});

describe('leaseController.signLease — signatures, status and the schedule', () => {
  it('records a tenant signature and leaves the lease awaiting the landlord', async () => {
    const id = await createDraftLease(await seedOwnedProperty());
    const res = await request(buildApp('oxy-tenant'))
      .post(`/leases/${id}/sign`)
      .send({ acceptTerms: true, signature: 'tenant-mark' });

    expect(res.status).toBe(200);
    expect(res.body.data.signatures.tenant.signed).toBe(true);
    expect(res.body.data.status).toBe('pending_signatures');
    expect(res.body.data.isFullySigned).toBe(false);

    // Not active yet, so no schedule.
    expect(await scheduleOf(id)).toHaveLength(0);
  });

  it('NEVER returns the digital signature, but does store it', async () => {
    // The pair is what distinguishes "excluded from the response" from "never
    // written" — a serializer that simply dropped the field would pass the
    // first assertion alone.
    const id = await createDraftLease(await seedOwnedProperty());
    const res = await request(buildApp('oxy-tenant'))
      .post(`/leases/${id}/sign`)
      .send({ acceptTerms: true, signature: 'tenant-mark' });

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('tenant-mark');
    expect(res.body.data.signatures.tenant.digitalSignature).toBeUndefined();

    expect((await leaseRow(id)).signaturesTenantDigitalSignature).toBe('tenant-mark');
  });

  it('activates the lease and generates the payment schedule when both sign', async () => {
    const id = await createDraftLease(await seedOwnedProperty());
    await request(buildApp('oxy-tenant')).post(`/leases/${id}/sign`).send({ acceptTerms: true });
    const res = await request(buildApp('oxy-landlord'))
      .post(`/leases/${id}/sign`)
      .send({ acceptTerms: true });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('active');
    expect(res.body.data.isFullySigned).toBe(true);

    const schedule = await scheduleOf(id);
    // A deposit plus one rent row per month of a 2026-01-01 → 2026-12-31 term.
    // Asserted on CONTENT, not merely on being non-empty: a generator that
    // emitted one row, or twelve deposits, would pass a length-only check.
    const deposits = schedule.filter((row) => row.type === 'deposit');
    expect(deposits).toHaveLength(1);
    expect(deposits[0].amount).toBe(2400);
    expect(schedule.filter((row) => row.type === 'rent')).toHaveLength(12);
    expect(schedule.every((row) => row.status === 'pending')).toBe(true);
    // The unpaid half of `lease_payment_schedule_paid_evidence_check`.
    expect(schedule.every((row) => row.paidDate === null && row.paidAmount === null)).toBe(true);
  });

  it('does not generate a SECOND schedule when an active lease is signed again', async () => {
    const id = await createDraftLease(await seedOwnedProperty());
    await request(buildApp('oxy-tenant')).post(`/leases/${id}/sign`).send({ acceptTerms: true });
    await request(buildApp('oxy-landlord')).post(`/leases/${id}/sign`).send({ acceptTerms: true });
    await request(buildApp('oxy-landlord')).post(`/leases/${id}/sign`).send({ acceptTerms: true });

    expect(await scheduleOf(id)).toHaveLength(13);
  });

  it('reports isFullySigned FALSE while a co-tenant has not signed, even when active', async () => {
    // The source's two rules disagree, deliberately: `signAsLandlord` consults
    // only the other principal, `isFullySigned` consults the co-tenants too. It
    // is NOT expressed as a CHECK because the application states two rules, not
    // one — this test is what pins the disagreement so a later reader does not
    // "fix" one of them in isolation.
    const id = await createDraftLease(await seedOwnedProperty(), {
      coTenants: [{ oxyUserId: 'oxy-co' }],
    });
    await request(buildApp('oxy-tenant')).post(`/leases/${id}/sign`).send({ acceptTerms: true });
    const res = await request(buildApp('oxy-landlord'))
      .post(`/leases/${id}/sign`)
      .send({ acceptTerms: true });

    expect(res.body.data.status).toBe('active');
    expect(res.body.data.isFullySigned).toBe(false);
  });

  it('refuses a non-party signature and a missing acceptTerms', async () => {
    const id = await createDraftLease(await seedOwnedProperty());

    const stranger = await request(buildApp('oxy-stranger'))
      .post(`/leases/${id}/sign`)
      .send({ acceptTerms: true });
    expect(stranger.status).toBe(403);

    const noTerms = await request(buildApp('oxy-tenant')).post(`/leases/${id}/sign`).send({});
    expect(noTerms.status).toBe(400);

    const persisted = await leaseRow(id);
    expect(persisted.signaturesTenantSigned).toBe(false);
    expect(persisted.status).toBe('draft');
  });

  it('refuses a CO-TENANT as a signatory — they are a party for reads only', async () => {
    const id = await createDraftLease(await seedOwnedProperty(), {
      coTenants: [{ oxyUserId: 'oxy-co' }],
    });
    const res = await request(buildApp('oxy-co'))
      .post(`/leases/${id}/sign`)
      .send({ acceptTerms: true });
    expect(res.status).toBe(403);
  });
});

describe('lease_payment_schedule_paid_evidence_check', () => {
  it('PERMITS a paid instalment that carries its date and amount', async () => {
    const id = await createDraftLease(await seedOwnedProperty());
    const [row] = await getDb()
      .insert(leasePaymentSchedule)
      .values({
        leaseId: id,
        dueDate: new Date('2026-02-01T00:00:00.000Z'),
        amount: 1200,
        type: 'rent',
        status: 'paid',
        paidDate: new Date('2026-02-01T00:00:00.000Z'),
        paidAmount: 1200,
      })
      .returning();
    expect(row.status).toBe('paid');
  });

  it('REFUSES a `paid` instalment with no payment evidence', async () => {
    // The damaging half: a row marked paid with no date and no amount is
    // indistinguishable, afterwards, from a payment somebody recorded by hand.
    const id = await createDraftLease(await seedOwnedProperty());
    await expect(
      getDb().insert(leasePaymentSchedule).values({
        leaseId: id,
        dueDate: new Date('2026-02-01T00:00:00.000Z'),
        amount: 1200,
        type: 'rent',
        status: 'paid',
      }),
    ).rejects.toThrow();
  });

  it('REFUSES a `pending` instalment that carries a paid date', async () => {
    // The reverse half — a payment nobody counted.
    const id = await createDraftLease(await seedOwnedProperty());
    await expect(
      getDb().insert(leasePaymentSchedule).values({
        leaseId: id,
        dueDate: new Date('2026-02-01T00:00:00.000Z'),
        amount: 1200,
        type: 'rent',
        status: 'pending',
        paidDate: new Date('2026-02-01T00:00:00.000Z'),
        paidAmount: 1200,
      }),
    ).rejects.toThrow();
  });
});

describe('leaseController.getLeasePayments', () => {
  it('paginates and filters in SQL', async () => {
    const id = await createDraftLease(await seedOwnedProperty());
    await request(buildApp('oxy-tenant')).post(`/leases/${id}/sign`).send({ acceptTerms: true });
    await request(buildApp('oxy-landlord')).post(`/leases/${id}/sign`).send({ acceptTerms: true });

    const firstPage = await request(buildApp('oxy-tenant')).get(`/leases/${id}/payments?limit=5`);
    expect(firstPage.status).toBe(200);
    expect(firstPage.body.data).toHaveLength(5);
    expect(firstPage.body.pagination.total).toBe(13);

    const filtered = await request(buildApp('oxy-tenant')).get(
      `/leases/${id}/payments?status=paid`,
    );
    expect(filtered.body.data).toHaveLength(0);
    expect(filtered.body.pagination.total).toBe(0);
  });

  it('refuses a non-party', async () => {
    const id = await createDraftLease(await seedOwnedProperty());
    const res = await request(buildApp('oxy-stranger')).get(`/leases/${id}/payments`);
    expect(res.status).toBe(403);
  });
});

describe('leaseController.uploadLeaseDocument', () => {
  it('stores a server-resolved uploader', async () => {
    const id = await createDraftLease(await seedOwnedProperty());
    const res = await request(buildApp('oxy-tenant'))
      .post(`/leases/${id}/documents`)
      // A forged uploader must be ignored: `uploadedBy` is the one field on a
      // document that says who is accountable for it.
      .send({ name: 'signed.pdf', url: 'https://example.test/signed.pdf', uploadedBy: 'attacker' });

    expect(res.status).toBe(201);
    expect(res.body.data.uploadedBy).toBe('oxy-tenant');

    const [row] = await getDb()
      .select()
      .from(leaseDocuments)
      .where(eq(leaseDocuments.leaseId, id));
    expect(row.uploadedByOxyUserId).toBe('oxy-tenant');
    // An undeclared type falls back rather than hitting the CHECK.
    expect(row.type).toBe('other');
  });
});

describe('leaseController.deleteLease', () => {
  it('cascades every child table', async () => {
    const id = await createDraftLease(await seedOwnedProperty(), {
      coTenants: [{ oxyUserId: 'oxy-co' }],
    });
    await request(buildApp('oxy-landlord'))
      .post(`/leases/${id}/documents`)
      .send({ name: 'draft.pdf', url: 'https://example.test/draft.pdf' });

    const res = await request(buildApp('oxy-landlord')).delete(`/leases/${id}`);
    expect(res.status).toBe(200);

    expect(await getDb().select().from(leaseCoTenants).where(eq(leaseCoTenants.leaseId, id))).toHaveLength(0);
    expect(await getDb().select().from(leaseDocuments).where(eq(leaseDocuments.leaseId, id))).toHaveLength(0);
    expect(await leaseRow(id)).toBeUndefined();
  });

  it('refuses to delete an ACTIVE lease', async () => {
    const id = await createDraftLease(await seedOwnedProperty());
    await request(buildApp('oxy-tenant')).post(`/leases/${id}/sign`).send({ acceptTerms: true });
    await request(buildApp('oxy-landlord')).post(`/leases/${id}/sign`).send({ acceptTerms: true });

    const res = await request(buildApp('oxy-landlord')).delete(`/leases/${id}`);
    expect(res.status).toBe(409);
    expect(await leaseRow(id)).toBeDefined();
  });
});

describe('leaseController.renewLease', () => {
  it('names the columns it copies and starts the renewal unsigned', async () => {
    const id = await createDraftLease(await seedOwnedProperty(), {
      coTenants: [{ oxyUserId: 'oxy-co', role: 'guarantor' }],
    });
    await request(buildApp('oxy-tenant'))
      .post(`/leases/${id}/sign`)
      .send({ acceptTerms: true, signature: 'tenant-mark' });
    await request(buildApp('oxy-landlord')).post(`/leases/${id}/sign`).send({ acceptTerms: true });
    // The co-tenant SIGNS the original. Without this the fixture sits on the
    // wrong side of the distinction the assertion below exists to make: a
    // renewal that inherited `status` verbatim would still read `pending`,
    // because the source row was `pending` too. Mutation-tested — inheriting
    // the status survives every version of this test that skips this line.
    await getDb()
      .update(leaseCoTenants)
      .set({ status: 'signed', signedDate: new Date('2026-06-01T00:00:00.000Z') })
      .where(and(eq(leaseCoTenants.leaseId, id), eq(leaseCoTenants.oxyUserId, 'oxy-co')));

    const res = await request(buildApp('oxy-landlord'))
      .post(`/leases/${id}/renew`)
      .send({ newEndDate: '2027-12-31T00:00:00.000Z' });

    expect(res.status).toBe(201);
    const renewal = await leaseRow(res.body.data.id);
    expect(renewal.status).toBe('draft');
    // The original's signatures, schedule and termination notice must NOT
    // travel — this is what the `toObject()` spread got wrong by default.
    expect(renewal.signaturesLandlordSigned).toBe(false);
    expect(renewal.signaturesTenantSigned).toBe(false);
    expect(renewal.signaturesTenantDigitalSignature).toBeNull();
    expect(await scheduleOf(renewal.id)).toHaveLength(0);
    // The terms DO travel.
    expect(renewal.rentDetailsMonthlyRent).toBe(1200);
    expect(renewal.rentDetailsSecurityDeposit).toBe(2400);

    // The roster is inherited, its signatures are not.
    const roster = await getDb()
      .select()
      .from(leaseCoTenants)
      .where(and(eq(leaseCoTenants.leaseId, renewal.id), eq(leaseCoTenants.oxyUserId, 'oxy-co')));
    expect(roster).toHaveLength(1);
    expect(roster[0].role).toBe('guarantor');
    expect(roster[0].status).toBe('pending');
    expect(roster[0].signedDate).toBeNull();
  });

  it('refuses a non-landlord renewal', async () => {
    const id = await createDraftLease(await seedOwnedProperty());
    const res = await request(buildApp('oxy-tenant'))
      .post(`/leases/${id}/renew`)
      .send({ newEndDate: '2027-12-31T00:00:00.000Z' });
    expect(res.status).toBe(403);
    expect(await getDb().select().from(leases)).toHaveLength(1);
  });
});
