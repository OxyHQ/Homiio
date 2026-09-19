/**
 * The rent ledger, against the REAL Postgres (#518 §7.2, #519 §7.2).
 *
 * ## The four things that have a way to be wrong
 *
 *  - **A declaration is not a payment.** The balance must not move until a
 *    landlord confirms. A version that settled on declaration would satisfy
 *    every "it worked" assertion, so the balance is checked at each step.
 *  - **Idempotency is an insert, not a lookup.** The double-tap case fires two
 *    requests CONCURRENTLY with one key, and asserts one row — a
 *    select-then-insert passes a sequential test and fails this one.
 *  - **A refund is a row, not an edit.** The original is re-read after the
 *    refund and asserted still `succeeded`.
 *  - **The obligation's own `status` is not the answer.** `recordPayment` is
 *    gone, so nothing can mark an obligation paid behind the ledger; a source
 *    gate below asserts that.
 *
 * Every authorization refusal RE-READS the table, because a handler that 403s
 * and writes anyway satisfies any assertion made on its response alone.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { LeaseStatus, PropertyStatus } from '@homiio/shared-types';

import * as leasePaymentController from '../../controllers/leasePaymentController';
import leaseController from '../../controllers/leaseController';
import { getDb } from '../../db/postgres';
import { recordMovement } from '../../db/leases/paymentLedger';
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
  app.post('/leases/:id/movements/:movementId/reject', leasePaymentController.rejectPayment);
  app.post('/leases/:id/movements/:movementId/refunds', leasePaymentController.refundPayment);
  app.post('/leases/:id/payments', (req, res, next) =>
    leaseController.createPayment(req, res, next),
  );
  app.use(errorHandler);
  return app;
}

interface Fixture {
  leaseId: string;
  obligationId: string;
}

/** An active tenancy with one €900 rent obligation. */
async function seedLeaseWithObligation(): Promise<Fixture> {
  const { propertyId } = await seedListingWithGeo({
    countryCode: `L${Math.floor(Math.random() * 90 + 10)}`,
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
    })
    .returning({ id: leasePaymentSchedule.id });
  return { leaseId: lease.id, obligationId: obligation.id };
}

const movementsOf = async (leaseId: string) =>
  getDb().select().from(leasePaymentMovements).where(eq(leasePaymentMovements.leaseId, leaseId));

async function ledger(leaseId: string, as = TENANT) {
  const res = await request(buildApp(as)).get(`/leases/${leaseId}/ledger`);
  expect(res.status).toBe(200);
  return res.body.data as {
    movements: Array<{ id: string; state: string; direction: string }>;
    obligations: Array<{
      obligationId: string;
      settledAmount: number;
      outstandingAmount: number;
      declaredAmount: number;
      settled: boolean;
    }>;
  };
}

const declare = (fixture: Fixture, body: Record<string, unknown>, as = TENANT) =>
  request(buildApp(as))
    .post(`/leases/${fixture.leaseId}/obligations/${fixture.obligationId}/declarations`)
    .send(body);

beforeEach(async () => {
  await getDb().delete(leasePaymentMovements);
  await resetGeoTables();
});

