/**
 * Guest points, against the REAL Postgres (#518 §7.5, #519 §7.5).
 *
 * ## The five things that have a way to be wrong
 *
 *  - **A point can be spent twice.** Two stays reserving against one point is a
 *    LOST UPDATE — two legitimate rows with different keys — so no unique index
 *    can refuse it. The interleaved case below forces the exact ordering the
 *    unlocked implementation loses to: the loser starts its transaction while
 *    the winner holds the lock and has NOT committed. Mutation-tested —
 *    removing `.for('update')` from `reserveStayPoints` turns it red.
 *  - **A reserved point can be counted as spendable.** Every balance assertion
 *    names `available` as well as `balance`, because an implementation that
 *    ignored reservations agrees with the other on every settled ledger.
 *  - **A new member can be given a balance.** The zero case asserts zero and
 *    asserts `neverMoved`, which is the flag the surface needs to say the
 *    honest sentence instead of showing a number.
 *  - **Points can be minted.** Every case that moves points re-reads BOTH
 *    ledgers and asserts the pair sums to zero across the system.
 *  - **An authorization refusal can 404 and write anyway.** Every refusal
 *    re-reads `guest_point_movements`, because a response body proves nothing
 *    about what the handler did on its way to producing it.
 *
 * And the mirror of all of it: the PERMITTED cases are asserted too. An
 * implementation that refused every points stay would satisfy every refusal in
 * this file and fail the first half of it.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { guestPointStanding, guestPointsForWindow } from '@homiio/shared-types';

import exchangeController from '../../controllers/exchangeController';
import { getMyGuestPoints } from '../../controllers/guestPointsController';
import { getDb } from '../../db/postgres';
import {
  availablePointsOf,
  findReservation,
  listMovements,
  releaseExpiredReservations,
  reserveStayPoints,
  toMovementDTO,
} from '../../db/guestPoints/guestPointsLedger';
import { exchangeRequests, guestPointMovements } from '../../db/schema';
import { errorHandler } from '../../middlewares/errorHandler';
import {
  getCronStatus,
  initCronJobs,
  runGuestPointReleaseNow,
  stopCronJobs,
} from '../../services/cron';
import { resetGeoTables, seedListingWithGeo } from '../helpers/postgresGeoFixtures';

const GUEST = 'oxy-points-guest';
const HOST = 'oxy-points-host';
const STRANGER = 'oxy-points-stranger';

function buildApp(oxyUserId?: string): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (oxyUserId) {
      const authed = req as unknown as { user: { id: string }; userId: string };
      authed.user = { id: oxyUserId };
      authed.userId = oxyUserId;
    }
    next();
  });
  app.post('/exchanges', (req, res, next) =>
    exchangeController.createExchangeRequest(req, res, next),
  );
  app.patch('/exchanges/:id', (req, res, next) =>
    exchangeController.updateExchangeRequestStatus(req, res, next),
  );
  app.get('/guest-points', getMyGuestPoints);
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

/** A listing open to one-way hosting. */
async function seedHostListing(oxyUserId: string): Promise<string> {
  const { propertyId } = await seedListingWithGeo({
    countryCode: nextCountryCode(),
    overrides: {
      oxyUserId,
      status: 'published',
      isExternal: false,
      offerings: ['exchange'],
      exchangeMode: 'host',
    },
  });
  return propertyId;
}

const DAY = 24 * 60 * 60 * 1000;
const BASE = Date.now();

/** A window `fromDays`..`toDays` out, from ONE base so night counts are exact. */
function window(fromDays: number, toDays: number) {
  return {
    start: new Date(BASE + fromDays * DAY).toISOString(),
    end: new Date(BASE + toDays * DAY).toISOString(),
  };
}

const movementsOf = (oxyUserId: string) =>
  getDb()
    .select()
    .from(guestPointMovements)
    .where(eq(guestPointMovements.accountOxyUserId, oxyUserId));

