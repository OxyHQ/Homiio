/**
 * A receipt for rent that actually settled (#518 §7.2, #519 §7.2).
 *
 * §7.2 asks for "recibos reales con permisos de descarga. Totales y estados
 * derivados de datos persistidos, no de una página parcial ni de las cifras del
 * template."
 *
 * ## The two things that can go wrong, and neither throws
 *
 * **A receipt for money that never arrived.** A tenant's declaration is stored
 * `pending` and settles nothing. A receipt issued for one would be a document
 * asserting the payment arrived because somebody said it had — the exact
 * confusion the ledger exists to prevent, printed onto a page and downloaded.
 *
 * **A receipt that outlives the truth.** Nothing is stored, so there is no
 * second answer to "what was paid". The case below refunds a settled payment
 * and asserts the ledger's balance moves while the original receipt keeps
 * saying what it always said — because the original movement is still
 * `succeeded`, which is what a refund-as-its-own-row model means.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { LeaseStatus, PropertyStatus } from '@homiio/shared-types';

import * as leasePaymentController from '../../controllers/leasePaymentController';
import { getDb } from '../../db/postgres';
import { leasePaymentMovements, leasePaymentSchedule, leases } from '../../db/schema';
import { errorHandler } from '../../middlewares/errorHandler';
import { serializeWireIds } from '../../middlewares/wireIds';
import { objectIdHex, resetGeoTables, seedListingWithGeo } from '../helpers/postgresGeoFixtures';

const LANDLORD = 'oxy-landlord';
const TENANT = 'oxy-tenant';
const STRANGER = 'oxy-stranger';

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
  app.get('/leases/:id/ledger', leasePaymentController.getLedger);
  app.post(
    '/leases/:id/obligations/:obligationId/declarations',
    leasePaymentController.declarePayment,
  );
  app.post('/leases/:id/movements/:movementId/confirm', leasePaymentController.confirmPayment);
  app.post('/leases/:id/movements/:movementId/refunds', leasePaymentController.refundPayment);
  app.get('/leases/:id/movements/:movementId/receipt', leasePaymentController.getReceipt);
  app.use(errorHandler);
  return app;
}

let geoCounter = 0;

async function seedLeaseWithObligation(): Promise<{ leaseId: string; obligationId: string }> {
  geoCounter += 1;
  const { propertyId } = await seedListingWithGeo({
    countryCode: `R${geoCounter}`,
    cityName: `Receiptville ${geoCounter}`,
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
      rentDetailsCurrency: 'EUR',
    })
    .returning({ id: leases.id });

  const [obligation] = await getDb()
    .insert(leasePaymentSchedule)
    .values({
      leaseId: lease.id,
      dueDate: new Date('2026-02-01T00:00:00.000Z'),
      amount: 900,
      type: 'rent',
      status: 'pending',
    })
    .returning({ id: leasePaymentSchedule.id });

  return { leaseId: lease.id, obligationId: obligation.id };
}

/** Declare and confirm, which is the only way a movement reaches `succeeded`. */
async function settledMovement(fixture: { leaseId: string; obligationId: string }): Promise<string> {
  const declared = await request(buildApp(TENANT))
    .post(`/leases/${fixture.leaseId}/obligations/${fixture.obligationId}/declarations`)
    .send({ idempotencyKey: `receipt-${objectIdHex()}` });
  expect(declared.status).toBe(201);
  const movementId = declared.body.data.id;

  const confirmed = await request(buildApp(LANDLORD))
    .post(`/leases/${fixture.leaseId}/movements/${movementId}/confirm`)
    .send({});
  expect(confirmed.status).toBe(200);
  return movementId;
}

/**
 * Leave the shared tables as this file found them.
 *
 * A suite that only cleans up on the way IN leaves its last test's rows behind,
 * and the next suite in the same worker inherits them. That is not a
 * hypothetical: `__tests__/db/tenancyRanges.test.ts` counts the rows a range
 * index contains, so a stray lease makes it read 2 where it expects 1 — and the
 * failure lands in THAT file, which has nothing to do with the leak.
 */
async function reset(): Promise<void> {
  await getDb().delete(leases);
  await resetGeoTables();
}

beforeEach(reset);
afterAll(reset);

