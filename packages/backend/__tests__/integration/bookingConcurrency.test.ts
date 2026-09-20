/**
 * Two people, one home, the same nights (#518 §7.5). Against the REAL Postgres.
 *
 * ## Why every case here holds a transaction open
 *
 * Firing two supertest requests in a `Promise.all` and calling it a race does
 * NOT work, and this repository learned that the expensive way — see the
 * idempotency section of `leasePaymentLedger.test.ts`, where exactly that shape
 * was mutation-tested and survived the naive implementation. Two pooled
 * connections almost always run to completion one after the other, so the test
 * measures the happy path.
 *
 * Each case below instead forces the interleaving the unfixed code actually
 * loses to: a concurrent transaction takes the lock the booking path needs,
 * writes the conflicting row, and has NOT COMMITTED when the HTTP request
 * arrives. Under READ COMMITTED the request's own conflict `SELECT` cannot see
 * that row. So:
 *
 *  - WITHOUT the `FOR UPDATE` on the listing, the request sails past the
 *    conflict check, inserts, and the home is committed twice;
 *  - WITH it, the request blocks on the listing row until the other transaction
 *    commits, then re-reads a calendar that now contains the conflict and
 *    refuses with a 409.
 *
 * MUTATION-TESTED: removing `.for('update')` from
 * `lockPropertyBookingBases` turns the stay case red (201 and two overlapping
 * reservations) and restoring it turns it green again. Recorded in the PR body
 * with the measured numbers.
 *
 * ## And the non-concurrent half: what a CONFIRM re-verifies
 *
 * A confirm is a second decision, taken later against a listing that has had
 * time to change. The cases at the bottom change the listing under a pending
 * request — its price, its capacity, its calendar — and assert the host cannot
 * commit to the stale one.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { and, eq } from 'drizzle-orm';

import exchangeController from '../../controllers/exchangeController';
import reservationController from '../../controllers/reservationController';
import viewingController from '../../controllers/viewingController';
import { getDb } from '../../db/postgres';
import {
  exchangeRequests,
  properties,
  propertyAvailabilityWindows,
  reservations,
  viewingRequests,
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
  app.post('/reservations', (req, res, next) => reservationController.createReservation(req, res, next));
  app.patch('/reservations/:id', (req, res, next) => reservationController.updateReservationStatus(req, res, next));
  app.post('/exchanges', (req, res, next) => exchangeController.createExchangeRequest(req, res, next));
  app.post('/properties/:propertyId/viewings', (req, res, next) => viewingController.createViewingRequest(req, res, next));
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

const DAY = 24 * 60 * 60 * 1000;
const HOST = 'oxy-host';

async function seedBookableProperty(
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const { propertyId } = await seedListingWithGeo({
    countryCode: nextCountryCode(),
    overrides: {
      oxyUserId: HOST,
      status: 'published',
      isExternal: false,
      offerings: ['short_term_rent'],
      shortTermRentNightlyRate: 100,
      shortTermRentCurrency: 'EUR',
      shortTermRentCleaningFee: 50,
      shortTermRentServiceFee: 30,
      shortTermRentTaxesPercent: 10,
      maxGuests: 4,
      cancellationPolicy: 'moderate',
      ...overrides,
    },
  });
  return propertyId;
}

async function seedExchangeProperty(oxyUserId: string): Promise<string> {
  const { propertyId } = await seedListingWithGeo({
    countryCode: nextCountryCode(),
    overrides: {
      oxyUserId,
      status: 'published',
      isExternal: false,
      offerings: ['exchange'],
      exchangeMode: 'both',
    },
  });
  return propertyId;
}

async function seedLongTermProperty(): Promise<string> {
  const { propertyId } = await seedListingWithGeo({
    countryCode: nextCountryCode(),
    overrides: { oxyUserId: HOST, status: 'published', isExternal: false },
  });
  return propertyId;
}

/**
 * Run `write` inside a transaction that holds the LISTING locked, and hand back
 * a handle that releases it.
 *
 * The lock is taken first and the conflicting row is written second, so by the
 * time `taken` resolves the racing request faces exactly the situation the bug
 * needed: a row it cannot see, behind a lock it must either respect or ignore.
 */
function holdListingLocked(
  propertyId: string,
  write: (tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0]) => Promise<void>,
): { taken: Promise<void>; release: () => void; finished: Promise<void> } {
  let markTaken: () => void = () => undefined;
  const taken = new Promise<void>((resolve) => {
    markTaken = resolve;
  });
  let release: () => void = () => undefined;
  const mayCommit = new Promise<void>((resolve) => {
    release = resolve;
  });

  const finished = getDb().transaction(async (tx) => {
    await tx.select({ id: properties.id }).from(properties).where(eq(properties.id, propertyId)).for('update');
    await write(tx);
    markTaken();
    await mayCommit;
  });

  return { taken, release, finished };
}

/** Start an HTTP request without awaiting it, so it can block on the lock. */
function fire(pending: request.Test): Promise<request.Response> {
  return (async () => pending)();
}