const allMovements = () => getDb().select().from(guestPointMovements);

async function standingOf(oxyUserId: string) {
  return guestPointStanding((await listMovements(getDb(), oxyUserId)).map(toMovementDTO));
}

/**
 * Balance over the WHOLE system, excluding the one seeded origin row.
 *
 * Every point that this file's ledger paths create is somebody else's spend, so
 * the sum over everything they produce is exactly zero — which is the assertion
 * that catches minting, and it catches it wherever it happens rather than only
 * where a test thought to look.
 *
 * The exclusion is `earnByHosting`'s root: points have to start somewhere for
 * a chain of stays to exist at all, and that one row is written in SQL because
 * no endpoint can write it. It is named by its key prefix rather than skipped
 * silently, so the exemption cannot quietly widen.
 */
async function systemTotal(): Promise<number> {
  const rows = await allMovements();
  return rows.reduce((total, row) => {
    if (row.state !== 'settled') return total;
    if (row.idempotencyKey.startsWith('origin-')) return total;
    return total + (row.direction === 'earn' ? row.points : -row.points);
  }, 0);
}

/**
 * Give `oxyUserId` `points` settled points, the only way anybody ever gets any:
 * by hosting somebody for that many nights, through the real endpoints.
 *
 * Writing the rows directly would make every balance in this file a fixture
 * rather than a consequence, and a seed that can mint points is a seed that
 * proves the ledger cannot.
 */
async function earnByHosting(oxyUserId: string, points: number): Promise<void> {
  const counterparty = `${oxyUserId}-counterparty`;
  // The person we host must themselves have points to spend, so the chain is
  // rooted somewhere. It is rooted in SQL exactly once, at the bottom of the
  // chain, and that row is the only hand-written movement in this file.
  const propertyId = await seedHostListing(oxyUserId);
  const stay = window(200 + geoChainCounter * 10, 200 + geoChainCounter * 10 + points);

  const created = await request(buildApp(counterparty))
    .post('/exchanges')
    .send({
      propertyId,
      mode: 'host',
      requestedWindow: stay,
      usesGuestPoints: true,
      guestPointsIdempotencyKey: `seed-${oxyUserId}-${geoChainCounter}`.slice(0, 64),
    });
  // The counterparty starts at zero too, so the reservation is refused — and
  // that refusal is exactly the "no welcome grant" rule working. Seed their
  // side directly, then retry: one hand-written row, in one place.
  if (created.status === 409) {
    await getDb()
      .insert(guestPointMovements)
      .values({
        accountOxyUserId: counterparty,
        counterpartyOxyUserId: `${counterparty}-origin`,
        exchangeRequestId: await seedDetachedExchange(counterparty),
        direction: 'earn',
        state: 'settled',
        points,
        settledAt: new Date(),
        idempotencyKey: `origin-${counterparty}-${geoChainCounter}`.slice(0, 64),
      });
    const retried = await request(buildApp(counterparty))
      .post('/exchanges')
      .send({
        propertyId,
        mode: 'host',
        requestedWindow: stay,
        usesGuestPoints: true,
        guestPointsIdempotencyKey: `seed2-${oxyUserId}-${geoChainCounter}`.slice(0, 64),
      });
    expect(retried.status).toBe(201);
    const accepted = await request(buildApp(oxyUserId))
      .patch(`/exchanges/${retried.body.data.id}`)
      .send({ status: 'confirmed' });
    expect(accepted.status).toBe(200);
    return;
  }

  expect(created.status).toBe(201);
  const accepted = await request(buildApp(oxyUserId))
    .patch(`/exchanges/${created.body.data.id}`)
    .send({ status: 'confirmed' });
  expect(accepted.status).toBe(200);
}