describe('a declaration is not a payment', () => {
  it('records the tenant’s claim as pending and does NOT move the balance', async () => {
    const fixture = await seedLeaseWithObligation();

    const res = await declare(fixture, { idempotencyKey: 'declare-001', amount: 900 });
    expect(res.status).toBe(201);
    expect(res.body.data.state).toBe('pending');
    expect(res.body.data.kind).toBe('manual_declaration');

    const after = await ledger(fixture.leaseId);
    // The assertion this whole file exists for: nothing has settled.
    expect(after.obligations[0].settledAmount).toBe(0);
    expect(after.obligations[0].outstandingAmount).toBe(900);
    // …but the claim is visible and named as a claim.
    expect(after.obligations[0].declaredAmount).toBe(900);
    expect(after.obligations[0].settled).toBe(false);
  });

  it('settles only once the landlord confirms', async () => {
    const fixture = await seedLeaseWithObligation();
    const declared = await declare(fixture, { idempotencyKey: 'declare-002' });

    const confirmed = await request(buildApp(LANDLORD))
      .post(`/leases/${fixture.leaseId}/movements/${declared.body.data.id}/confirm`)
      .send({});
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.state).toBe('succeeded');
    expect(confirmed.body.data.confirmedByOxyUserId).toBe(LANDLORD);

    const after = await ledger(fixture.leaseId);
    expect(after.obligations[0].settledAmount).toBe(900);
    expect(after.obligations[0].outstandingAmount).toBe(0);
    expect(after.obligations[0].declaredAmount).toBe(0);
    expect(after.obligations[0].settled).toBe(true);
  });

  it('defaults the amount to what is OUTSTANDING, not to the whole obligation', async () => {
    const fixture = await seedLeaseWithObligation();
    const first = await declare(fixture, { idempotencyKey: 'declare-003', amount: 400 });
    await request(buildApp(LANDLORD))
      .post(`/leases/${fixture.leaseId}/movements/${first.body.data.id}/confirm`)
      .send({});

    const second = await declare(fixture, { idempotencyKey: 'declare-004' });
    // 500, not 900: a default that ignored the ledger would over-declare by
    // design after every partial payment.
    expect(second.body.data.amount).toBe(500);
  });

  it('refuses a declaration larger than what is left, rather than clamping it', async () => {
    const fixture = await seedLeaseWithObligation();
    const res = await declare(fixture, { idempotencyKey: 'declare-005', amount: 1200 });

    expect(res.status).toBe(400);
    expect(await movementsOf(fixture.leaseId)).toHaveLength(0);
  });

  it('refuses a declaration on a settled obligation', async () => {
    const fixture = await seedLeaseWithObligation();
    const first = await declare(fixture, { idempotencyKey: 'declare-006' });
    await request(buildApp(LANDLORD))
      .post(`/leases/${fixture.leaseId}/movements/${first.body.data.id}/confirm`)
      .send({});

    const second = await declare(fixture, { idempotencyKey: 'declare-007' });
    expect(second.status).toBe(409);
    expect(await movementsOf(fixture.leaseId)).toHaveLength(1);
  });

  it('takes the currency from the LEASE and not from the body', async () => {
    const fixture = await seedLeaseWithObligation();
    const res = await declare(fixture, { idempotencyKey: 'declare-008', currency: 'USD' });
    // The lease is in EUR. A caller naming their own currency would be naming
    // how much they paid in a different unit.
    expect(res.body.data.currency).toBe('EUR');
  });
});

describe('partial payments', () => {
  it('two confirmed halves settle the obligation and each survives as its own row', async () => {
    const fixture = await seedLeaseWithObligation();
    const landlord = buildApp(LANDLORD);

    for (const [key, amount] of [
      ['part-001', 400],
      ['part-002', 500],
    ] as const) {
      const declared = await declare(fixture, { idempotencyKey: key, amount });
      await request(landlord)
        .post(`/leases/${fixture.leaseId}/movements/${declared.body.data.id}/confirm`)
        .send({});
    }

    const after = await ledger(fixture.leaseId);
    expect(after.obligations[0].settledAmount).toBe(900);
    expect(after.obligations[0].settled).toBe(true);
    // TWO rows: an obligation that could only hold one payment would have lost
    // the first.
    expect(after.movements).toHaveLength(2);
  });

  it('reports the remainder while only one half has settled', async () => {
    const fixture = await seedLeaseWithObligation();
    const declared = await declare(fixture, { idempotencyKey: 'part-003', amount: 400 });
    await request(buildApp(LANDLORD))
      .post(`/leases/${fixture.leaseId}/movements/${declared.body.data.id}/confirm`)
      .send({});

    const after = await ledger(fixture.leaseId);
    expect(after.obligations[0].settledAmount).toBe(400);
    expect(after.obligations[0].outstandingAmount).toBe(500);
    expect(after.obligations[0].settled).toBe(false);
  });
});

