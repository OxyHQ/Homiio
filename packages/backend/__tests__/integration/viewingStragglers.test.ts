/**
 * The two readers that were left pointing at Mongo after `viewing_requests`
 * moved — the retention sweep and the owner analytics — plus the owner selector
 * they both depend on.
 *
 * ## Why these need tests at all, when the port itself was mechanical
 *
 * Both failed SILENTLY, and in the worse of the two ways:
 *
 *  - `cleanupService` kept issuing its `deleteMany` against Mongo, so it reaped
 *    NOTHING. Unlike a read that returns an empty list, a sweep that deletes
 *    nothing produces no output at all — its only symptom is disk, months
 *    later. So the test asserts a POSITIVE deletion count and that the rows
 *    really went, not merely that the call resolved.
 *  - `analyticsController` selected the caller's listings by `profileId`, which
 *    `PropertySchema` never declared, so every figure it reported had been 0
 *    since it was written. The test asserts NON-ZERO numbers, because a port
 *    that moved the queries and left the selector broken would still return
 *    zeros and look done.
 *
 * The retention window and the status filter are asserted on what they SPARE as
 * well as what they reap: a sweep scoped too widely deletes live rows, and
 * nothing about a successful sweep says which it was.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';

import analyticsController from '../../controllers/analyticsController';
import { getDb } from '../../db/postgres';
import { pruneClosedViewingsBefore } from '../../db/bookings/viewingReads';
import { profiles, recentlyViewed, savedItems, viewingRequests } from '../../db/schema';
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
  app.get('/analytics', (req, res, next) => analyticsController.getAnalytics(req, res, next));
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

async function seedOwnedListing(oxyUserId: string): Promise<string> {
  const { propertyId } = await seedListingWithGeo({
    countryCode: nextCountryCode(),
    overrides: { oxyUserId, status: 'published' },
  });
  return propertyId;
}

/** Insert a viewing request with an explicit status and `updated_at`. */
async function seedViewing(options: {
  propertyId: string;
  ownerOxyUserId: string;
  status: 'pending' | 'approved' | 'declined' | 'cancelled';
  updatedAt?: Date;
  createdAt?: Date;
}) {
  const [row] = await getDb()
    .insert(viewingRequests)
    .values({
      propertyId: options.propertyId,
      requesterOxyUserId: 'oxy-requester',
      ownerOxyUserId: options.ownerOxyUserId,
      scheduledAt: new Date(Date.now() + 30 * DAY),
      status: options.status,
      // `cancelled_by` is an equivalence with the status — the CHECK refuses a
      // cancelled row that names nobody.
      cancelledBy: options.status === 'cancelled' ? 'requester' : undefined,
      ...(options.updatedAt ? { updatedAt: options.updatedAt } : {}),
      ...(options.createdAt ? { createdAt: options.createdAt } : {}),
    })
    .returning();
  return row;
}

beforeEach(async () => {
  await getDb().delete(viewingRequests);
  await getDb().delete(recentlyViewed);
  await getDb().delete(savedItems);
  await getDb().delete(profiles);
  await resetGeoTables();
});

afterAll(async () => {
  // Leave the shared tables as this file found them — see the reproduced
  // geoBackfill collision documented in `leaseOwnership.test.ts`.
  await getDb().delete(viewingRequests);
  await getDb().delete(recentlyViewed);
  await getDb().delete(savedItems);
  await getDb().delete(profiles);
  await resetGeoTables();
});

describe('pruneClosedViewingsBefore — the sweep that was reaping nothing', () => {
  it('REAPS declined and cancelled requests past the cutoff', async () => {
    const propertyId = await seedOwnedListing('oxy-owner');
    const old = new Date(Date.now() - 200 * DAY);
    const declined = await seedViewing({ propertyId, ownerOxyUserId: 'oxy-owner', status: 'declined', updatedAt: old });
    const cancelled = await seedViewing({ propertyId, ownerOxyUserId: 'oxy-owner', status: 'cancelled', updatedAt: old });

    const removed = await pruneClosedViewingsBefore(getDb(), new Date(Date.now() - 90 * DAY));

    // A POSITIVE count, and the rows really gone. A sweep that resolved without
    // deleting — which is exactly what the Mongo-backed version did after the
    // table moved — passes any assertion that only checks it did not throw.
    expect(removed).toBe(2);
    expect(await getDb().select().from(viewingRequests).where(eq(viewingRequests.id, declined.id))).toHaveLength(0);
    expect(await getDb().select().from(viewingRequests).where(eq(viewingRequests.id, cancelled.id))).toHaveLength(0);
  });

  it('SPARES a closed request inside the window, and open ones at any age', async () => {
    // The half a sweep scoped too widely gets wrong — and nothing about a
    // successful deletion says which rows it took.
    const propertyId = await seedOwnedListing('oxy-owner');
    const old = new Date(Date.now() - 200 * DAY);
    const recent = new Date(Date.now() - 10 * DAY);

    const recentlyDeclined = await seedViewing({ propertyId, ownerOxyUserId: 'oxy-owner', status: 'declined', updatedAt: recent });
    const oldPending = await seedViewing({ propertyId, ownerOxyUserId: 'oxy-owner', status: 'pending', updatedAt: old });
    const oldApproved = await seedViewing({ propertyId, ownerOxyUserId: 'oxy-owner', status: 'approved', updatedAt: old });

    const removed = await pruneClosedViewingsBefore(getDb(), new Date(Date.now() - 90 * DAY));

    expect(removed).toBe(0);
    for (const row of [recentlyDeclined, oldPending, oldApproved]) {
      expect(await getDb().select().from(viewingRequests).where(eq(viewingRequests.id, row.id))).toHaveLength(1);
    }
  });
});

