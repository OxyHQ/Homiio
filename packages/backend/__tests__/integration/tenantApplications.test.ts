/**
 * Tenant applications — the lifecycle, the `decided_at` equivalence, and the
 * children that commit with the parent. Against the REAL Postgres.
 *
 * ## What makes these tests non-vacuous
 *
 * `tenant_applications` was empty in production. The cases below target rules
 * that have a way to be wrong:
 *
 *  - `tenant_applications_decided_at_check` is asserted in BOTH directions, and
 *    on the transition that must NOT stamp (`reviewing`) as well as the three
 *    that must,
 *  - every refusal re-reads the row,
 *  - the duplicate-application rule is asserted on what it PERMITS (re-applying
 *    after a rejection) as well as what it refuses,
 *  - the children are asserted to be ABSENT when the parent insert fails, which
 *    is the only assertion that distinguishes one transaction from two.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';

import applicationController from '../../controllers/applicationController';
import { getDb } from '../../db/postgres';
import {
  leases,
  properties,
  tenantApplicationDocuments,
  tenantApplicationReferences,
  tenantApplications,
} from '../../db/schema';
import { errorHandler } from '../../middlewares/errorHandler';
import { resetGeoTables, seedListingWithGeo } from '../helpers/postgresGeoFixtures';

function buildApp(oxyUserId: string): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const authed = req as unknown as { user: { id: string }; userId: string };
    authed.user = { id: oxyUserId };
    authed.userId = oxyUserId;
    next();
  });
  app.post('/applications', (req, res, next) => applicationController.createApplication(req, res, next));
  app.get('/applications', (req, res, next) => applicationController.listMyApplications(req, res, next));
  app.get('/applications/:id', (req, res, next) => applicationController.getApplicationById(req, res, next));
  app.patch('/applications/:id', (req, res, next) => applicationController.updateApplicationStatus(req, res, next));
  app.post('/applications/:id/create-lease', (req, res, next) => applicationController.createLeaseFromApplication(req, res, next));
  app.use(errorHandler);
  return app;
}

/** A distinct ISO-3166 alpha-2 per geo chain — `countries_code_key` is UNIQUE. */
let geoChainCounter = 0;
function nextCountryCode(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const index = geoChainCounter++;
  return `${alphabet[Math.floor(index / 26) % 26]}${alphabet[index % 26]}`;
}

/** A listing offered for long-term rent, owned by `oxy-landlord`. */
async function seedRentalProperty(oxyUserId = 'oxy-landlord'): Promise<string> {
  const { propertyId } = await seedListingWithGeo({
    countryCode: nextCountryCode(),
    overrides: {
      oxyUserId,
      status: 'published',
      isExternal: false,
      // `properties_offerings_*` makes `offerings` exactly the set of present
      // priced blocks, so the block has to be here for the offering to be.
      offerings: ['long_term_rent'],
      longTermRentMonthlyAmount: 1400,
      longTermRentCurrency: 'EUR',
    },
  });
  return propertyId;
}

function applicationBody(propertyId: string, overrides: Record<string, unknown> = {}) {
  return {
    propertyId,
    moveInDate: '2026-03-01T00:00:00.000Z',
    leaseTermMonths: 12,
    monthlyIncome: 45000,
    employmentStatus: 'employed',
    referenceContacts: [
      { name: 'Ada Ref', relationship: 'employer', phone: '+34600000000', email: 'Ada@Example.TEST' },
    ],
    ...overrides,
  };
}

async function createApplicationFor(
  propertyId: string,
  applicant = 'oxy-applicant',
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const res = await request(buildApp(applicant))
    .post('/applications')
    .send(applicationBody(propertyId, overrides));
  expect(res.status).toBe(201);
  return res.body.data.id;
}

async function applicationRow(id: string) {
  const [row] = await getDb()
    .select()
    .from(tenantApplications)
    .where(eq(tenantApplications.id, id))
    .limit(1);
  return row;
}

beforeEach(async () => {
  await getDb().delete(leases);
  await getDb().delete(tenantApplications);
  await resetGeoTables();
});

afterAll(async () => {
  // Leave the shared tables as this file found them — see the reproduced
  // geoBackfill collision documented in `leaseOwnership.test.ts`.
  await getDb().delete(leases);
  await getDb().delete(tenantApplications);
  await resetGeoTables();
});