/** An exchange request row for a movement that needs a parent and nothing else. */
async function seedDetachedExchange(requester: string): Promise<string> {
  const propertyId = await seedHostListing(`${requester}-origin`);
  const [row] = await getDb()
    .insert(exchangeRequests)
    .values({
      propertyId,
      requesterOxyUserId: requester,
      hostOxyUserId: `${requester}-origin`,
      mode: 'host',
      requestedWindowStart: new Date(BASE - 40 * DAY),
      requestedWindowEnd: new Date(BASE - 39 * DAY),
      status: 'completed',
    })
    .returning({ id: exchangeRequests.id });
  return row.id;
}

/**
 * A PENDING points stay whose dates have already gone by.
 *
 * Written through the repository rather than the endpoint, because the endpoint
 * refuses a window starting in the past — correctly, and that is precisely why
 * a stay reaches this state by TIME passing rather than by anybody asking for
 * it. Reproducing it any other way would mean waiting.
 */
async function seedExpiredPendingStay(
  guest: string,
  host: string,
  points: number,
): Promise<string> {
  await earnByHosting(guest, points);
  const propertyId = await seedHostListing(host);
  const [row] = await getDb()
    .insert(exchangeRequests)
    .values({
      propertyId,
      requesterOxyUserId: guest,
      hostOxyUserId: host,
      mode: 'host',
      requestedWindowStart: new Date(BASE - 10 * DAY),
      requestedWindowEnd: new Date(BASE - 3 * DAY),
      usesGuestPoints: true,
      status: 'pending',
    })
    .returning({ id: exchangeRequests.id });
  const reserved = await reserveStayPoints(getDb(), {
    exchangeRequestId: row.id,
    guestOxyUserId: guest,
    hostOxyUserId: host,
    points,
    idempotencyKey: `sweep-${row.id}`.slice(0, 64),
  });
  expect(reserved.ok).toBe(true);
  return row.id;
}

/** Ask for a points stay. */
const requestPointsStay = (
  propertyId: string,
  requestedWindow: { start: string; end: string },
  key: string,
  as = GUEST,
) =>
  request(buildApp(as))
    .post('/exchanges')
    .send({
      propertyId,
      mode: 'host',
      requestedWindow,
      usesGuestPoints: true,
      guestPointsIdempotencyKey: key,
    });

beforeEach(async () => {
  await getDb().delete(guestPointMovements);
  await getDb().delete(exchangeRequests);
  await resetGeoTables();
});

afterAll(async () => {
  await getDb().delete(guestPointMovements);
  await getDb().delete(exchangeRequests);
  await resetGeoTables();
});

describe('a new member starts at zero, and is told so honestly', () => {
  it('reports nothing, and says it has never moved', async () => {
    const res = await request(buildApp(GUEST)).get('/guest-points');

    expect(res.status).toBe(200);
    expect(res.body.data.balance).toMatchObject({
      earned: 0,
      spent: 0,
      reserved: 0,
      balance: 0,
      available: 0,
      // The flag that lets a surface say "you need to host before you can
      // stay" instead of showing a zero that looks like a spent balance.
      neverMoved: true,
    });
    expect(res.body.data.movements).toEqual([]);
  });

  it('refuses a stay it cannot pay for, and creates NO exchange request', async () => {
    const propertyId = await seedHostListing(HOST);

    const res = await requestPointsStay(propertyId, window(10, 13), 'new-member-001');

    expect(res.status).toBe(409);
    expect(res.body.code ?? res.body.error?.code).toBe('INSUFFICIENT_GUEST_POINTS');
    // Both numbers, because "you need 3 and have 0" is actionable and
    // "insufficient points" is not.
    expect(res.body.message ?? res.body.error?.message).toContain('3');

    // The whole transaction rolled back: no request, no reservation. A version
    // that created the request first and reserved afterwards would leave a
    // stay the guest believes they have paid for.
    expect(await getDb().select().from(exchangeRequests)).toHaveLength(0);
    expect(await allMovements()).toHaveLength(0);
  });
});

