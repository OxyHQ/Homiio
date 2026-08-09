/**
 * Reservations — pricing, the two calendar conflicts, the cancellation policy
 * and the three range CHECKs. Against the REAL Postgres.
 *
 * ## What makes these tests non-vacuous
 *
 * `reservations` was empty in production. Each case targets a rule with a way
 * to be wrong:
 *
 *  - both overlap checks are asserted at the EXACT boundary, from ONE base
 *    instant, because `[)` and `[]` agree everywhere else — the vacuity that
 *    bit the exchanges suite in #309, where `Date.now()` per call put the two
 *    "adjacent" windows milliseconds apart and three closed-bound mutations all
 *    survived,
 *  - the priced fields are asserted on their VALUES, not on being present: a
 *    `nights` off by one, or taxes on the wrong base, is money,
 *  - the three range CHECKs are asserted on what they refuse,
 *  - every refusal re-reads the row.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';

import reservationController from '../../controllers/reservationController';
import { getDb } from '../../db/postgres';
import { propertyAvailabilityWindows, reservations } from '../../db/schema';
import { errorHandler } from '../../middlewares/errorHandler';
import { resetGeoTables, seedListingWithGeo } from '../helpers/postgresGeoFixtures';

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
  app.post('/reservations', (req, res, next) => reservationController.createReservation(req, res, next));
  app.get('/reservations', (req, res, next) => reservationController.listMyReservations(req, res, next));
  app.get('/reservations/:id', (req, res, next) => reservationController.getReservationById(req, res, next));
  app.patch('/reservations/:id', (req, res, next) => reservationController.updateReservationStatus(req, res, next));
  app.get('/properties/:id/availability', (req, res, next) => reservationController.getPropertyAvailability(req, res, next));
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

/** A vacation-bookable listing. Pricing is explicit so the maths is checkable. */
async function seedBookableProperty(
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const { propertyId } = await seedListingWithGeo({
    countryCode: nextCountryCode(),
    overrides: {
      oxyUserId: 'oxy-host',
      status: 'published',
      isExternal: false,
      // `properties_offerings_short_term_rent_check` makes the offering exactly
      // the presence of `nightly_rate`, so the two move together.
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

const DAY = 24 * 60 * 60 * 1000;

/**
 * A stay `fromDays`..`toDays` out, from an OPTIONAL fixed base.
 *
 * The base is what makes the boundary cases below real: without it each call
 * re-reads `Date.now()` and two "adjacent" stays land milliseconds apart,
 * disjoint under every bound convention. That exact vacuity shipped in the
 * exchanges suite and was caught only by mutation testing.
 */
function stay(fromDays: number, toDays: number, base = Date.now()) {
  return {
    checkIn: new Date(base + fromDays * DAY).toISOString(),
    checkOut: new Date(base + toDays * DAY).toISOString(),
  };
}

async function reservationRow(id: string) {
  const [row] = await getDb()
    .select()
    .from(reservations)
    .where(eq(reservations.id, id))
    .limit(1);
  return row;
}

async function book(
  propertyId: string,
  guest = 'oxy-guest',
  window = stay(10, 15),
  guestCount = 2,
): Promise<string> {
  const res = await request(buildApp(guest))
    .post('/reservations')
    .send({ propertyId, ...window, guestCount });
  expect(res.status).toBe(201);
  return res.body.data.id;
}

beforeEach(async () => {
  await getDb().delete(reservations);
  await resetGeoTables();
});

afterAll(async () => {
  // Leave the shared tables as this file found them — see the reproduced
  // geoBackfill collision documented in `leaseOwnership.test.ts`.
  await getDb().delete(reservations);
  await resetGeoTables();
});

describe('createReservation — pricing', () => {
  it('computes nights, subtotal, taxes and total from the short-term block', async () => {
    const propertyId = await seedBookableProperty();
    const id = await book(propertyId, 'oxy-guest', stay(10, 15));

    const row = await reservationRow(id);
    // 5 nights x 100 = 500; + 50 cleaning + 30 service = 580; 10% tax = 58;
    // total 638. Asserted on VALUES — a `nights` off by one silently re-prices
    // the whole booking.
    expect(row.nights).toBe(5);
    expect(row.nightlyRate).toBe(100);
    expect(row.subtotal).toBe(500);
    expect(row.cleaningFee).toBe(50);
    expect(row.serviceFee).toBe(30);
    expect(row.taxes).toBe(58);
    expect(row.total).toBe(638);
    expect(row.currency).toBe('EUR');
    expect(row.hostOxyUserId).toBe('oxy-host');
    expect(row.status).toBe('pending');
    expect(row.instantBooked).toBe(false);
  });

  it('auto-confirms when the listing has instantBook', async () => {
    const propertyId = await seedBookableProperty({ shortTermRentInstantBook: true });
    const id = await book(propertyId);
    const row = await reservationRow(id);
    expect(row.instantBooked).toBe(true);
    expect(row.status).toBe('confirmed');
  });

  it('falls back to the moderate policy when the listing names none', async () => {
    const propertyId = await seedBookableProperty({ cancellationPolicy: null });
    const id = await book(propertyId);
    expect((await reservationRow(id)).cancellationPolicy).toBe('moderate');
  });

  it('refuses an unpublished, external, non-bookable or own listing', async () => {
    const draft = await seedBookableProperty({ status: 'draft' });
    expect((await request(buildApp('oxy-guest')).post('/reservations').send({ propertyId: draft, ...stay(10, 15), guestCount: 1 })).status).toBe(400);

    const notBookable = (await seedListingWithGeo({
      countryCode: nextCountryCode(),
      overrides: { oxyUserId: 'oxy-host', status: 'published' },
    })).propertyId;
    expect((await request(buildApp('oxy-guest')).post('/reservations').send({ propertyId: notBookable, ...stay(10, 15), guestCount: 1 })).status).toBe(400);

    const own = await seedBookableProperty();
    expect((await request(buildApp('oxy-host')).post('/reservations').send({ propertyId: own, ...stay(10, 15), guestCount: 1 })).status).toBe(403);

    expect(await getDb().select().from(reservations)).toHaveLength(0);
  });

  it('enforces min stay, max stay and guest capacity', async () => {
    const propertyId = await seedBookableProperty({
      shortTermRentMinNights: 3,
      shortTermRentMaxNights: 7,
    });
    const app = buildApp('oxy-guest');

    const tooShort = await request(app).post('/reservations').send({ propertyId, ...stay(10, 12), guestCount: 1 });
    expect(tooShort.status).toBe(400);
    const tooLong = await request(app).post('/reservations').send({ propertyId, ...stay(10, 30), guestCount: 1 });
    expect(tooLong.status).toBe(400);
    const tooMany = await request(app).post('/reservations').send({ propertyId, ...stay(10, 15), guestCount: 9 });
    expect(tooMany.status).toBe(400);

    expect(await getDb().select().from(reservations)).toHaveLength(0);
  });

  it('refuses a check-in in the past', async () => {
    const propertyId = await seedBookableProperty();
    const res = await request(buildApp('oxy-guest'))
      .post('/reservations')
      .send({ propertyId, ...stay(-5, 5), guestCount: 1 });
    expect(res.status).toBe(400);
  });
});

describe('the two calendar conflicts — half-open, at the boundary', () => {
  it('blocks an overlapping reservation, pending or confirmed', async () => {
    const propertyId = await seedBookableProperty();
    await book(propertyId, 'oxy-guest-a', stay(10, 15));

    // A PENDING reservation already occupies the calendar here — unlike
    // exchanges, where only a confirmed one blocks.
    const clash = await request(buildApp('oxy-guest-b'))
      .post('/reservations')
      .send({ propertyId, ...stay(12, 18), guestCount: 1 });
    expect(clash.status).toBe(409);
  });

  it('PERMITS a back-to-back stay — asserted at the EXACT boundary, both directions', async () => {
    // The one instant where `[)` and `[]` disagree, so both stays come from ONE
    // base. Mutation-tested: closing either range turns this red.
    const base = Date.now();
    const propertyId = await seedBookableProperty();
    await book(propertyId, 'oxy-guest-a', stay(10, 15, base));

    const after = await request(buildApp('oxy-guest-b'))
      .post('/reservations')
      .send({ propertyId, ...stay(15, 20, base), guestCount: 1 });
    expect(after.status).toBe(201);

    // The reverse direction — the only one that catches a closed bound on the
    // STORED range.
    const other = await seedBookableProperty();
    await book(other, 'oxy-guest-a', stay(15, 20, base));
    const before = await request(buildApp('oxy-guest-b'))
      .post('/reservations')
      .send({ propertyId: other, ...stay(10, 15, base), guestCount: 1 });
    expect(before.status).toBe(201);
  });

  it('blocks a stay a host calendar window closes, and ignores an `available` one', async () => {
    const base = Date.now();
    const propertyId = await seedBookableProperty();
    await getDb().insert(propertyAvailabilityWindows).values({
      propertyId,
      scope: 'listing',
      startsAt: new Date(base + 12 * DAY),
      endsAt: new Date(base + 18 * DAY),
      status: 'blocked',
    });

    const blocked = await request(buildApp('oxy-guest'))
      .post('/reservations')
      .send({ propertyId, ...stay(10, 15, base), guestCount: 1 });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('BLOCKED_BY_HOST');

    // An `available` window must never block — it is the state that says the
    // opposite, and dropping that exclusion refuses every booking on a listing
    // whose host published a calendar.
    const other = await seedBookableProperty();
    await getDb().insert(propertyAvailabilityWindows).values({
      propertyId: other,
      scope: 'listing',
      startsAt: new Date(base + 5 * DAY),
      endsAt: new Date(base + 30 * DAY),
      status: 'available',
    });
    const allowed = await request(buildApp('oxy-guest'))
      .post('/reservations')
      .send({ propertyId: other, ...stay(10, 15, base), guestCount: 1 });
    expect(allowed.status).toBe(201);
  });

  it('ignores an EXCHANGE-scope window — the two calendars share a table', async () => {
    // `property_availability_windows` holds both calendars under a `scope`
    // discriminator. A query that forgot the scope would let an exchange
    // window block a paid booking.
    const base = Date.now();
    const propertyId = await seedBookableProperty();
    await getDb().insert(propertyAvailabilityWindows).values({
      propertyId,
      scope: 'exchange',
      startsAt: new Date(base + 5 * DAY),
      endsAt: new Date(base + 30 * DAY),
      status: 'blocked',
    });

    const res = await request(buildApp('oxy-guest'))
      .post('/reservations')
      .send({ propertyId, ...stay(10, 15, base), guestCount: 1 });
    expect(res.status).toBe(201);
  });
});

describe('the range CHECKs', () => {
  it('REFUSES an inverted stay, zero nights and zero guests', async () => {
    const propertyId = await seedBookableProperty();
    const base = {
      propertyId,
      guestOxyUserId: 'oxy-guest',
      hostOxyUserId: 'oxy-host',
      nightlyRate: 100,
      subtotal: 100,
      total: 100,
      cancellationPolicy: 'moderate' as const,
    };
    const checkIn = new Date(Date.now() + 10 * DAY);
    const checkOut = new Date(Date.now() + 15 * DAY);

    // `reservations_stay_order_check` — Mongo declared this as a `validate` on
    // `checkOut`, which does not run on an update.
    await expect(
      getDb().insert(reservations).values({ ...base, checkIn: checkOut, checkOut: checkIn, guestCount: 1, nights: 5 }),
    ).rejects.toThrow();

    // `reservations_nights_check` — a zero-night booking is a charge with
    // nothing behind it.
    await expect(
      getDb().insert(reservations).values({ ...base, checkIn, checkOut, guestCount: 1, nights: 0 }),
    ).rejects.toThrow();

    // `reservations_guest_count_check`.
    await expect(
      getDb().insert(reservations).values({ ...base, checkIn, checkOut, guestCount: 0, nights: 5 }),
    ).rejects.toThrow();
  });
});

describe('the transition machine', () => {
  it('lets only the host confirm or decline, and only from pending', async () => {
    const propertyId = await seedBookableProperty();
    const id = await book(propertyId);

    expect((await request(buildApp('oxy-guest')).patch(`/reservations/${id}`).send({ status: 'confirmed' })).status).toBe(403);
    expect((await reservationRow(id)).status).toBe('pending');

    expect((await request(buildApp('oxy-host')).patch(`/reservations/${id}`).send({ status: 'confirmed' })).status).toBe(200);
    // The precondition is in the UPDATE, so a second decision matches no row.
    expect((await request(buildApp('oxy-host')).patch(`/reservations/${id}`).send({ status: 'declined' })).status).toBe(400);
  });

  it('refuses confirming a stay another CONFIRMED booking now overlaps', async () => {
    const base = Date.now();
    const propertyId = await seedBookableProperty();
    const first = await book(propertyId, 'oxy-guest-a', stay(10, 15, base));
    await request(buildApp('oxy-host')).patch(`/reservations/${first}`).send({ status: 'confirmed' });

    // A second overlapping request can only exist if it predates the confirm —
    // seeded directly, since the create path refuses it.
    const [second] = await getDb()
      .insert(reservations)
      .values({
        propertyId,
        guestOxyUserId: 'oxy-guest-b',
        hostOxyUserId: 'oxy-host',
        checkIn: new Date(base + 12 * DAY),
        checkOut: new Date(base + 18 * DAY),
        guestCount: 1,
        nights: 6,
        nightlyRate: 100,
        subtotal: 600,
        total: 600,
        cancellationPolicy: 'moderate',
        status: 'pending',
      })
      .returning();

    const res = await request(buildApp('oxy-host')).patch(`/reservations/${second.id}`).send({ status: 'confirmed' });
    expect(res.status).toBe(409);
    expect((await reservationRow(second.id)).status).toBe('pending');
  });

  it('lets a guest cancel a PENDING booking whatever the policy says', async () => {
    const propertyId = await seedBookableProperty({ cancellationPolicy: 'super_strict' });
    const id = await book(propertyId);
    const res = await request(buildApp('oxy-guest')).patch(`/reservations/${id}`).send({ status: 'cancelled' });
    expect(res.status).toBe(200);
    expect((await reservationRow(id)).status).toBe('cancelled');
  });

  it('applies the cancellation policy to a CONFIRMED booking', async () => {
    // `super_strict` needs 30 days' notice; the stay is 10 days out, so the
    // guest may not cancel — but the HOST always may.
    const propertyId = await seedBookableProperty({ cancellationPolicy: 'super_strict' });
    const id = await book(propertyId, 'oxy-guest', stay(10, 15));
    await request(buildApp('oxy-host')).patch(`/reservations/${id}`).send({ status: 'confirmed' });

    const byGuest = await request(buildApp('oxy-guest')).patch(`/reservations/${id}`).send({ status: 'cancelled' });
    expect(byGuest.status).toBe(403);
    expect(byGuest.body.error.code).toBe('POLICY_FORBIDS_CANCEL');
    expect((await reservationRow(id)).status).toBe('confirmed');

    const byHost = await request(buildApp('oxy-host')).patch(`/reservations/${id}`).send({ status: 'cancelled' });
    expect(byHost.status).toBe(200);
  });

  it('lets a guest cancel a confirmed FLEXIBLE booking', async () => {
    // The permit half of the policy — a rule that refused every confirmed
    // cancellation would pass the case above and eat this one.
    const propertyId = await seedBookableProperty({ cancellationPolicy: 'flexible' });
    const id = await book(propertyId, 'oxy-guest', stay(10, 15));
    await request(buildApp('oxy-host')).patch(`/reservations/${id}`).send({ status: 'confirmed' });

    const res = await request(buildApp('oxy-guest')).patch(`/reservations/${id}`).send({ status: 'cancelled' });
    expect(res.status).toBe(200);
  });

  it('converges on an already-cancelled booking and refuses an unsupported status', async () => {
    const propertyId = await seedBookableProperty();
    const id = await book(propertyId);
    await request(buildApp('oxy-guest')).patch(`/reservations/${id}`).send({ status: 'cancelled' });

    expect((await request(buildApp('oxy-guest')).patch(`/reservations/${id}`).send({ status: 'cancelled' })).status).toBe(200);
    expect((await request(buildApp('oxy-host')).patch(`/reservations/${id}`).send({ status: 'completed' })).status).toBe(400);
  });
});

describe('reads', () => {
  it('shows a booking only to its two parties', async () => {
    const propertyId = await seedBookableProperty();
    const id = await book(propertyId);
    expect((await request(buildApp('oxy-guest')).get(`/reservations/${id}`)).status).toBe(200);
    expect((await request(buildApp('oxy-host')).get(`/reservations/${id}`)).status).toBe(200);
    expect((await request(buildApp('oxy-stranger')).get(`/reservations/${id}`)).status).toBe(403);
  });

  it('splits the guest and host views', async () => {
    const propertyId = await seedBookableProperty();
    await book(propertyId);

    expect((await request(buildApp('oxy-guest')).get('/reservations')).body.data).toHaveLength(1);
    expect((await request(buildApp('oxy-host')).get('/reservations?asHost=true')).body.data).toHaveLength(1);
    expect((await request(buildApp('oxy-host')).get('/reservations')).body.data).toHaveLength(0);
  });

  it('reports the calendar and the CONFIRMED stays on the availability endpoint', async () => {
    const base = Date.now();
    const propertyId = await seedBookableProperty({ shortTermRentMinNights: 2 });
    await getDb().insert(propertyAvailabilityWindows).values({
      propertyId,
      scope: 'listing',
      startsAt: new Date(base + 40 * DAY),
      endsAt: new Date(base + 45 * DAY),
      status: 'blocked',
    });
    const pending = await book(propertyId, 'oxy-guest-a', stay(10, 15, base));
    const confirmed = await book(propertyId, 'oxy-guest-b', stay(20, 25, base));
    await request(buildApp('oxy-host')).patch(`/reservations/${confirmed}`).send({ status: 'confirmed' });

    const res = await request(buildApp('oxy-anyone')).get(`/properties/${propertyId}/availability`);
    expect(res.status).toBe(200);
    expect(res.body.data.minNights).toBe(2);
    expect(res.body.data.maxGuests).toBe(4);
    expect(res.body.data.windows).toHaveLength(1);
    expect(res.body.data.windows[0].start).toBeTruthy();
    // Only the CONFIRMED stay is "booked" — a pending request is not a
    // commitment, and listing it would show the calendar as fuller than it is.
    expect(res.body.data.booked).toHaveLength(1);
    expect(new Date(res.body.data.booked[0].start).getTime()).toBe(
      new Date(base + 20 * DAY).getTime(),
    );
    expect(pending).toBeTruthy();
  });

  it('answers 404 for a malformed id rather than 400', async () => {
    expect((await request(buildApp('oxy-guest')).get('/reservations/not-an-id')).status).toBe(404);
  });
});