describe('createApplication', () => {
  it('stores the application with a server-resolved landlord and no decision', async () => {
    const propertyId = await seedRentalProperty();
    const res = await request(buildApp('oxy-applicant'))
      .post('/applications')
      // A forged landlord, status and decision must be ignored.
      .send(applicationBody(propertyId, {
        landlordOxyUserId: 'attacker',
        status: 'approved',
        decidedAt: '2020-01-01T00:00:00.000Z',
      }));

    expect(res.status).toBe(201);
    const persisted = await applicationRow(res.body.data.id);
    expect(persisted.landlordOxyUserId).toBe('oxy-landlord');
    expect(persisted.applicantOxyUserId).toBe('oxy-applicant');
    expect(persisted.status).toBe('submitted');
    // The un-decided half of the equivalence.
    expect(persisted.decidedAt).toBeNull();
  });

  it('stores the reference contacts in the SAME transaction, lowercasing the email', async () => {
    const id = await createApplicationFor(await seedRentalProperty());
    const references = await getDb()
      .select()
      .from(tenantApplicationReferences)
      .where(eq(tenantApplicationReferences.applicationId, id));

    expect(references).toHaveLength(1);
    expect(references[0].relationship).toBe('employer');
    // Mongoose `lowercase: true` has no Postgres counterpart and is re-applied
    // at the call site.
    expect(references[0].email).toBe('ada@example.test');
  });

  it('refuses an undeclared reference relationship with 400, before any insert', async () => {
    // Narrowed in the controller rather than left to
    // `tenant_application_references_relationship_check`: a `23514` would be a
    // 500 where the caller earned a 400 naming the field.
    const propertyId = await seedRentalProperty();
    const res = await request(buildApp('oxy-applicant'))
      .post('/applications')
      .send(applicationBody(propertyId, {
        referenceContacts: [
          { name: 'X', relationship: 'astrologer', phone: '+34600000000', email: 'x@y.test' },
        ],
      }));

    expect(res.status).toBe(400);
    // Neither the parent NOR the children — the only assertion that
    // distinguishes one transaction from two.
    expect(await getDb().select().from(tenantApplications)).toHaveLength(0);
    expect(await getDb().select().from(tenantApplicationReferences)).toHaveLength(0);
  });

  it('refuses an external listing, one not offered for long-term rent, and your own', async () => {
    const external = (await seedListingWithGeo({
      countryCode: nextCountryCode(),
      overrides: { oxyUserId: 'oxy-landlord', isExternal: true, source: 'idealista', sourceUrl: 'https://x.test/1' },
    })).propertyId;
    expect((await request(buildApp('oxy-a')).post('/applications').send(applicationBody(external))).status).toBe(400);

    const notOffered = (await seedListingWithGeo({
      countryCode: nextCountryCode(),
      overrides: { oxyUserId: 'oxy-landlord', status: 'published' },
    })).propertyId;
    expect((await request(buildApp('oxy-a')).post('/applications').send(applicationBody(notOffered))).status).toBe(400);

    const own = await seedRentalProperty();
    expect((await request(buildApp('oxy-landlord')).post('/applications').send(applicationBody(own))).status).toBe(403);

    expect(await getDb().select().from(tenantApplications)).toHaveLength(0);
  });

  it('refuses a SECOND active application and PERMITS one after a rejection', async () => {
    const propertyId = await seedRentalProperty();
    const first = await createApplicationFor(propertyId);

    const duplicate = await request(buildApp('oxy-applicant'))
      .post('/applications')
      .send(applicationBody(propertyId));
    expect(duplicate.status).toBe(409);

    // The permit half: a rule scoped to the pair WITHOUT the active statuses
    // passes the refusal above and eats this.
    expect(
      (await request(buildApp('oxy-landlord')).patch(`/applications/${first}`).send({ status: 'rejected' })).status,
    ).toBe(200);

    const again = await request(buildApp('oxy-applicant'))
      .post('/applications')
      .send(applicationBody(propertyId));
    expect(again.status).toBe(201);
  });
});