/** Long enough for the racing request to reach the lock and stop there. */
const REACH_THE_LOCK_MS = 150;
const settle = () => new Promise((resolve) => setTimeout(resolve, REACH_THE_LOCK_MS));

beforeEach(async () => {
  await getDb().delete(viewingRequests);
  await getDb().delete(exchangeRequests);
  await getDb().delete(reservations);
  await resetGeoTables();
});

afterAll(async () => {
  await getDb().delete(viewingRequests);
  await getDb().delete(exchangeRequests);
  await getDb().delete(reservations);
  await resetGeoTables();
});

describe('a stay cannot be sold twice', () => {
  it('refuses a booking whose conflict was committed AFTER it looked', async () => {
    const base = Date.now();
    const propertyId = await seedBookableProperty();

    const holder = holdListingLocked(propertyId, async (tx) => {
      await tx.insert(reservations).values({
        propertyId,
        guestOxyUserId: 'oxy-guest-a',
        hostOxyUserId: HOST,
        checkIn: new Date(base + 10 * DAY),
        checkOut: new Date(base + 15 * DAY),
        guestCount: 1,
        nights: 5,
        nightlyRate: 100,
        subtotal: 500,
        total: 500,
        cancellationPolicy: 'moderate',
        status: 'confirmed',
      });
    });
    await holder.taken;

    const racing = fire(
      request(buildApp('oxy-guest-b'))
        .post('/reservations')
        .send({
          propertyId,
          checkIn: new Date(base + 12 * DAY).toISOString(),
          checkOut: new Date(base + 18 * DAY).toISOString(),
          guestCount: 1,
        }),
    );

    await settle();
    holder.release();
    await holder.finished;

    const res = await racing;
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DATE_CONFLICT');
    // The assertion that survives a lenient handler: ONE reservation exists.
    expect(await getDb().select().from(reservations)).toHaveLength(1);
  });

  it('prices the stay from the listing as it is when the row lands', async () => {
    // The host raises the rate while the booking is in flight. The quote must
    // be the new one — the old shape read the rate, then priced, then inserted,
    // all outside a transaction, and wrote whichever number it happened to
    // read first.
    const base = Date.now();
    const propertyId = await seedBookableProperty({ shortTermRentCleaningFee: 0, shortTermRentServiceFee: 0, shortTermRentTaxesPercent: 0 });

    const holder = holdListingLocked(propertyId, async (tx) => {
      await tx
        .update(properties)
        .set({ shortTermRentNightlyRate: 250 })
        .where(eq(properties.id, propertyId));
    });
    await holder.taken;

    const racing = fire(
      request(buildApp('oxy-guest'))
        .post('/reservations')
        .send({
          propertyId,
          checkIn: new Date(base + 10 * DAY).toISOString(),
          checkOut: new Date(base + 12 * DAY).toISOString(),
          guestCount: 1,
        }),
    );

    await settle();
    holder.release();
    await holder.finished;

    const res = await racing;
    expect(res.status).toBe(201);
    const [row] = await getDb().select().from(reservations);
    expect(row.nightlyRate).toBe(250);
    expect(row.subtotal).toBe(500);
    expect(row.total).toBe(500);
  });
});

describe('a viewing slot cannot be given away twice', () => {
  it('refuses a request whose conflict was committed AFTER it looked', async () => {
    const propertyId = await seedLongTermProperty();
    // The controller builds the instant from `YYYY-MM-DD` + `HH:mm` in the
    // PROPERTY's zone (#518 §7.5) — it used to use the SERVER's, which meant
    // the same request was a different moment on every host. This fixture's
    // listing has no owner-stated zone and no city carrying one, so it resolves
    // to the stated UTC fallback, and the seeded row says `Z` to match.
    const day = new Date(Date.now() + 10 * DAY);
    const date = day.toISOString().slice(0, 10);
    const scheduledAt = new Date(`${date}T10:00:00Z`);

    const holder = holdListingLocked(propertyId, async (tx) => {
      await tx.insert(viewingRequests).values({
        propertyId,
        requesterOxyUserId: 'oxy-viewer-a',
        ownerOxyUserId: HOST,
        scheduledAt,
        status: 'pending',
      });
    });
    await holder.taken;

    const racing = fire(
      request(buildApp('oxy-viewer-b'))
        .post(`/properties/${propertyId}/viewings`)
        .send({ date, time: '10:00' }),
    );

    await settle();
    holder.release();
    await holder.finished;

    const res = await racing;
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TIME_CONFLICT');
    expect(await getDb().select().from(viewingRequests)).toHaveLength(1);
  });
});

describe('an exchange cannot commit a home twice', () => {
  it('refuses a request whose conflict was committed AFTER it looked', async () => {
    const base = Date.now();
    const propertyId = await seedExchangeProperty(HOST);

    const holder = holdListingLocked(propertyId, async (tx) => {
      await tx.insert(exchangeRequests).values({
        propertyId,
        requesterOxyUserId: 'oxy-guest-a',
        hostOxyUserId: HOST,
        mode: 'host',
        requestedWindowStart: new Date(base + 10 * DAY),
        requestedWindowEnd: new Date(base + 20 * DAY),
        status: 'confirmed',
      });
    });
    await holder.taken;

    const racing = fire(
      request(buildApp('oxy-guest-b'))
        .post('/exchanges')
        .send({
          propertyId,
          mode: 'host',
          requestedWindow: {
            start: new Date(base + 15 * DAY).toISOString(),
            end: new Date(base + 25 * DAY).toISOString(),
          },
        }),
    );

    await settle();
    holder.release();
    await holder.finished;

    const res = await racing;
    expect(res.status).toBe(409);
    expect(await getDb().select().from(exchangeRequests)).toHaveLength(1);
  });
});