describe('one point per night, in both directions', () => {
  it('charges the guest exactly the night count and credits the host the same', async () => {
    await earnByHosting(GUEST, 5);
    const propertyId = await seedHostListing(HOST);
    const stay = window(10, 13); // three nights

    expect(guestPointsForWindow(stay.start, stay.end)).toBe(3);

    const created = await requestPointsStay(propertyId, stay, 'symmetry-001');
    expect(created.status).toBe(201);
    expect(created.body.data.usesGuestPoints).toBe(true);

    // Reserved, not spent. The guest still HAS five; three are committed.
    const afterRequest = await standingOf(GUEST);
    expect(afterRequest).toMatchObject({ balance: 5, reserved: 3, available: 2 });

    const accepted = await request(buildApp(HOST))
      .patch(`/exchanges/${created.body.data.id}`)
      .send({ status: 'confirmed' });
    expect(accepted.status).toBe(200);

    const guest = await standingOf(GUEST);
    const host = await standingOf(HOST);
    expect(guest).toMatchObject({ spent: 3, balance: 2, reserved: 0, available: 2 });
    // The symmetry itself: the host earned exactly what the guest spent.
    expect(host).toMatchObject({ earned: 3, spent: 0, balance: 3, available: 3 });
    // And nothing was minted anywhere: every earn in the system is somebody
    // else's spend.
    expect(await systemTotal()).toBe(0);
  });

  it('does not multiply by guests — a night is a night', () => {
    const stay = window(10, 11);
    // The cost is a function of the WINDOW alone. There is no guest count in
    // its signature, which is the design: a family stay must not cost more
    // than one person's for a reason nobody chose.
    expect(guestPointsForWindow(stay.start, stay.end)).toBe(1);
    expect(guestPointsForWindow(window(10, 17).start, window(10, 17).end)).toBe(7);
  });
});