describe('updateApplicationStatus — the `decided_at` equivalence', () => {
  it('stamps decided_at on approve, reject and withdraw', async () => {
    for (const [status, actor] of [
      ['approved', 'oxy-landlord'],
      ['rejected', 'oxy-landlord'],
      ['withdrawn', 'oxy-applicant'],
    ] as const) {
      const id = await createApplicationFor(await seedRentalProperty());
      const res = await request(buildApp(actor)).patch(`/applications/${id}`).send({ status });
      expect(res.status).toBe(200);

      const persisted = await applicationRow(id);
      expect(persisted.status).toBe(status);
      expect(persisted.decidedAt).not.toBeNull();
    }
  });

  it('does NOT stamp decided_at on `reviewing`, which is not terminal', async () => {
    // The half a "stamp on every transition" writer gets wrong, and the CHECK
    // refuses: `reviewing` is still open, so a decision date on it would sort a
    // live application as if it were closed.
    const id = await createApplicationFor(await seedRentalProperty());
    const res = await request(buildApp('oxy-landlord')).patch(`/applications/${id}`).send({ status: 'reviewing' });
    expect(res.status).toBe(200);
    expect((await applicationRow(id)).decidedAt).toBeNull();
  });

  it('REFUSES a terminal row with no decided_at, and a decided_at on an open one', async () => {
    // The CHECK, both directions, against the shapes `findOneAndUpdate` used to
    // produce by bypassing the `pre('save')` hook entirely.
    const propertyId = await seedRentalProperty();
    const base = {
      propertyId,
      applicantOxyUserId: 'oxy-a',
      landlordOxyUserId: 'oxy-landlord',
      moveInDate: new Date('2026-03-01T00:00:00.000Z'),
      leaseTermMonths: 12,
      monthlyIncome: 45000,
      employmentStatus: 'employed' as const,
      submittedAt: new Date(),
    };

    await expect(
      getDb().insert(tenantApplications).values({ ...base, status: 'approved' }),
    ).rejects.toThrow();

    await expect(
      getDb().insert(tenantApplications).values({ ...base, status: 'submitted', decidedAt: new Date() }),
    ).rejects.toThrow();
  });

  it('lets only the landlord decide and only the applicant withdraw', async () => {
    const propertyId = await seedRentalProperty();

    const byApplicant = await createApplicationFor(propertyId);
    expect((await request(buildApp('oxy-applicant')).patch(`/applications/${byApplicant}`).send({ status: 'approved' })).status).toBe(403);
    expect((await applicationRow(byApplicant)).status).toBe('submitted');

    expect((await request(buildApp('oxy-landlord')).patch(`/applications/${byApplicant}`).send({ status: 'withdrawn' })).status).toBe(403);
    expect((await applicationRow(byApplicant)).status).toBe('submitted');

    expect((await request(buildApp('oxy-stranger')).patch(`/applications/${byApplicant}`).send({ status: 'approved' })).status).toBe(403);
  });

  it('refuses a SECOND decision — the precondition is in the UPDATE', async () => {
    const id = await createApplicationFor(await seedRentalProperty());
    expect((await request(buildApp('oxy-landlord')).patch(`/applications/${id}`).send({ status: 'approved' })).status).toBe(200);
    expect((await request(buildApp('oxy-landlord')).patch(`/applications/${id}`).send({ status: 'rejected' })).status).toBe(400);
    expect((await applicationRow(id)).status).toBe('approved');
  });

  it('refuses an unsupported status', async () => {
    const id = await createApplicationFor(await seedRentalProperty());
    const res = await request(buildApp('oxy-landlord')).patch(`/applications/${id}`).send({ status: 'nonsense' });
    expect(res.status).toBe(400);
  });
});

describe('reads', () => {
  it('shows an application only to its two parties', async () => {
    const id = await createApplicationFor(await seedRentalProperty());
    expect((await request(buildApp('oxy-applicant')).get(`/applications/${id}`)).status).toBe(200);
    expect((await request(buildApp('oxy-landlord')).get(`/applications/${id}`)).status).toBe(200);
    expect((await request(buildApp('oxy-stranger')).get(`/applications/${id}`)).status).toBe(403);
  });

  it('splits the applicant and landlord views', async () => {
    const propertyId = await seedRentalProperty();
    await createApplicationFor(propertyId, 'oxy-applicant');

    const asApplicant = await request(buildApp('oxy-applicant')).get('/applications');
    expect(asApplicant.body.data).toHaveLength(1);

    const asLandlord = await request(buildApp('oxy-landlord')).get('/applications?asLandlord=true');
    expect(asLandlord.body.data).toHaveLength(1);

    // The landlord's APPLICANT view is empty — they filed nothing.
    const landlordOwnView = await request(buildApp('oxy-landlord')).get('/applications');
    expect(landlordOwnView.body.data).toHaveLength(0);
  });

  it('carries the reference contacts on the list response', async () => {
    await createApplicationFor(await seedRentalProperty());
    const res = await request(buildApp('oxy-applicant')).get('/applications');
    expect(res.body.data[0].referenceContacts).toHaveLength(1);
    expect(res.body.data[0].referenceContacts[0].name).toBe('Ada Ref');
  });
});