describe('owner analytics — the endpoint that always returned zeros', () => {
  /**
   * The controller still resolves a profile before it will answer, so the test
   * seeds one. That guard is untouched by this change: unlike the saved-search
   * and exchange cases, this endpoint's early return is a documented response
   * shape rather than a vestigial ownership check.
   *
   * It is a POSTGRES row now. The gate itself was always sound — a plain
   * `findOne({ oxyUserId })` on a declared, indexed path — but profiles are
   * WRITTEN to Postgres, so a Mongo read of them would answer zeros forever for
   * anyone whose profile was created after that port landed. A fixture left on
   * `Profile.create` would go on passing against the Mongo version and fail
   * here, which is what it did.
   */
  async function seedProfile(oxyUserId: string) {
    return getDb().insert(profiles).values({ oxyUserId });
  }

  it('reports REAL numbers for views, saves and viewing requests', async () => {
    // The assertion that matters: non-zero. `Property.distinct('_id', {
    // profileId })` matched nothing, so a port that moved these queries and
    // left the selector alone would still answer 0 everywhere and look done.
    await seedProfile('oxy-owner');
    const propertyId = await seedOwnedListing('oxy-owner');
    const second = await seedOwnedListing('oxy-owner');

    // ONE viewer across TWO listings, plus a second viewer on one of them: 3
    // views from 2 distinct people. The fixture has to make `count(*)` and
    // `count(distinct viewer)` DISAGREE, or a mutation swapping one for the
    // other survives — measured, it did. `recently_viewed_owner_property_key`
    // is unique per (person, listing), so the repeat has to be a second
    // listing rather than a second row on the same one.
    await getDb().insert(recentlyViewed).values([
      { oxyUserId: 'oxy-viewer-a', propertyId },
      { oxyUserId: 'oxy-viewer-a', propertyId: second },
      { oxyUserId: 'oxy-viewer-b', propertyId },
    ]);
    await getDb().insert(savedItems).values({
      oxyUserId: 'oxy-viewer-a',
      targetType: 'property',
      targetId: propertyId,
    });
    await seedViewing({ propertyId, ownerOxyUserId: 'oxy-owner', status: 'pending' });
    await seedViewing({ propertyId, ownerOxyUserId: 'oxy-owner', status: 'approved' });
    await seedViewing({ propertyId, ownerOxyUserId: 'oxy-owner', status: 'declined' });

    const res = await request(buildApp('oxy-owner')).get('/analytics');
    expect(res.status).toBe(200);

    expect(res.body.data.views.total).toBe(3);
    // Two DISTINCT viewers out of three views — `count_distinct` on the owner
    // column, where the source did `$addToSet: '$profileId'` on a path that
    // does not exist. The two figures differ here on purpose.
    expect(res.body.data.views.uniqueViewers).toBe(2);
    expect(res.body.data.saves.total).toBe(1);
    expect(res.body.data.viewingRequests.received).toBe(3);
    expect(res.body.data.viewingRequests.pending).toBe(1);
    expect(res.body.data.viewingRequests.approved).toBe(1);
    expect(res.body.data.viewingRequests.declined).toBe(1);
    expect(res.body.data.viewingRequests.cancelled).toBe(0);
  });

  it("counts only the CALLER's own listings and requests", async () => {
    await seedProfile('oxy-owner');
    await seedProfile('oxy-other');
    const mine = await seedOwnedListing('oxy-owner');
    const theirs = await seedOwnedListing('oxy-other');

    await getDb().insert(recentlyViewed).values([
      { oxyUserId: 'oxy-viewer-a', propertyId: mine },
      { oxyUserId: 'oxy-viewer-b', propertyId: theirs },
    ]);
    await seedViewing({ propertyId: mine, ownerOxyUserId: 'oxy-owner', status: 'pending' });
    await seedViewing({ propertyId: theirs, ownerOxyUserId: 'oxy-other', status: 'pending' });

    const res = await request(buildApp('oxy-owner')).get('/analytics');
    expect(res.body.data.views.total).toBe(1);
    expect(res.body.data.viewingRequests.received).toBe(1);
  });

  it('excludes ARCHIVED listings from the owner selector', async () => {
    await seedProfile('oxy-owner');
    const live = await seedOwnedListing('oxy-owner');
    const { propertyId: archived } = await seedListingWithGeo({
      countryCode: nextCountryCode(),
      overrides: { oxyUserId: 'oxy-owner', status: 'archived' },
    });

    await getDb().insert(recentlyViewed).values([
      { oxyUserId: 'oxy-viewer-a', propertyId: live },
      { oxyUserId: 'oxy-viewer-b', propertyId: archived },
    ]);

    const res = await request(buildApp('oxy-owner')).get('/analytics');
    expect(res.body.data.views.total).toBe(1);
  });

  it('honours the reporting period', async () => {
    await seedProfile('oxy-owner');
    const propertyId = await seedOwnedListing('oxy-owner');

    await getDb().insert(recentlyViewed).values([
      { oxyUserId: 'oxy-recent', propertyId },
      // `viewed_at` is `createdAt()`-defaulted, so an old row has to name it.
      { oxyUserId: 'oxy-ancient', propertyId, viewedAt: new Date(Date.now() - 400 * DAY) },
    ]);

    const res = await request(buildApp('oxy-owner')).get('/analytics?period=30d');
    expect(res.body.data.views.total).toBe(1);
  });
});