describe('idempotency', () => {
  it('a double tap over HTTP creates one movement, not two', async () => {
    const fixture = await seedLeaseWithObligation();

    const [first, second] = await Promise.all([
      declare(fixture, { idempotencyKey: 'double-tap-001', amount: 900 }),
      declare(fixture, { idempotencyKey: 'double-tap-001', amount: 900 }),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 201]);
    expect(first.body.data.id).toBe(second.body.data.id);
    expect(await movementsOf(fixture.leaseId)).toHaveLength(1);
  });

  /**
   * The case above is NOT the guarantee, and saying so is the point.
   *
   * It was written as "two concurrent requests" and then MUTATION-TESTED:
   * replacing `on conflict do nothing` with the naive select-then-insert left
   * it green. Two supertest requests in a `Promise.all` do not reliably
   * interleave a `SELECT` and an `INSERT` across two pooled connections — the
   * first usually finishes before the second looks — so it measures the happy
   * path and calls it a race.
   *
   * This one forces the interleaving the naive implementation actually loses
   * to: a concurrent transaction inserts the key and has NOT COMMITTED when
   * `recordMovement` runs. Under READ COMMITTED its `SELECT` sees nothing (the
   * other row is invisible), its `INSERT` blocks on the unique index, and when
   * the other transaction commits the naive version raises a unique violation
   * while `on conflict do nothing` returns no row and re-reads the winner.
   *
   * Confirmed by mutation: with the naive shape this case throws.
   */
  it('survives a conflict committed AFTER it looked — the actual guarantee', async () => {
    const fixture = await seedLeaseWithObligation();
    const db = getDb();
    const key = 'interleaved-001';

    /** Resolves once the holding transaction has inserted and is about to commit. */
    let inserted: () => void = () => undefined;
    const hasInserted = new Promise<void>((resolve) => {
      inserted = resolve;
    });
    /** Held open until the racing write has started. */
    let commit: () => void = () => undefined;
    const mayCommit = new Promise<void>((resolve) => {
      commit = resolve;
    });

    const holder = db.transaction(async (tx) => {
      await tx.insert(leasePaymentMovements).values({
        leaseId: fixture.leaseId,
        obligationId: fixture.obligationId,
        direction: 'payment',
        kind: 'manual_declaration',
        state: 'pending',
        amount: 900,
        currency: 'EUR',
        createdByOxyUserId: TENANT,
        idempotencyKey: key,
      });
      inserted();
      await mayCommit;
    });

    await hasInserted;
    // Started while the other transaction holds the key uncommitted. Its own
    // read cannot see that row; its insert will block.
    const racing = recordMovement(db, {
      leaseId: fixture.leaseId,
      obligationId: fixture.obligationId,
      direction: 'payment',
      kind: 'manual_declaration',
      state: 'pending',
      amount: 900,
      currency: 'EUR',
      createdByOxyUserId: TENANT,
      idempotencyKey: key,
    });

    // Give the racing insert a moment to reach the index and block on it.
    await new Promise((resolve) => setTimeout(resolve, 50));
    commit();
    await holder;

    const outcome = await racing;
    expect(outcome.deduped).toBe(true);
    expect(await movementsOf(fixture.leaseId)).toHaveLength(1);
    expect(outcome.movement.idempotencyKey).toBe(key);
  });

  it('a retry with the same key answers 200 and the row that already exists', async () => {
    const fixture = await seedLeaseWithObligation();
    const first = await declare(fixture, { idempotencyKey: 'retry-001', amount: 900 });
    const retry = await declare(fixture, { idempotencyKey: 'retry-001', amount: 900 });

    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.body.data.id).toBe(first.body.data.id);
  });

  it('a DIFFERENT key is a different payment', async () => {
    const fixture = await seedLeaseWithObligation();
    await declare(fixture, { idempotencyKey: 'differ-001', amount: 400 });
    await declare(fixture, { idempotencyKey: 'differ-002', amount: 400 });
    expect(await movementsOf(fixture.leaseId)).toHaveLength(2);
  });

  it('refuses a malformed key rather than minting one', async () => {
    const fixture = await seedLeaseWithObligation();
    for (const key of ['', 'short', 'has spaces in it']) {
      const res = await declare(fixture, { idempotencyKey: key });
      expect({ key, status: res.status }).toEqual({ key, status: 400 });
    }
    expect(await movementsOf(fixture.leaseId)).toHaveLength(0);
  });
});

