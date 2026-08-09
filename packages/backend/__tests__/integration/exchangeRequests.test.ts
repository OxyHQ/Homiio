/**
 * Home exchanges — the mode matrix, the dual-role calendar conflict, the two
 * coherence CHECKs, and the reviews that follow. Against the REAL Postgres.
 *
 * ## What makes these tests non-vacuous
 *
 * `exchange_requests` and `exchange_reviews` were empty in production. Each case
 * targets a rule with a way to be wrong:
 *
 *  - the overlap is asserted at the BOUNDARY instant, because `[)` and `[]`
 *    bounds agree everywhere except there — a port that copied `leases`'
 *    closed-bound spelling would refuse a legitimate back-to-back stay and pass
 *    every other test in this file,
 *  - the conflict is asserted in BOTH roles (target and offered), because a
 *    scan that forgot the offered role lets a swap double-book the home the
 *    requester offers in return,
 *  - `exchange_requests_offered_window_check` is asserted on the HALF-a-pair it
 *    exists to refuse, which is the shape a NULL-tolerant CHECK admits,
 *  - every refusal re-reads the row.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';

import exchangeController from '../../controllers/exchangeController';
import exchangeReviewController from '../../controllers/exchangeReviewController';
import { getDb } from '../../db/postgres';
import { exchangeRequests, exchangeReviews } from '../../db/schema';
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
  app.post('/exchanges', (req, res, next) => exchangeController.createExchangeRequest(req, res, next));
  app.get('/exchanges', (req, res, next) => exchangeController.listMyExchangeRequests(req, res, next));
  app.get('/exchanges/:id', (req, res, next) => exchangeController.getExchangeRequest(req, res, next));
  app.patch('/exchanges/:id', (req, res, next) => exchangeController.updateExchangeRequestStatus(req, res, next));
  app.post('/exchanges/:id/reviews', (req, res, next) => exchangeReviewController.createExchangeReview(req, res, next));
  app.get('/exchanges/:id/reviews', (req, res, next) => exchangeReviewController.getExchangeReviews(req, res, next));
  app.get('/profiles/:oxyUserId/exchange-reviews', (req, res, next) => exchangeReviewController.getProfileExchangeReviews(req, res, next));
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

/** A listing open to home exchange in `mode`. */
async function seedExchangeProperty(
  oxyUserId: string,
  mode: 'swap' | 'host' | 'both' = 'both',
): Promise<string> {
  const { propertyId } = await seedListingWithGeo({
    countryCode: nextCountryCode(),
    overrides: {
      oxyUserId,
      status: 'published',
      isExternal: false,
      // `properties_offerings_exchange_check` makes the offering exactly the
      // presence of the priced block, so the mode has to be set for the
      // offering to be listed.
      offerings: ['exchange'],
      exchangeMode: mode,
    },
  });
  return propertyId;
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * A window `fromDays`..`toDays` out, measured from an OPTIONAL fixed base.
 *
 * The base matters, and getting it wrong made an earlier version of the
 * boundary test below VACUOUS. Without it every call re-reads `Date.now()`, so
 * `window(10, 20).end` and `window(20, 30).start` land a few milliseconds
 * apart rather than on the same instant — the two windows are then disjoint
 * under EVERY bound convention, and the test passes whether the ranges are
 * `[)` or `[]`. Measured: three separate closed-bound mutations all survived
 * it. Pinning one base is what makes the boundary a real boundary.
 */
function window(fromDays: number, toDays: number, base = Date.now()) {
  return {
    start: new Date(base + fromDays * DAY).toISOString(),
    end: new Date(base + toDays * DAY).toISOString(),
  };
}

async function exchangeRow(id: string) {
  const [row] = await getDb()
    .select()
    .from(exchangeRequests)
    .where(eq(exchangeRequests.id, id))
    .limit(1);
  return row;
}

/** Open a HOST request and return its id. */
async function createHostRequest(
  propertyId: string,
  requester = 'oxy-guest',
  requestedWindow = window(10, 20),
): Promise<string> {
  const res = await request(buildApp(requester))
    .post('/exchanges')
    .send({ propertyId, mode: 'host', requestedWindow });
  expect(res.status).toBe(201);
  return res.body.data.id;
}

beforeEach(async () => {
  await getDb().delete(exchangeReviews);
  await getDb().delete(exchangeRequests);
  await resetGeoTables();
});

afterAll(async () => {
  // Leave the shared tables as this file found them — see the reproduced
  // geoBackfill collision documented in `leaseOwnership.test.ts`.
  await getDb().delete(exchangeReviews);
  await getDb().delete(exchangeRequests);
  await resetGeoTables();
});

describe('createExchangeRequest — the mode matrix', () => {
  it('opens a HOST request with a server-resolved host and no offer', async () => {
    const propertyId = await seedExchangeProperty('oxy-host', 'host');
    const res = await request(buildApp('oxy-guest'))
      .post('/exchanges')
      // A forged host and status must be ignored.
      .send({ propertyId, mode: 'host', requestedWindow: window(10, 20), hostOxyUserId: 'attacker', status: 'confirmed' });

    expect(res.status).toBe(201);
    const persisted = await exchangeRow(res.body.data.id);
    expect(persisted.hostOxyUserId).toBe('oxy-host');
    expect(persisted.status).toBe('pending');
    // `exchange_requests_host_mode_offers_nothing_check` — a host request
    // offers nothing, and the response omits the window entirely.
    expect(persisted.offeredPropertyId).toBeNull();
    expect(persisted.offeredWindowStart).toBeNull();
    expect(res.body.data.offeredWindow).toBeUndefined();
  });

  it('refuses a mode the listing does not accept, and accepts either on `both`', async () => {
    const hostOnly = await seedExchangeProperty('oxy-host', 'host');
    const swapAttempt = await request(buildApp('oxy-guest'))
      .post('/exchanges')
      .send({ propertyId: hostOnly, mode: 'swap', requestedWindow: window(10, 20) });
    expect(swapAttempt.status).toBe(400);

    const both = await seedExchangeProperty('oxy-host-2', 'both');
    const hostOnBoth = await request(buildApp('oxy-guest'))
      .post('/exchanges')
      .send({ propertyId: both, mode: 'host', requestedWindow: window(10, 20) });
    expect(hostOnBoth.status).toBe(201);
  });

  it('refuses `both` as a REQUEST mode — it is a listing capability, not a request', async () => {
    const propertyId = await seedExchangeProperty('oxy-host', 'both');
    const res = await request(buildApp('oxy-guest'))
      .post('/exchanges')
      .send({ propertyId, mode: 'both', requestedWindow: window(10, 20) });
    expect(res.status).toBe(400);
  });

  it('refuses a listing not open to exchange, an external one, and your own', async () => {
    const notExchangeable = (await seedListingWithGeo({
      countryCode: nextCountryCode(),
      overrides: { oxyUserId: 'oxy-host', status: 'published' },
    })).propertyId;
    expect(
      (await request(buildApp('oxy-guest')).post('/exchanges').send({ propertyId: notExchangeable, mode: 'host', requestedWindow: window(10, 20) })).status,
    ).toBe(400);

    const own = await seedExchangeProperty('oxy-guest', 'host');
    expect(
      (await request(buildApp('oxy-guest')).post('/exchanges').send({ propertyId: own, mode: 'host', requestedWindow: window(10, 20) })).status,
    ).toBe(403);

    expect(await getDb().select().from(exchangeRequests)).toHaveLength(0);
  });

  it('refuses a window in the past and an inverted one', async () => {
    const propertyId = await seedExchangeProperty('oxy-host', 'host');
    const app = buildApp('oxy-guest');

    const inPast = await request(app).post('/exchanges').send({ propertyId, mode: 'host', requestedWindow: window(-5, 5) });
    expect(inPast.status).toBe(400);
    const inverted = await request(app).post('/exchanges').send({ propertyId, mode: 'host', requestedWindow: window(20, 10) });
    expect(inverted.status).toBe(400);
  });

  it('requires an offered property AND window for a swap, and that you own it', async () => {
    const target = await seedExchangeProperty('oxy-host', 'swap');
    const app = buildApp('oxy-guest');

    const noOffer = await request(app)
      .post('/exchanges')
      .send({ propertyId: target, mode: 'swap', requestedWindow: window(10, 20) });
    expect(noOffer.status).toBe(400);

    const notMine = await seedExchangeProperty('oxy-somebody-else', 'swap');
    const notOwned = await request(app).post('/exchanges').send({
      propertyId: target,
      mode: 'swap',
      offeredPropertyId: notMine,
      requestedWindow: window(10, 20),
      offeredWindow: window(30, 40),
    });
    expect(notOwned.status).toBe(403);

    const mine = await seedExchangeProperty('oxy-guest', 'swap');
    const noWindow = await request(app).post('/exchanges').send({
      propertyId: target,
      mode: 'swap',
      offeredPropertyId: mine,
      requestedWindow: window(10, 20),
    });
    expect(noWindow.status).toBe(400);

    expect(await getDb().select().from(exchangeRequests)).toHaveLength(0);
  });

  it('stores a swap with both windows', async () => {
    const target = await seedExchangeProperty('oxy-host', 'swap');
    const mine = await seedExchangeProperty('oxy-guest', 'swap');

    const res = await request(buildApp('oxy-guest')).post('/exchanges').send({
      propertyId: target,
      mode: 'swap',
      offeredPropertyId: mine,
      requestedWindow: window(10, 20),
      offeredWindow: window(30, 40),
    });
    expect(res.status).toBe(201);
    expect(res.body.data.offeredWindow.start).toBeTruthy();

    const persisted = await exchangeRow(res.body.data.id);
    expect(persisted.offeredPropertyId).toBe(mine);
    expect(persisted.offeredWindowStart).not.toBeNull();
    expect(persisted.offeredWindowEnd).not.toBeNull();
  });
});

describe('exchange_requests_offered_window_check', () => {
  it('REFUSES half an offered window — the shape a NULL-tolerant CHECK admits', async () => {
    // `CONVENTIONS.md` records that the first draft of this constraint let
    // exactly this through: with one side set the coherent branch is `false`,
    // the comparison is NULL, and `false or NULL` is NULL rather than false.
    const propertyId = await seedExchangeProperty('oxy-host', 'swap');
    const offered = await seedExchangeProperty('oxy-guest', 'swap');
    const base = {
      propertyId,
      requesterOxyUserId: 'oxy-guest',
      hostOxyUserId: 'oxy-host',
      mode: 'swap' as const,
      requestedWindowStart: new Date(Date.now() + 10 * DAY),
      requestedWindowEnd: new Date(Date.now() + 20 * DAY),
      offeredPropertyId: offered,
    };

    await expect(
      getDb().insert(exchangeRequests).values({ ...base, offeredWindowStart: new Date(Date.now() + 30 * DAY) }),
    ).rejects.toThrow();

    await expect(
      getDb().insert(exchangeRequests).values({ ...base, offeredWindowEnd: new Date(Date.now() + 40 * DAY) }),
    ).rejects.toThrow();

    // And it PERMITS both halves absent, which is the `host` shape.
    const [ok] = await getDb().insert(exchangeRequests).values(base).returning();
    expect(ok.offeredWindowStart).toBeNull();
  });

  it('REFUSES a host-mode request that carries an offer', async () => {
    const propertyId = await seedExchangeProperty('oxy-host', 'host');
    const offered = await seedExchangeProperty('oxy-guest', 'swap');
    await expect(
      getDb().insert(exchangeRequests).values({
        propertyId,
        requesterOxyUserId: 'oxy-guest',
        hostOxyUserId: 'oxy-host',
        mode: 'host',
        requestedWindowStart: new Date(Date.now() + 10 * DAY),
        requestedWindowEnd: new Date(Date.now() + 20 * DAY),
        offeredPropertyId: offered,
      }),
    ).rejects.toThrow();
  });
});

describe('the calendar conflict — half-open, and both roles', () => {
  it('blocks an overlapping request once one is CONFIRMED, and not before', async () => {
    const propertyId = await seedExchangeProperty('oxy-host', 'host');
    const first = await createHostRequest(propertyId, 'oxy-guest-a', window(10, 20));

    // A pending request does not occupy the calendar.
    const whilePending = await request(buildApp('oxy-guest-b'))
      .post('/exchanges')
      .send({ propertyId, mode: 'host', requestedWindow: window(15, 25) });
    expect(whilePending.status).toBe(201);

    await request(buildApp('oxy-host')).patch(`/exchanges/${first}`).send({ status: 'confirmed' });

    const afterConfirm = await request(buildApp('oxy-guest-c'))
      .post('/exchanges')
      .send({ propertyId, mode: 'host', requestedWindow: window(15, 25) });
    expect(afterConfirm.status).toBe(409);
  });

  it('PERMITS a back-to-back stay — `[)` bounds, asserted at the EXACT boundary', async () => {
    // The one instant where `[)` and `[]` disagree, so both windows are built
    // from ONE base: the first ends at exactly the instant the second begins.
    // Mutation-tested — closing either range, or both, turns this red.
    const base = Date.now();
    const propertyId = await seedExchangeProperty('oxy-host', 'host');
    const first = await createHostRequest(propertyId, 'oxy-guest-a', window(10, 20, base));
    await request(buildApp('oxy-host')).patch(`/exchanges/${first}`).send({ status: 'confirmed' });

    const adjacent = await request(buildApp('oxy-guest-b'))
      .post('/exchanges')
      .send({ propertyId, mode: 'host', requestedWindow: window(20, 30, base) });
    expect(adjacent.status).toBe(201);

    // And the REVERSE order, which exercises the other side of the boundary: a
    // confirmed LATER stay must not block the earlier one that ends where it
    // starts. Only this direction catches a closed bound on the STORED range.
    const other = await seedExchangeProperty('oxy-host-2', 'host');
    const later = await createHostRequest(other, 'oxy-guest-a', window(20, 30, base));
    await request(buildApp('oxy-host-2')).patch(`/exchanges/${later}`).send({ status: 'confirmed' });

    const earlier = await request(buildApp('oxy-guest-b'))
      .post('/exchanges')
      .send({ propertyId: other, mode: 'host', requestedWindow: window(10, 20, base) });
    expect(earlier.status).toBe(201);
  });

  it('blocks on the OFFERED role too — a swap cannot double-book the home offered in return', async () => {
    // The half an overlap scan that only checked `property_id` would miss.
    const targetA = await seedExchangeProperty('oxy-host-a', 'swap');
    const targetB = await seedExchangeProperty('oxy-host-b', 'swap');
    const mine = await seedExchangeProperty('oxy-guest', 'swap');

    const first = await request(buildApp('oxy-guest')).post('/exchanges').send({
      propertyId: targetA,
      mode: 'swap',
      offeredPropertyId: mine,
      requestedWindow: window(10, 20),
      offeredWindow: window(30, 40),
    });
    expect(first.status).toBe(201);
    await request(buildApp('oxy-host-a')).patch(`/exchanges/${first.body.data.id}`).send({ status: 'confirmed' });

    // My home is now committed for days 30-40. Offering it again over an
    // overlapping window must be refused, even against a different host.
    const second = await request(buildApp('oxy-guest')).post('/exchanges').send({
      propertyId: targetB,
      mode: 'swap',
      offeredPropertyId: mine,
      requestedWindow: window(50, 60),
      offeredWindow: window(35, 45),
    });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('OFFERED_DATE_CONFLICT');
  });

  it('does not let a request conflict with ITSELF at confirm time', async () => {
    const propertyId = await seedExchangeProperty('oxy-host', 'host');
    const id = await createHostRequest(propertyId);
    const res = await request(buildApp('oxy-host')).patch(`/exchanges/${id}`).send({ status: 'confirmed' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('confirmed');
  });
});

describe('the transition machine', () => {
  it('lets only the host confirm or decline, and only from pending', async () => {
    const propertyId = await seedExchangeProperty('oxy-host', 'host');
    const id = await createHostRequest(propertyId);

    expect((await request(buildApp('oxy-guest')).patch(`/exchanges/${id}`).send({ status: 'confirmed' })).status).toBe(403);
    expect((await exchangeRow(id)).status).toBe('pending');

    expect((await request(buildApp('oxy-host')).patch(`/exchanges/${id}`).send({ status: 'confirmed' })).status).toBe(200);
    // The precondition is in the UPDATE, so a second confirm matches no row.
    expect((await request(buildApp('oxy-host')).patch(`/exchanges/${id}`).send({ status: 'declined' })).status).toBe(400);
  });

  it('lets only the requester cancel, from pending or confirmed, and converges', async () => {
    const propertyId = await seedExchangeProperty('oxy-host', 'host');
    const id = await createHostRequest(propertyId);

    expect((await request(buildApp('oxy-host')).patch(`/exchanges/${id}`).send({ status: 'cancelled' })).status).toBe(403);

    expect((await request(buildApp('oxy-guest')).patch(`/exchanges/${id}`).send({ status: 'cancelled' })).status).toBe(200);
    // Already cancelled: 200 with the current state, and the message still applies.
    const again = await request(buildApp('oxy-guest')).patch(`/exchanges/${id}`).send({ status: 'cancelled', message: 'sorry' });
    expect(again.status).toBe(200);
    expect((await exchangeRow(id)).message).toBe('sorry');
  });

  it('completes only a CONFIRMED exchange whose window has passed', async () => {
    const propertyId = await seedExchangeProperty('oxy-host', 'host');
    // A window entirely in the past — seeded directly, since the create path
    // refuses one.
    const [row] = await getDb()
      .insert(exchangeRequests)
      .values({
        propertyId,
        requesterOxyUserId: 'oxy-guest',
        hostOxyUserId: 'oxy-host',
        mode: 'host',
        requestedWindowStart: new Date(Date.now() - 20 * DAY),
        requestedWindowEnd: new Date(Date.now() - 10 * DAY),
        status: 'pending',
      })
      .returning();

    // Not confirmed yet.
    expect((await request(buildApp('oxy-guest')).patch(`/exchanges/${row.id}`).send({ status: 'completed' })).status).toBe(400);

    await request(buildApp('oxy-host')).patch(`/exchanges/${row.id}`).send({ status: 'confirmed' });
    const completed = await request(buildApp('oxy-guest')).patch(`/exchanges/${row.id}`).send({ status: 'completed' });
    expect(completed.status).toBe(200);
  });

  it('refuses to complete a confirmed exchange whose window has NOT passed', async () => {
    const propertyId = await seedExchangeProperty('oxy-host', 'host');
    const id = await createHostRequest(propertyId);
    await request(buildApp('oxy-host')).patch(`/exchanges/${id}`).send({ status: 'confirmed' });

    const res = await request(buildApp('oxy-guest')).patch(`/exchanges/${id}`).send({ status: 'completed' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('STAY_NOT_ENDED');
  });

  it('refuses an unsupported transition and a non-party', async () => {
    const propertyId = await seedExchangeProperty('oxy-host', 'host');
    const id = await createHostRequest(propertyId);

    expect((await request(buildApp('oxy-host')).patch(`/exchanges/${id}`).send({ status: 'pending' })).status).toBe(400);
    expect((await request(buildApp('oxy-stranger')).patch(`/exchanges/${id}`).send({ status: 'confirmed' })).status).toBe(403);
  });
});

describe('reads', () => {
  it('shows a request only to its two parties', async () => {
    const propertyId = await seedExchangeProperty('oxy-host', 'host');
    const id = await createHostRequest(propertyId);

    expect((await request(buildApp('oxy-guest')).get(`/exchanges/${id}`)).status).toBe(200);
    expect((await request(buildApp('oxy-host')).get(`/exchanges/${id}`)).status).toBe(200);
    expect((await request(buildApp('oxy-stranger')).get(`/exchanges/${id}`)).status).toBe(403);
  });

  it('splits the guest and host views, with no profile needed', async () => {
    // The `Profile.findByOxyUserId` guard is dropped: `oxy-guest` has no profile
    // document anywhere in this suite and must still see their own request.
    const propertyId = await seedExchangeProperty('oxy-host', 'host');
    await createHostRequest(propertyId);

    const asGuest = await request(buildApp('oxy-guest')).get('/exchanges');
    expect(asGuest.status).toBe(200);
    expect(asGuest.body.data).toHaveLength(1);

    const asHost = await request(buildApp('oxy-host')).get('/exchanges?asHost=true');
    expect(asHost.body.data).toHaveLength(1);

    const hostOwnView = await request(buildApp('oxy-host')).get('/exchanges');
    expect(hostOwnView.body.data).toHaveLength(0);
  });

  it('answers 404 for a malformed id rather than 400', async () => {
    const res = await request(buildApp('oxy-guest')).get('/exchanges/not-an-id');
    expect(res.status).toBe(404);
  });
});

describe('exchange reviews', () => {
  /** A completed exchange between `oxy-guest` and `oxy-host`. */
  async function completedExchange(): Promise<string> {
    const propertyId = await seedExchangeProperty('oxy-host', 'host');
    const [row] = await getDb()
      .insert(exchangeRequests)
      .values({
        propertyId,
        requesterOxyUserId: 'oxy-guest',
        hostOxyUserId: 'oxy-host',
        mode: 'host',
        requestedWindowStart: new Date(Date.now() - 20 * DAY),
        requestedWindowEnd: new Date(Date.now() - 10 * DAY),
        status: 'completed',
      })
      .returning();
    return row.id;
  }

  it('lets each party review the OTHER, once', async () => {
    const id = await completedExchange();

    const byGuest = await request(buildApp('oxy-guest'))
      .post(`/exchanges/${id}/reviews`)
      .send({ rating: 5, comment: 'lovely', categories: { communication: 5, cleanliness: 4 } });
    expect(byGuest.status).toBe(201);
    // The subject is resolved server-side — the reviewer never names it.
    expect(byGuest.body.data.subjectOxyUserId).toBe('oxy-host');
    expect(byGuest.body.data.categories.communication).toBe(5);

    // Second review by the same reviewer: 409 from the UNIQUE index, no
    // pre-read.
    const twice = await request(buildApp('oxy-guest'))
      .post(`/exchanges/${id}/reviews`)
      .send({ rating: 3 });
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe('ALREADY_REVIEWED');

    // The other party may still review.
    const byHost = await request(buildApp('oxy-host')).post(`/exchanges/${id}/reviews`).send({ rating: 4 });
    expect(byHost.status).toBe(201);
    expect(byHost.body.data.subjectOxyUserId).toBe('oxy-guest');

    expect(await getDb().select().from(exchangeReviews)).toHaveLength(2);
  });

  it('refuses a review before the exchange is completed, and from a non-party', async () => {
    const propertyId = await seedExchangeProperty('oxy-host', 'host');
    const pending = await createHostRequest(propertyId);
    expect((await request(buildApp('oxy-guest')).post(`/exchanges/${pending}/reviews`).send({ rating: 5 })).status).toBe(400);

    const done = await completedExchange();
    expect((await request(buildApp('oxy-stranger')).post(`/exchanges/${done}/reviews`).send({ rating: 5 })).status).toBe(403);

    expect(await getDb().select().from(exchangeReviews)).toHaveLength(0);
  });

  it('REFUSES a rating outside 1-5 and a self-review', async () => {
    const id = await completedExchange();
    const res = await request(buildApp('oxy-guest')).post(`/exchanges/${id}/reviews`).send({ rating: 9 });
    // The CHECK, surfaced as a 500 rather than a 400 — the rating is not
    // narrowed in the controller, so this pins where the refusal comes from
    // rather than claiming a validation that is not there.
    expect(res.status).toBe(500);

    await expect(
      getDb().insert(exchangeReviews).values({
        exchangeRequestId: id,
        reviewerOxyUserId: 'oxy-same',
        subjectOxyUserId: 'oxy-same',
        rating: 5,
      }),
    ).rejects.toThrow();
  });

  it('aggregates a subject average from ONE statement', async () => {
    const first = await completedExchange();
    const second = await completedExchange();
    await request(buildApp('oxy-guest')).post(`/exchanges/${first}/reviews`).send({ rating: 5 });
    await request(buildApp('oxy-guest')).post(`/exchanges/${second}/reviews`).send({ rating: 4 });

    const res = await request(buildApp('oxy-anyone')).get('/profiles/oxy-host/exchange-reviews');
    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(2);
    expect(res.body.meta.averageRating).toBe(4.5);
    expect(res.body.meta.reviewCount).toBe(2);
  });

  it('reports 0 rather than null for a subject with no reviews', async () => {
    const res = await request(buildApp('oxy-anyone')).get('/profiles/oxy-nobody/exchange-reviews');
    expect(res.status).toBe(200);
    expect(res.body.meta.averageRating).toBe(0);
  });
});