describe('reserve, then settle or release', () => {
  it('a decline gives the points back, with a reason', async () => {
    await earnByHosting(GUEST, 4);
    const propertyId = await seedHostListing(HOST);

    const created = await requestPointsStay(propertyId, window(10, 12), 'decline-001');
    expect(created.status).toBe(201);
    expect(await standingOf(GUEST)).toMatchObject({ reserved: 2, available: 2 });

    const declined = await request(buildApp(HOST))
      .patch(`/exchanges/${created.body.data.id}`)
      .send({ status: 'declined' });
    expect(declined.status).toBe(200);

    const after = await standingOf(GUEST);
    expect(after).toMatchObject({ spent: 0, reserved: 0, available: 4 });
    // The row survives with its reason — a ledger that deleted its own history
    // could not answer "what happened to my trip?".
    const [movement] = await movementsOf(GUEST).then((rows) =>
      rows.filter((row) => row.direction === 'spend'),
    );
    expect(movement.state).toBe('released');
    expect(movement.releaseReason).toBe('declined');
    // The host was never credited for a stay they refused.
    expect(await standingOf(HOST)).toMatchObject({ earned: 0 });
  });

  it('a cancellation before the host answers gives the points back', async () => {
    await earnByHosting(GUEST, 4);
    const propertyId = await seedHostListing(HOST);

    const created = await requestPointsStay(propertyId, window(10, 12), 'cancel-001');
    const cancelled = await request(buildApp(GUEST))
      .patch(`/exchanges/${created.body.data.id}`)
      .send({ status: 'cancelled' });
    expect(cancelled.status).toBe(200);

    expect(await standingOf(GUEST)).toMatchObject({ reserved: 0, available: 4, spent: 0 });
    const [movement] = await movementsOf(GUEST).then((rows) =>
      rows.filter((row) => row.direction === 'spend'),
    );
    expect(movement.releaseReason).toBe('cancelled');
  });

  it('a stay nobody ever answered is released by the sweep, not left committed', async () => {
    await earnByHosting(GUEST, 4);
    const propertyId = await seedHostListing(HOST);
    const created = await requestPointsStay(propertyId, window(10, 12), 'expire-001');
    expect(created.status).toBe(201);

    // Nothing is due yet, and a sweep that released a live reservation would be
    // worse than one that never ran.
    expect(await releaseExpiredReservations(getDb(), { now: new Date(BASE) })).toEqual({
      released: 0,
    });
    expect(await standingOf(GUEST)).toMatchObject({ reserved: 2 });

    // …and once the dates have gone by with the request still pending.
    const after = new Date(BASE + 30 * DAY);
    expect(await releaseExpiredReservations(getDb(), { now: after })).toEqual({ released: 1 });
    expect(await standingOf(GUEST)).toMatchObject({ reserved: 0, available: 4 });
    const [movement] = await movementsOf(GUEST).then((rows) =>
      rows.filter((row) => row.direction === 'spend'),
    );
    expect(movement.releaseReason).toBe('expired');

    // Idempotent: the second pass finds nothing, rather than releasing twice.
    expect(await releaseExpiredReservations(getDb(), { now: after })).toEqual({ released: 0 });
  });

  it('does not sweep a reservation whose stay was CONFIRMED', async () => {
    await earnByHosting(GUEST, 4);
    const propertyId = await seedHostListing(HOST);
    const created = await requestPointsStay(propertyId, window(10, 12), 'confirmed-sweep-001');
    await request(buildApp(HOST))
      .patch(`/exchanges/${created.body.data.id}`)
      .send({ status: 'confirmed' });

    // The dates have passed, but the host accepted: releasing now would refund
    // the guest while the host keeps the credit, which is the one way this
    // ledger could mint.
    expect(
      await releaseExpiredReservations(getDb(), { now: new Date(BASE + 30 * DAY) }),
    ).toEqual({ released: 0 });
    expect(await standingOf(GUEST)).toMatchObject({ spent: 2 });
    expect(await standingOf(HOST)).toMatchObject({ earned: 2 });
    expect(await systemTotal()).toBe(0);
  });
});

describe('the release sweep is actually WIRED', () => {
  /**
   * Two claims, and only the second was ever in doubt.
   *
   * "The sweep works when called directly" is covered above. It says nothing
   * about whether anything ever calls it — and an unscheduled job and a quiet
   * one look identical in a log that only speaks when it acts. Postgres does
   * not watch a deadline, so without this wiring a guest's points stay
   * committed to a trip that cannot happen, forever, with no error and no
   * failing test.
   */
  it('schedules a job, and that job releases a real reservation', async () => {
    const stay = await seedExpiredPendingStay(GUEST, `${GUEST}-sweep-host`, 2);

    initCronJobs();
    try {
      expect(Object.keys(getCronStatus())).toContain('guestPointRelease');
      // Through the CRON's own seam, not `releaseExpiredReservations` directly:
      // a job wired to nothing satisfies the assertion above perfectly.
      await runGuestPointReleaseNow();
    } finally {
      stopCronJobs();
    }

    const released = await findReservation(getDb(), stay);
    expect(released?.state).toBe('released');
    expect(released?.releaseReason).toBe('expired');
    expect(await standingOf(GUEST)).toMatchObject({ reserved: 0, available: 2 });
  });
});

