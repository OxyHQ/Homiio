/**
 * Recently-viewed listings — the unique key, the ordering, and the 90-day
 * retention sweep that is the table's ONLY bound.
 *
 * The real handlers against the REAL Postgres this worker owns. The Mongo
 * collection was empty in production because BOTH of its write paths were
 * broken (see `db/saved/recentlyViewedRepository.ts`), so nothing here asserts a
 * preserved row.
 *
 * ## The retention sweep is tested through `CleanupService`, not the repository
 *
 * This is the append-heavy table in the domain — it grows on READS rather than
 * on deliberate user action — so the thing that actually has to hold is that the
 * scheduled job still prunes it after the store changed underneath it.
 * `cleanupOldData` is what cron calls; testing `pruneRecentlyViewedBefore`
 * alone would pass just as happily with the service still wired to a Mongoose
 * model that no longer receives any rows.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';

import * as recentlyViewedController from '../../controllers/profile/recentlyViewed';
import { getDb } from '../../db/postgres';
import { properties as propertiesTable, recentlyViewed } from '../../db/schema';
import { errorHandler } from '../../middlewares/errorHandler';
import { CleanupService } from '../../services/cleanupService';
import { resetGeoTables, seedListingWithGeo, seedProperty } from '../helpers/postgresGeoFixtures';

const DAY_MS = 24 * 60 * 60 * 1000;

function buildApp(oxyUserId?: string): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (oxyUserId) {
      (req as unknown as { user: { id: string } }).user = { id: oxyUserId };
    }
    next();
  });
  app.get('/recent-properties', (req, res, next) =>
    recentlyViewedController.getRecentProperties(req, res, next),
  );
  app.post('/recent-properties/:propertyId', (req, res, next) =>
    recentlyViewedController.trackPropertyView(req, res, next),
  );
  app.delete('/recent-properties', (req, res, next) =>
    recentlyViewedController.clearRecentProperties(req, res, next),
  );
  app.use(errorHandler);
  return app;
}

let listingA: string;
let listingB: string;
let listingC: string;
let addressId: string;

async function viewsOf(oxyUserId: string) {
  return getDb().select().from(recentlyViewed).where(eq(recentlyViewed.oxyUserId, oxyUserId));
}

/** Backdate a stored view, so the retention window has something to act on. */
async function backdateView(oxyUserId: string, propertyId: string, daysAgo: number) {
  await getDb()
    .update(recentlyViewed)
    .set({ viewedAt: new Date(Date.now() - daysAgo * DAY_MS) })
    .where(eq(recentlyViewed.oxyUserId, oxyUserId));
  return propertyId;
}

beforeEach(async () => {
  await getDb().delete(recentlyViewed);
  await resetGeoTables();

  const seeded = await seedListingWithGeo({ cityName: 'Madrid' });
  addressId = seeded.addressId;
  listingA = seeded.propertyId;
  listingB = await seedProperty({ addressId });
  listingC = await seedProperty({ addressId });
});

/**
 * Leave the database as this file found it — see the identical hook in
 * `savedProperties.test.ts` for the measured consequence of not doing so.
 */
afterAll(async () => {
  await getDb().delete(recentlyViewed);
  await resetGeoTables();
});

describe('trackPropertyView', () => {
  it('records a view', async () => {
    const res = await request(buildApp('oxy-a')).post(`/recent-properties/${listingA}`);
    expect(res.status).toBe(200);

    const views = await viewsOf('oxy-a');
    expect(views).toHaveLength(1);
    expect(views[0].propertyId).toBe(listingA);
  });

  it('moves `viewed_at` on a repeat instead of adding a second row', async () => {
    const app = buildApp('oxy-a');
    await request(app).post(`/recent-properties/${listingA}`);
    const first = (await viewsOf('oxy-a'))[0];

    await new Promise((resolve) => setTimeout(resolve, 10));
    await request(app).post(`/recent-properties/${listingA}`);

    const views = await viewsOf('oxy-a');
    expect(views).toHaveLength(1);
    expect(views[0].viewedAt.getTime()).toBeGreaterThan(first.viewedAt.getTime());
    // `created_at` is when the listing was FIRST opened and must not move with
    // it — the two are different facts and the read orders by the latter.
    expect(views[0].createdAt.getTime()).toBe(first.createdAt.getTime());
  });

  it('scopes the unique key to the OWNER — two people may both view one listing', async () => {
    // The index that breaks this is `UNIQUE(property_id)`, which passes the
    // "no duplicate row" assertion above just as happily.
    await request(buildApp('oxy-a')).post(`/recent-properties/${listingA}`);
    await request(buildApp('oxy-b')).post(`/recent-properties/${listingA}`);

    expect(await viewsOf('oxy-a')).toHaveLength(1);
    expect(await viewsOf('oxy-b')).toHaveLength(1);
  });

  it('answers 404 for a listing that does not exist, and stores nothing', async () => {
    const res = await request(buildApp('oxy-a')).post('/recent-properties/507f1f77bcf86cd799439011');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('PROPERTY_NOT_FOUND');
    expect(await viewsOf('oxy-a')).toHaveLength(0);
  });

  it('requires authentication', async () => {
    expect((await request(buildApp()).post(`/recent-properties/${listingA}`)).status).toBe(401);
  });
});