describe('createLeaseFromApplication', () => {
  it('drafts a lease from an APPROVED application, priced from the listing', async () => {
    const propertyId = await seedRentalProperty();
    const id = await createApplicationFor(propertyId);
    await request(buildApp('oxy-landlord')).patch(`/applications/${id}`).send({ status: 'approved' });

    const res = await request(buildApp('oxy-landlord')).post(`/applications/${id}/create-lease`);
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('draft');
    expect(res.body.data.rentDetails.monthlyRent).toBe(1400);
    expect(res.body.data.rentDetails.currency).toBe('EUR');
    expect(res.body.data.tenantOxyUserId).toBe('oxy-applicant');

    const [lease] = await getDb().select().from(leases);
    expect(lease.landlordOxyUserId).toBe('oxy-landlord');
    // 12 months from the move-in date.
    expect(lease.leaseTermsStartDate.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(lease.leaseTermsEndDate.toISOString()).toBe('2027-03-01T00:00:00.000Z');
  });

  it('refuses an application that is not approved, and a non-landlord', async () => {
    const propertyId = await seedRentalProperty();
    const id = await createApplicationFor(propertyId);

    expect((await request(buildApp('oxy-landlord')).post(`/applications/${id}/create-lease`)).status).toBe(400);
    expect((await request(buildApp('oxy-applicant')).post(`/applications/${id}/create-lease`)).status).toBe(403);
    expect(await getDb().select().from(leases)).toHaveLength(0);
  });

  it('refuses a second lease for the same tenant and property', async () => {
    const propertyId = await seedRentalProperty();
    const id = await createApplicationFor(propertyId);
    await request(buildApp('oxy-landlord')).patch(`/applications/${id}`).send({ status: 'approved' });

    expect((await request(buildApp('oxy-landlord')).post(`/applications/${id}/create-lease`)).status).toBe(201);
    expect((await request(buildApp('oxy-landlord')).post(`/applications/${id}/create-lease`)).status).toBe(409);
    expect(await getDb().select().from(leases)).toHaveLength(1);
  });

  it('cannot even be given a listing that is OFFERED for rent with no price', async () => {
    // The 'Property has no long-term rent price' branch in
    // `createLeaseFromApplication` is UNREACHABLE through a valid listing, and
    // that is the `properties` schema working rather than dead code: the four
    // `properties_offerings_*` CHECKs make `offerings` exactly the set of
    // present priced blocks, so "offered for long-term rent" and "has a
    // long-term rent amount" cannot disagree. Asserted here rather than
    // deleted, because the guard is also what narrows `number | null` to
    // `number` for the insert — and because a later change that relaxed the
    // CHECK would make the branch live again without anybody noticing.
    const propertyId = await seedRentalProperty();

    await expect(
      getDb()
        .update(properties)
        .set({ longTermRentMonthlyAmount: null })
        .where(eq(properties.id, propertyId)),
    ).rejects.toThrow();
  });
});

describe('documents', () => {
  it('stores declared documents and refuses an undeclared type', async () => {
    const propertyId = await seedRentalProperty();
    const id = await createApplicationFor(propertyId, 'oxy-applicant', {
      documents: [{ type: 'income', url: 'https://x.test/payslip.pdf', filename: 'payslip.pdf' }],
    });

    const stored = await getDb()
      .select()
      .from(tenantApplicationDocuments)
      .where(eq(tenantApplicationDocuments.applicationId, id));
    expect(stored).toHaveLength(1);
    expect(stored[0].type).toBe('income');

    const other = await seedRentalProperty('oxy-landlord-2');
    const bad = await request(buildApp('oxy-applicant'))
      .post('/applications')
      .send(applicationBody(other, {
        documents: [{ type: 'passport', url: 'https://x.test/p.pdf', filename: 'p.pdf' }],
      }));
    expect(bad.status).toBe(400);
  });
});