describe('confirmation and rejection', () => {
  it('two landlords confirming at once produce ONE confirmation', async () => {
    const fixture = await seedLeaseWithObligation();
    const declared = await declare(fixture, { idempotencyKey: 'confirm-001' });
    const landlord = buildApp(LANDLORD);
    const url = `/leases/${fixture.leaseId}/movements/${declared.body.data.id}/confirm`;

    const [first, second] = await Promise.all([
      request(landlord).post(url).send({}),
      request(landlord).post(url).send({}),
    ]);

    // Both succeed — the second is "already how you wanted it", which is a
    // worse answer as a 409 — but only one confirmation is recorded.
    expect([first.status, second.status]).toEqual([200, 200]);
    const after = await ledger(fixture.leaseId);
    expect(after.obligations[0].settledAmount).toBe(900);
    expect(after.movements.filter((m) => m.state === 'succeeded')).toHaveLength(1);
  });

  it('a TENANT cannot confirm their own declaration, and nothing changes', async () => {
    const fixture = await seedLeaseWithObligation();
    const declared = await declare(fixture, { idempotencyKey: 'confirm-002' });

    const res = await request(buildApp(TENANT))
      .post(`/leases/${fixture.leaseId}/movements/${declared.body.data.id}/confirm`)
      .send({});

    expect(res.status).toBe(403);
    const after = await ledger(fixture.leaseId);
    expect(after.obligations[0].settledAmount).toBe(0);
  });

  it('a rejection needs a reason, and carries it', async () => {
    const fixture = await seedLeaseWithObligation();
    const declared = await declare(fixture, { idempotencyKey: 'reject-001' });
    const url = `/leases/${fixture.leaseId}/movements/${declared.body.data.id}/reject`;

    expect((await request(buildApp(LANDLORD)).post(url).send({})).status).toBe(400);

    const rejected = await request(buildApp(LANDLORD))
      .post(url)
      .send({ reason: 'Nothing arrived in the account' });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.state).toBe('failed');
    expect(rejected.body.data.failureReason).toBe('Nothing arrived in the account');

    const after = await ledger(fixture.leaseId);
    // A failed claim is neither settled nor still outstanding as a claim.
    expect(after.obligations[0].settledAmount).toBe(0);
    expect(after.obligations[0].declaredAmount).toBe(0);
  });

  it('cannot confirm something already rejected', async () => {
    const fixture = await seedLeaseWithObligation();
    const declared = await declare(fixture, { idempotencyKey: 'reject-002' });
    const base = `/leases/${fixture.leaseId}/movements/${declared.body.data.id}`;
    await request(buildApp(LANDLORD)).post(`${base}/reject`).send({ reason: 'never arrived' });

    const res = await request(buildApp(LANDLORD)).post(`${base}/confirm`).send({});
    expect(res.status).toBe(409);
  });
});

describe('refunds', () => {
  it('records a refund as its own row and leaves the original settled', async () => {
    const fixture = await seedLeaseWithObligation();
    const declared = await declare(fixture, { idempotencyKey: 'refund-001' });
    const landlord = buildApp(LANDLORD);
    const movementId = declared.body.data.id;
    await request(landlord)
      .post(`/leases/${fixture.leaseId}/movements/${movementId}/confirm`)
      .send({});

    const refund = await request(landlord)
      .post(`/leases/${fixture.leaseId}/movements/${movementId}/refunds`)
      .send({ idempotencyKey: 'refund-key-001', amount: 300 });

    expect(refund.status).toBe(201);
    expect(refund.body.data.direction).toBe('refund');
    expect(refund.body.data.reversesMovementId).toBe(movementId);

    const after = await ledger(fixture.leaseId);
    expect(after.obligations[0].settledAmount).toBe(600);
    expect(after.obligations[0].outstandingAmount).toBe(300);
    // The original SURVIVES. A ledger that edited it would have nothing left to
    // reconcile against.
    const original = after.movements.find((m) => m.id === movementId);
    expect(original?.state).toBe('succeeded');
    expect(original?.direction).toBe('payment');
  });

  it('refuses to refund something that never settled', async () => {
    const fixture = await seedLeaseWithObligation();
    const declared = await declare(fixture, { idempotencyKey: 'refund-002' });

    const res = await request(buildApp(LANDLORD))
      .post(`/leases/${fixture.leaseId}/movements/${declared.body.data.id}/refunds`)
      .send({ idempotencyKey: 'refund-key-002' });

    expect(res.status).toBe(409);
    expect(await movementsOf(fixture.leaseId)).toHaveLength(1);
  });

  it('refuses a refund larger than the payment', async () => {
    const fixture = await seedLeaseWithObligation();
    const declared = await declare(fixture, { idempotencyKey: 'refund-003', amount: 400 });
    const landlord = buildApp(LANDLORD);
    await request(landlord)
      .post(`/leases/${fixture.leaseId}/movements/${declared.body.data.id}/confirm`)
      .send({});

    const res = await request(landlord)
      .post(`/leases/${fixture.leaseId}/movements/${declared.body.data.id}/refunds`)
      .send({ idempotencyKey: 'refund-key-003', amount: 900 });

    expect(res.status).toBe(400);
  });

  it('a tenant cannot record a refund', async () => {
    const fixture = await seedLeaseWithObligation();
    const declared = await declare(fixture, { idempotencyKey: 'refund-004' });
    await request(buildApp(LANDLORD))
      .post(`/leases/${fixture.leaseId}/movements/${declared.body.data.id}/confirm`)
      .send({});

    const res = await request(buildApp(TENANT))
      .post(`/leases/${fixture.leaseId}/movements/${declared.body.data.id}/refunds`)
      .send({ idempotencyKey: 'refund-key-004' });

    expect(res.status).toBe(403);
    expect(await movementsOf(fixture.leaseId)).toHaveLength(1);
  });
});