describe('what a confirm re-verifies', () => {
  /** A pending booking, priced by the create path. */
  async function pendingBooking(propertyId: string, guests = 1): Promise<string> {
    const base = Date.now();
    const res = await request(buildApp('oxy-guest'))
      .post('/reservations')
      .send({
        propertyId,
        checkIn: new Date(base + 10 * DAY).toISOString(),
        checkOut: new Date(base + 15 * DAY).toISOString(),
        guestCount: guests,
      });
    expect(res.status).toBe(201);
    return res.body.data.id;
  }

  const confirm = (id: string) =>
    request(buildApp(HOST)).patch(`/reservations/${id}`).send({ status: 'confirmed' });

  const statusOf = async (id: string) => {
    const [row] = await getDb().select().from(reservations).where(eq(reservations.id, id));
    return row.status;
  };

  it('refuses when the listing has been RE-PRICED since the request', async () => {
    const propertyId = await seedBookableProperty();
    const id = await pendingBooking(propertyId);

    await getDb()
      .update(properties)
      .set({ shortTermRentNightlyRate: 180 })
      .where(eq(properties.id, propertyId));

    const res = await confirm(id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PRICE_CHANGED');
    expect(await statusOf(id)).toBe('pending');
  });

  it('refuses when the listing now takes FEWER guests than the booking', async () => {
    const propertyId = await seedBookableProperty();
    const id = await pendingBooking(propertyId, 4);

    await getDb().update(properties).set({ maxGuests: 2 }).where(eq(properties.id, propertyId));

    const res = await confirm(id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TOO_MANY_GUESTS');
    expect(await statusOf(id)).toBe('pending');
  });

  it('refuses when the HOST CALENDAR now blocks the stay', async () => {
    const base = Date.now();
    const propertyId = await seedBookableProperty();
    const id = await pendingBooking(propertyId);

    await getDb().insert(propertyAvailabilityWindows).values({
      propertyId,
      scope: 'listing',
      startsAt: new Date(base + 12 * DAY),
      endsAt: new Date(base + 18 * DAY),
      status: 'blocked',
    });

    const res = await confirm(id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BLOCKED_BY_HOST');
    expect(await statusOf(id)).toBe('pending');
  });

  it('refuses when a confirmed EXCHANGE now occupies the stay', async () => {
    const base = Date.now();
    // One home, offered for short stays AND open to exchange — the case where
    // the two domains cannot ignore one another.
    const propertyId = await seedBookableProperty({
      offerings: ['short_term_rent', 'exchange'],
      exchangeMode: 'both',
    });
    const id = await pendingBooking(propertyId);

    await getDb().insert(exchangeRequests).values({
      propertyId,
      requesterOxyUserId: 'oxy-swapper',
      hostOxyUserId: HOST,
      mode: 'host',
      requestedWindowStart: new Date(base + 12 * DAY),
      requestedWindowEnd: new Date(base + 18 * DAY),
      status: 'confirmed',
    });

    const res = await confirm(id);
    expect(res.status).toBe(409);
    expect(await statusOf(id)).toBe('pending');
  });

  it('still confirms a booking nothing has disturbed', async () => {
    // The permit half. A rule that refused every confirm would pass all four
    // cases above and be worse than the bug.
    const propertyId = await seedBookableProperty();
    const id = await pendingBooking(propertyId);
    expect((await confirm(id)).status).toBe(200);
    expect(await statusOf(id)).toBe('confirmed');
  });

  it('is not vetoed by a sibling PENDING request for the same nights', async () => {
    // Two people may ask; only one may be given the room. A confirm that
    // checked ACTIVE reservations rather than CONFIRMED ones would refuse the
    // host's answer because somebody else was still waiting for it.
    const base = Date.now();
    const propertyId = await seedBookableProperty();
    const id = await pendingBooking(propertyId);

    await getDb().insert(reservations).values({
      propertyId,
      guestOxyUserId: 'oxy-guest-b',
      hostOxyUserId: HOST,
      checkIn: new Date(base + 11 * DAY),
      checkOut: new Date(base + 14 * DAY),
      guestCount: 1,
      nights: 3,
      nightlyRate: 100,
      subtotal: 300,
      total: 300,
      cancellationPolicy: 'moderate',
      status: 'pending',
    });

    expect((await confirm(id)).status).toBe(200);
    const [confirmed] = await getDb()
      .select()
      .from(reservations)
      .where(and(eq(reservations.id, id), eq(reservations.status, 'confirmed')));
    expect(confirmed).toBeTruthy();
  });
});