describe('double spend', () => {
  /**
   * The HTTP shape of the race: two spends, genuinely concurrent, against one
   * point's worth of balance.
   *
   * Deterministic in the direction that matters — exactly one succeeds — and it
   * asserts the balance afterwards rather than only the responses, because a
   * handler that refused one request and wrote both rows satisfies any
   * assertion made on status codes alone.
   *
   * It is NOT the mutation-sensitive case. Two supertest requests in a
   * `Promise.all` do not reliably interleave across two pooled connections; the
   * first usually finishes before the second looks. The case below forces the
   * ordering that only the lock survives.
   */
  it('two concurrent stays against one point: one wins, and the balance is right', async () => {
    await earnByHosting(GUEST, 1);
    const first = await seedHostListing(HOST);
    const second = await seedHostListing(`${HOST}-two`);

    const [a, b] = await Promise.all([
      requestPointsStay(first, window(10, 11), 'race-http-001'),
      requestPointsStay(second, window(40, 41), 'race-http-002'),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);

    const spends = await movementsOf(GUEST).then((rows) =>
      rows.filter((row) => row.direction === 'spend'),
    );
    expect(spends).toHaveLength(1);
    const standing = await standingOf(GUEST);
    expect(standing).toMatchObject({ balance: 1, reserved: 1, available: 0 });
    // The loser left nothing behind at all — not a request, not a row.
    expect(
      await getDb().select().from(exchangeRequests).then((rows) =>
        rows.filter((row) => row.usesGuestPoints && row.requesterOxyUserId === GUEST),
      ),
    ).toHaveLength(1);
  });

  /**
   * The actual guarantee, and the case the mutation test uses.
   *
   * The loser's transaction STARTS while the winner holds the lock and has not
   * committed. Under READ COMMITTED its own snapshot cannot see the winner's
   * insert, so an implementation without the row lock computes the balance from
   * a ledger that does not yet contain the other spend, finds it affordable and
   * reserves a second time — one point spent twice.
   *
   * With the lock, the loser blocks until the winner commits and then recounts
   * in a SEPARATE statement, whose fresh snapshot does see it. That the recount
   * is a separate statement is load-bearing: a single locking aggregate
   * re-checks only the rows it blocked on and never sees a row the winner
   * INSERTED.
   *
   * MUTATION TESTED: deleting `.for('update')` from `reserveStayPoints` makes
   * this case fail with two successful reservations.
   */
  it('a spend that starts before the other COMMITS still cannot double-spend', async () => {
    await earnByHosting(GUEST, 1);
    const db = getDb();
    const firstStay = await seedDetachedExchange(GUEST);
    const secondStay = await seedDetachedExchange(GUEST);

    /** Resolves once the winner has locked and inserted, before it commits. */
    let reserved: () => void = () => undefined;
    const hasReserved = new Promise<void>((resolve) => {
      reserved = resolve;
    });
    /** Held open until the loser has started. */
    let commit: () => void = () => undefined;
    const mayCommit = new Promise<void>((resolve) => {
      commit = resolve;
    });

    const winner = db.transaction(async (tx) => {
      const outcome = await reserveStayPoints(tx, {
        exchangeRequestId: firstStay,
        guestOxyUserId: GUEST,
        hostOxyUserId: `${GUEST}-origin`,
        points: 1,
        idempotencyKey: 'interleaved-winner',
      });
      reserved();
      await mayCommit;
      return outcome;
    });

    await hasReserved;
    const loser = reserveStayPoints(db, {
      exchangeRequestId: secondStay,
      guestOxyUserId: GUEST,
      hostOxyUserId: `${GUEST}-origin`,
      points: 1,
      idempotencyKey: 'interleaved-loser',
    });
    // Long enough for the loser to reach the lock and block on it. Without the
    // lock it sails past and reserves here, which is the failure this case
    // exists to catch.
    await new Promise((resolve) => setTimeout(resolve, 200));
    commit();

    const [winnerOutcome, loserOutcome] = await Promise.all([winner, loser]);

    expect(winnerOutcome.ok).toBe(true);
    expect(loserOutcome.ok).toBe(false);
    if (!loserOutcome.ok) {
      expect(loserOutcome.reason).toBe('insufficient_points');
      expect(loserOutcome.available).toBe(0);
    }

    const spends = await movementsOf(GUEST).then((rows) =>
      rows.filter((row) => row.direction === 'spend'),
    );
    expect(spends).toHaveLength(1);
    expect(await availablePointsOf(db, GUEST)).toBe(0);
  });

  it('the SQL available balance and the shared derivation agree', async () => {
    await earnByHosting(GUEST, 5);
    const propertyId = await seedHostListing(HOST);
    const reserved = await requestPointsStay(propertyId, window(10, 12), 'agree-001');
    expect(reserved.status).toBe(201);
    const declinedStay = await seedHostListing(`${HOST}-declined`);
    const toDecline = await requestPointsStay(declinedStay, window(60, 61), 'agree-002');
    await request(buildApp(`${HOST}-declined`))
      .patch(`/exchanges/${toDecline.body.data.id}`)
      .send({ status: 'declined' });

    // A ledger carrying a settled earn, a live reservation and a release —
    // every state, so a derivation that mishandled one would disagree here.
    const standing = await standingOf(GUEST);
    expect(standing.reserved).toBe(2);
    expect(await availablePointsOf(getDb(), GUEST)).toBe(standing.available);
  });
});

describe('idempotency', () => {
  it('a double tap over HTTP reserves once, not twice', async () => {
    await earnByHosting(GUEST, 5);
    const propertyId = await seedHostListing(HOST);
    const stay = window(10, 12);

    const [a, b] = await Promise.all([
      requestPointsStay(propertyId, stay, 'idem-001'),
      requestPointsStay(propertyId, stay, 'idem-001'),
    ]);

    // Both requests may create an exchange REQUEST — that is the exchange
    // domain's own concern and it has no idempotency key — but only one of
    // them may reserve, and a second reservation under the same key is refused
    // by the unique index rather than by a lookup.
    const spends = await movementsOf(GUEST).then((rows) =>
      rows.filter((row) => row.direction === 'spend'),
    );
    expect(spends).toHaveLength(1);
    expect(await standingOf(GUEST)).toMatchObject({ reserved: 2, available: 3 });
    expect([a.status, b.status].every((status) => status === 201 || status === 409)).toBe(true);
  });

  it('accepting twice credits the host once', async () => {
    await earnByHosting(GUEST, 4);
    const propertyId = await seedHostListing(HOST);
    const created = await requestPointsStay(propertyId, window(10, 12), 'accept-twice-001');

    const first = await request(buildApp(HOST))
      .patch(`/exchanges/${created.body.data.id}`)
      .send({ status: 'confirmed' });
    expect(first.status).toBe(200);
    // The second is refused by the exchange state machine, which is the right
    // answer — but the assertion that matters is the ledger, because a version
    // that settled before transitioning would credit twice and still 400.
    await request(buildApp(HOST))
      .patch(`/exchanges/${created.body.data.id}`)
      .send({ status: 'confirmed' });

    const earns = await movementsOf(HOST).then((rows) =>
      rows.filter((row) => row.direction === 'earn'),
    );
    expect(earns).toHaveLength(1);
    expect(await standingOf(HOST)).toMatchObject({ earned: 2 });
    expect(await systemTotal()).toBe(0);
  });
});

describe('what the rules refuse', () => {
  it('refuses points on a SWAP, and writes nothing', async () => {
    await earnByHosting(GUEST, 4);
    const propertyId = await seedHostListing(HOST);

    const res = await request(buildApp(GUEST))
      .post('/exchanges')
      .send({
        propertyId,
        mode: 'swap',
        requestedWindow: window(10, 12),
        usesGuestPoints: true,
        guestPointsIdempotencyKey: 'swap-points-001',
      });

    expect(res.status).toBe(400);
    // RE-READ: a handler that refused and wrote anyway satisfies the assertion
    // above on its own.
    const spends = await movementsOf(GUEST).then((rows) =>
      rows.filter((row) => row.direction === 'spend'),
    );
    expect(spends).toHaveLength(0);
  });

  it('refuses a points stay with no idempotency key', async () => {
    await earnByHosting(GUEST, 4);
    const propertyId = await seedHostListing(HOST);

    const before = (await allMovements()).length;

    const res = await request(buildApp(GUEST))
      .post('/exchanges')
      .send({ propertyId, mode: 'host', requestedWindow: window(10, 12), usesGuestPoints: true });

    expect(res.status).toBe(400);
    // RE-READ, against the count the seed left behind: a handler that refused
    // and reserved anyway satisfies the status assertion on its own.
    expect(await allMovements()).toHaveLength(before);
    expect(await standingOf(GUEST)).toMatchObject({ reserved: 0, available: 4 });
  });

  it('a free hosting request reserves NOTHING', async () => {
    await earnByHosting(GUEST, 4);
    const propertyId = await seedHostListing(HOST);

    const created = await request(buildApp(GUEST))
      .post('/exchanges')
      .send({ propertyId, mode: 'host', requestedWindow: window(10, 12) });

    expect(created.status).toBe(201);
    expect(created.body.data.usesGuestPoints).toBe(false);
    // The rule #518 §7.5 states in one line: free hosting is not points.
    expect(await standingOf(GUEST)).toMatchObject({ reserved: 0, available: 4 });

    const accepted = await request(buildApp(HOST))
      .patch(`/exchanges/${created.body.data.id}`)
      .send({ status: 'confirmed' });
    expect(accepted.status).toBe(200);
    // And accepting free hosting earns the host nothing either — points are
    // not a reward for hospitality, they are the other half of a stay somebody
    // paid for.
    expect(await standingOf(HOST)).toMatchObject({ earned: 0 });
  });

  it('a stranger cannot read somebody else’s ledger', async () => {
    await earnByHosting(GUEST, 3);

    const res = await request(buildApp(STRANGER)).get('/guest-points');

    expect(res.status).toBe(200);
    // Not a 403 — there is no endpoint that names another account at all, so
    // the stranger simply gets their own empty ledger. Asserted because a
    // handler that read `?oxyUserId=` would pass every other test here.
    expect(res.body.data.movements).toEqual([]);
    expect(res.body.data.balance.neverMoved).toBe(true);
  });

  it('the database refuses a movement with no stay behind it', async () => {
    // The structural half of "earned by hosting, spent by staying, and nothing
    // else": there is no purchase, gift or grant because there is no way to
    // write one. Asserted against the real constraint rather than trusted from
    // a comment.
    await expect(
      getDb()
        .insert(guestPointMovements)
        .values({
          accountOxyUserId: GUEST,
          counterpartyOxyUserId: HOST,
          exchangeRequestId: null as unknown as string,
          direction: 'earn',
          state: 'settled',
          points: 10,
          settledAt: new Date(),
          idempotencyKey: 'granted-from-nowhere',
        }),
    ).rejects.toThrow();
    expect(await allMovements()).toHaveLength(0);
  });

  it('the database refuses somebody hosting themselves', async () => {
    const stay = await seedDetachedExchange(GUEST);
    await expect(
      getDb()
        .insert(guestPointMovements)
        .values({
          accountOxyUserId: GUEST,
          counterpartyOxyUserId: GUEST,
          exchangeRequestId: stay,
          direction: 'earn',
          state: 'settled',
          points: 1,
          settledAt: new Date(),
          idempotencyKey: 'self-hosting-loop',
        }),
    ).rejects.toThrow();
  });

  it('the database refuses a reserved EARN', async () => {
    const stay = await seedDetachedExchange(GUEST);
    await expect(
      getDb()
        .insert(guestPointMovements)
        .values({
          accountOxyUserId: HOST,
          counterpartyOxyUserId: GUEST,
          exchangeRequestId: stay,
          direction: 'earn',
          state: 'reserved',
          points: 1,
          idempotencyKey: 'reserved-earn-attempt',
        }),
    ).rejects.toThrow();
  });
});