describe('a receipt exists only for money that arrived', () => {
  it('refuses one for a declaration the landlord has not confirmed', async () => {
    const fixture = await seedLeaseWithObligation();
    const declared = await request(buildApp(TENANT))
      .post(`/leases/${fixture.leaseId}/obligations/${fixture.obligationId}/declarations`)
      .send({ idempotencyKey: 'receipt-pending-001' });

    const res = await request(buildApp(TENANT)).get(
      `/leases/${fixture.leaseId}/movements/${declared.body.data.id}/receipt`,
    );

    // 409, not 404: the payment is there and the tenant may see it. What does
    // not exist is a receipt, and saying which is more use than pretending the
    // movement is missing.
    expect(res.status).toBe(409);
    expect(res.text).not.toContain('Rent receipt');
  });

  it('issues one once it is confirmed', async () => {
    const fixture = await seedLeaseWithObligation();
    const movementId = await settledMovement(fixture);

    const res = await request(buildApp(TENANT)).get(
      `/leases/${fixture.leaseId}/movements/${movementId}/receipt`,
    );

    expect(res.status).toBe(200);
    expect(res.body.data.contentType).toContain('text/html');
    expect(res.body.data.filename).toContain(movementId);
    // Somebody's tenancy. A proxy keeping a copy would undo the permissions.
    expect(res.headers['cache-control']).toBe('private, no-store');
    const html = Buffer.from(res.body.data.base64, 'base64').toString('utf8');
    expect(html).toContain('Rent receipt');
    expect(html).toContain(movementId);
  });

  it('carries the amount from the LEDGER, not from a template figure', async () => {
    const fixture = await seedLeaseWithObligation();
    // A partial payment: a receipt that printed the obligation's 900 rather
    // than what settled would look right and be wrong.
    const declared = await request(buildApp(TENANT))
      .post(`/leases/${fixture.leaseId}/obligations/${fixture.obligationId}/declarations`)
      .send({ idempotencyKey: 'receipt-partial-001', amount: 400 });
    await request(buildApp(LANDLORD))
      .post(`/leases/${fixture.leaseId}/movements/${declared.body.data.id}/confirm`)
      .send({});

    const res = await request(buildApp(TENANT)).get(
      `/leases/${fixture.leaseId}/movements/${declared.body.data.id}/receipt`,
    );

    expect(res.status).toBe(200);
    const html = Buffer.from(res.body.data.base64, 'base64').toString('utf8');
    expect(html).toContain('400');
    expect(html).not.toContain('900');
  });
});

describe('who may download one', () => {
  it('gives it to both parties', async () => {
    const fixture = await seedLeaseWithObligation();
    const movementId = await settledMovement(fixture);

    for (const viewer of [TENANT, LANDLORD]) {
      const res = await request(buildApp(viewer)).get(
        `/leases/${fixture.leaseId}/movements/${movementId}/receipt`,
      );
      expect(res.status).toBe(200);
    }
  });

  it('gives a stranger a 404', async () => {
    const fixture = await seedLeaseWithObligation();
    const movementId = await settledMovement(fixture);

    const res = await request(buildApp(STRANGER)).get(
      `/leases/${fixture.leaseId}/movements/${movementId}/receipt`,
    );

    expect(res.status).toBe(404);
    expect(res.text).not.toContain('Rent receipt');
  });

  it('refuses a movement id from another lease', async () => {
    const mine = await seedLeaseWithObligation();
    const theirs = await seedLeaseWithObligation();
    const theirMovement = await settledMovement(theirs);

    // The tenant of both, so access passes and only the lease scoping can
    // refuse: knowing an id grants nothing.
    const res = await request(buildApp(TENANT)).get(
      `/leases/${mine.leaseId}/movements/${theirMovement}/receipt`,
    );

    expect(res.status).toBe(404);
  });
});

describe('nothing is stored, so nothing can go stale', () => {
  it('leaves the original receipt true after a refund', async () => {
    const fixture = await seedLeaseWithObligation();
    const movementId = await settledMovement(fixture);

    const refunded = await request(buildApp(LANDLORD))
      .post(`/leases/${fixture.leaseId}/movements/${movementId}/refunds`)
      .send({ idempotencyKey: 'receipt-refund-001' });
    expect(refunded.status).toBe(201);

    const ledger = await request(buildApp(TENANT)).get(`/leases/${fixture.leaseId}/ledger`);
    const [summary] = ledger.body.data.obligations;

    const res = await request(buildApp(TENANT)).get(
      `/leases/${fixture.leaseId}/movements/${movementId}/receipt`,
    );

    // The balance moved…
    expect(summary.settledAmount).toBe(0);
    // …and the receipt for the original payment still says what it always said,
    // because a refund is its own row and the original stays `succeeded`. A
    // stored receipt would have had to be reconciled or invalidated; a derived
    // one simply keeps describing the movement it describes.
    expect(res.status).toBe(200);
    expect(Buffer.from(res.body.data.base64, 'base64').toString('utf8')).toContain(movementId);
  });

  it('writes no receipt row anywhere', async () => {
    const fixture = await seedLeaseWithObligation();
    const movementId = await settledMovement(fixture);
    await request(buildApp(TENANT)).get(
      `/leases/${fixture.leaseId}/movements/${movementId}/receipt`,
    );

    // The floor under "derived, never stored": asking for a receipt must not
    // create anything. Two movements would mean the render had side effects.
    const movements = await getDb()
      .select()
      .from(leasePaymentMovements)
      .where(eq(leasePaymentMovements.leaseId, fixture.leaseId));
    expect(movements).toHaveLength(1);
  });
});