describe('who can see and touch a ledger', () => {
  it('a stranger gets 404 on every route, and writes nothing', async () => {
    const fixture = await seedLeaseWithObligation();
    const stranger = buildApp(STRANGER);

    expect((await request(stranger).get(`/leases/${fixture.leaseId}/ledger`)).status).toBe(404);
    const declared = await declare(fixture, { idempotencyKey: 'stranger-001' }, STRANGER);
    expect(declared.status).toBe(404);
    expect(await movementsOf(fixture.leaseId)).toHaveLength(0);
  });

  it('a landlord cannot declare a payment as though they were the tenant', async () => {
    const fixture = await seedLeaseWithObligation();
    const res = await declare(fixture, { idempotencyKey: 'landlord-001' }, LANDLORD);

    expect(res.status).toBe(403);
    expect(await movementsOf(fixture.leaseId)).toHaveLength(0);
  });

  it('an obligation id from another lease resolves to nothing', async () => {
    const mine = await seedLeaseWithObligation();
    const theirs = await seedLeaseWithObligation();

    const res = await request(buildApp(TENANT))
      .post(`/leases/${mine.leaseId}/obligations/${theirs.obligationId}/declarations`)
      .send({ idempotencyKey: 'cross-001' });

    expect(res.status).toBe(404);
    expect(await movementsOf(mine.leaseId)).toHaveLength(0);
  });
});

describe('nothing can mark an obligation paid behind the ledger', () => {
  it('recordPayment no longer exists', () => {
    // The dead writer is gone, so the balance has exactly one source. A SOURCE
    // gate rather than a behavioural one, because "no second writer" is a
    // claim about the whole package and a request cannot observe it.
    //
    // Read from disk rather than imported: a dynamic `import()` in this
    // package's TS config needs a file extension, and a static import of a name
    // that must NOT exist does not compile — which is the wrong kind of red.
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const { join } = require('node:path') as typeof import('node:path');
    const source = readFileSync(join(__dirname, '../../db/leases/leaseReads.ts'), 'utf8');
    expect(source).not.toMatch(/export async function recordPayment\b/);
    // The floor: a scan that stopped matching anything would pass the line
    // above. The file must still be the one that used to hold it.
    expect(source).toContain('export async function signLease');
  });

  it('adding an obligation does not settle anything', async () => {
    const fixture = await seedLeaseWithObligation();
    const res = await request(buildApp(LANDLORD))
      .post(`/leases/${fixture.leaseId}/payments`)
      .send({ dueDate: '2026-03-01T00:00:00.000Z', amount: 900, type: 'rent' });

    expect(res.status).toBe(201);
    const after = await ledger(fixture.leaseId);
    // Two obligations, nothing settled on either.
    expect(after.obligations).toHaveLength(2);
    expect(after.obligations.every((o) => o.settledAmount === 0)).toBe(true);
  });
});