describe('getRecentProperties', () => {
  it('returns hydrated listings, most recently viewed first', async () => {
    const app = buildApp('oxy-a');
    await request(app).post(`/recent-properties/${listingA}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await request(app).post(`/recent-properties/${listingB}`);

    const res = await request(app).get('/recent-properties');
    expect(res.status).toBe(200);
    expect(res.body.data.map((row: { id: string }) => row.id)).toEqual([listingB, listingA]);
    // Hydrated through the catalogue serializer, address join included.
    expect(res.body.data[0].address).toBeDefined();
    expect(res.body.data[0].viewedAt).toEqual(expect.any(String));
    expect(res.body.data[0]._id).toBeUndefined();
  });

  it("returns only the caller's own history", async () => {
    await request(buildApp('oxy-a')).post(`/recent-properties/${listingA}`);
    await request(buildApp('oxy-b')).post(`/recent-properties/${listingB}`);

    const res = await request(buildApp('oxy-a')).get('/recent-properties');
    expect(res.body.data.map((row: { id: string }) => row.id)).toEqual([listingA]);
  });

  it('honours `?limit` and keeps the NEWEST rows', async () => {
    const app = buildApp('oxy-a');
    for (const listing of [listingA, listingB, listingC]) {
      await request(app).post(`/recent-properties/${listing}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const res = await request(app).get('/recent-properties?limit=2');
    // A `limit` applied AFTER the ordering, not before: the two most recent are
    // C and B, and an implementation that limited first would be free to return
    // A.
    expect(res.body.data.map((row: { id: string }) => row.id)).toEqual([listingC, listingB]);
  });

  it('caps an absurd `?limit` rather than hydrating whatever was asked for', async () => {
    // Mongo's `parseInt(limit)` was unbounded, and hydration here is a catalogue
    // read with four joins plus three batched child queries per page.
    const app = buildApp('oxy-a');
    await request(app).post(`/recent-properties/${listingA}`);

    const res = await request(app).get('/recent-properties?limit=1000000');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('drops a view when its listing is deleted — the foreign key CASCADEs', async () => {
    await request(buildApp('oxy-a')).post(`/recent-properties/${listingA}`);
    await getDb().delete(propertiesTable).where(eq(propertiesTable.id, listingA));

    expect(await viewsOf('oxy-a')).toHaveLength(0);
    const res = await request(buildApp('oxy-a')).get('/recent-properties');
    expect(res.body.data).toEqual([]);
  });

  it('requires authentication', async () => {
    expect((await request(buildApp()).get('/recent-properties')).status).toBe(401);
  });
});

describe('clearRecentProperties', () => {
  it("clears the caller's history and reports the count, leaving other people alone", async () => {
    await request(buildApp('oxy-a')).post(`/recent-properties/${listingA}`);
    await request(buildApp('oxy-a')).post(`/recent-properties/${listingB}`);
    await request(buildApp('oxy-b')).post(`/recent-properties/${listingA}`);

    const res = await request(buildApp('oxy-a')).delete('/recent-properties');
    expect(res.status).toBe(200);
    expect(res.body.data.deletedCount).toBe(2);

    expect(await viewsOf('oxy-a')).toHaveLength(0);
    expect(await viewsOf('oxy-b')).toHaveLength(1);
  });

  it('succeeds for a caller who has no profile document — the guard is gone', async () => {
    // The Mongo handler required `Profile.findByOxyUserId` and answered 404
    // without one. That was never an authorisation check: the delete is scoped
    // by `oxyUserId` from the session either way. Nothing in this suite creates
    // a profile, so a restored guard would fail every case above too — this one
    // states the rule rather than relying on that.
    const res = await request(buildApp('oxy-nobody')).delete('/recent-properties');
    expect(res.status).toBe(200);
    expect(res.body.data.deletedCount).toBe(0);
  });

  it('requires authentication', async () => {
    expect((await request(buildApp()).delete('/recent-properties')).status).toBe(401);
  });
});

describe('the 90-day retention sweep', () => {
  it('deletes views older than the window and keeps the rest, across ALL users', async () => {
    // The table's only bound. It runs from cron via `cleanupOldData`, which is
    // what this calls — a test of the repository alone would still pass with the
    // service wired to the Mongoose model that no longer receives rows.
    await request(buildApp('oxy-a')).post(`/recent-properties/${listingA}`);
    await backdateView('oxy-a', listingA, 91);
    await request(buildApp('oxy-b')).post(`/recent-properties/${listingB}`);
    await backdateView('oxy-b', listingB, 120);

    // Inside the window, and belonging to a THIRD person, so a sweep that
    // deleted everything or scoped itself to one owner both fail.
    await request(buildApp('oxy-c')).post(`/recent-properties/${listingC}`);

    const result = await new CleanupService().cleanupOldData();
    expect(result.errors).toBe(0);
    expect(result.deleted).toBe(2);

    expect(await viewsOf('oxy-a')).toHaveLength(0);
    expect(await viewsOf('oxy-b')).toHaveLength(0);
    expect(await viewsOf('oxy-c')).toHaveLength(1);
  });

  it('keeps a view that is inside the window by a day', async () => {
    // The boundary, so an off-by-one in the cutoff arithmetic is visible rather
    // than being absorbed by a fixture that is months old.
    await request(buildApp('oxy-a')).post(`/recent-properties/${listingA}`);
    await backdateView('oxy-a', listingA, 89);

    await new CleanupService().cleanupOldData();
    expect(await viewsOf('oxy-a')).toHaveLength(1);
  });
});
