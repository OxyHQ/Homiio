/**
 * The ported `/api/cities*` endpoints, over real Postgres and the real router.
 *
 * Two things are asserted together on purpose: that the query answers correctly,
 * and that the RESPONSE SHAPE did not drift. The `_id` → `id` cut landed, so
 * every city body here carries `id` and NO `_id` — asserted in both directions,
 * since only the negative half can catch the old spelling being reintroduced.
 * It still nests its country / region / cover image as objects with their own
 * ids, and still reports the centre as `coordinates: { lat, lng }` even though
 * the table holds named scalar columns. A port that answers correctly and
 * reshapes the body is a broken frontend.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';

import publicRoutes from '../../routes/public';
import { errorHandler } from '../../middlewares/errorHandler';
import { getDb } from '../../db/postgres';
import { cities, images } from '../../db/schema';
import {
  resetGeoTables,
  seedCityImage,
  seedGeoChain,
  type GeoChain,
} from '../helpers/postgresGeoFixtures';

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  // The router production actually serves these paths on: `publicRoutes()` is
  // mounted at `/api` in server.ts, so `/cities/:id` here is the real wiring,
  // route-declaration order included.
  app.use('/api', publicRoutes());
  app.use(errorHandler);
  return app;
}

const app = buildApp();

/** Add another city to an existing chain (the chain seeds one already). */
async function addCity(chain: GeoChain, name: string, propertiesCount = 0): Promise<string> {
  const [row] = await getDb()
    .insert(cities)
    .values({ countryId: chain.countryId, regionId: chain.regionId, name, propertiesCount })
    .returning({ id: cities.id });
  return row.id;
}

beforeEach(async () => {
  await resetGeoTables();
});


describe('GET /api/cities', () => {
  it('returns active cities ordered by popularity then name, with paging metadata', async () => {
    const chain = await seedGeoChain({ cityName: 'Barcelona', propertiesCount: 5 });
    await addCity(chain, 'Girona', 9);
    await addCity(chain, 'Lleida', 5);

    const res = await request(app).get('/api/cities?limit=10').expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.map((c: { name: string }) => c.name)).toEqual(['Girona', 'Barcelona', 'Lleida']);
    // `count(*)` comes back from postgres.js as a bigint STRING; an unmapped one
    // would ship `"3"` and silently change the wire type.
    expect(res.body.pagination.total).toBe(3);
    expect(typeof res.body.pagination.total).toBe('number');
    expect(res.body.pagination.pages).toBe(1);
  });

  it('emits `id` and never `_id`, on the city and on its expanded refs', async () => {
    const chain = await seedGeoChain({ cityName: 'Barcelona' });

    const res = await request(app).get('/api/cities').expect(200);
    const [city] = res.body.data;

    expect(city.id).toBe(chain.cityId);
    expect(city.countryId).toEqual(
      expect.objectContaining({ id: chain.countryId, name: 'Spain', code: 'ES' }),
    );
    expect(city.regionId).toEqual(
      expect.objectContaining({ id: chain.regionId, name: 'Catalonia' }),
    );
    // The negative half. `objectContaining` above passes just as happily with an
    // `_id` sitting beside the `id`, so without these the old dual-spelling
    // shape would still satisfy every assertion in this test.
    expect(city).not.toHaveProperty('_id');
    expect(city.countryId).not.toHaveProperty('_id');
    expect(city.regionId).not.toHaveProperty('_id');
  });

  it('reports the city centre as coordinates { lat, lng }', async () => {
    await seedGeoChain({ cityName: 'Barcelona', latitude: 41.3851, longitude: 2.1734 });

    const res = await request(app).get('/api/cities').expect(200);

    expect(res.body.data[0].coordinates).toEqual({ lat: 41.3851, lng: 2.1734 });
  });

  it('omits an unset optional field rather than emitting null', async () => {
    await seedGeoChain({ cityName: 'Barcelona' });

    const res = await request(app).get('/api/cities').expect(200);

    // Mongoose omitted an unset path entirely; `res.json` would ship an explicit
    // `null`, which a `??` on the frontend treats differently from absence.
    expect(res.body.data[0]).not.toHaveProperty('timezone');
    expect(res.body.data[0]).not.toHaveProperty('coordinates');
  });

  it('no longer emits imageIds — the denormalized copy of the images relation', async () => {
    await seedGeoChain({ cityName: 'Barcelona' });
    const res = await request(app).get('/api/cities').expect(200);
    expect(res.body.data[0]).not.toHaveProperty('imageIds');
  });

  it('filters by an unanchored, case-insensitive search term', async () => {
    const chain = await seedGeoChain({ cityName: 'Barcelona' });
    await addCity(chain, 'Girona');

    const res = await request(app).get('/api/cities?search=rcelo').expect(200);
    expect(res.body.data.map((c: { name: string }) => c.name)).toEqual(['Barcelona']);
  });

  it('treats a typed % as a literal, not a wildcard', async () => {
    const chain = await seedGeoChain({ cityName: 'Barcelona' });
    await addCity(chain, 'Girona');

    const res = await request(app).get('/api/cities?search=%25').expect(200);
    expect(res.body.data).toEqual([]);
  });

  it('filters by countryCode, and reports an empty page for an unknown one', async () => {
    await seedGeoChain({ cityName: 'Barcelona', countryCode: 'ES' });

    expect((await request(app).get('/api/cities?countryCode=es').expect(200)).body.data).toHaveLength(1);
    const unknown = await request(app).get('/api/cities?countryCode=ZZ').expect(200);
    expect(unknown.body.data).toEqual([]);
    expect(unknown.body.pagination.total).toBe(0);
  });
});

describe('GET /api/cities/popular', () => {
  it('returns only cities with a resolvable cover and a plausible name', async () => {
    const chain = await seedGeoChain({ cityName: 'Madrid', propertiesCount: 3 });
    const coverId = await seedCityImage(chain.cityId);
    await getDb().update(cities).set({ coverImageId: coverId }).where(eq(cities.id, chain.cityId));

    // "Penn Street" is a street the ingest mistook for a city; it must never
    // reach the popular carousel however many listings it has.
    const streetId = await addCity(chain, 'Penn Street', 99);
    const streetCover = await seedCityImage(streetId);
    await getDb().update(cities).set({ coverImageId: streetCover }).where(eq(cities.id, streetId));

    // A city with no cover at all.
    await addCity(chain, 'Girona', 50);

    const res = await request(app).get('/api/cities/popular?limit=10').expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Madrid');
    expect(res.body.data[0].coverImageId.urls.medium).toContain('medium.webp');
    expect(res.body.data[0].coverImageId.id).toBe(coverId);
    expect(res.body.data[0].coverImageId).not.toHaveProperty('_id');
  });

  it('excludes a city whose cover image has been deleted', async () => {
    const chain = await seedGeoChain({ cityName: 'Barcelona', propertiesCount: 3 });
    const coverId = await seedCityImage(chain.cityId);
    await getDb().update(cities).set({ coverImageId: coverId }).where(eq(cities.id, chain.cityId));
    expect((await request(app).get('/api/cities/popular').expect(200)).body.data).toHaveLength(1);

    // Mongo held 17 cities whose `coverImageId` named an image that no longer
    // existed (measured 2026-08-06); the real foreign key makes that state
    // unrepresentable here — `ON DELETE SET NULL` turns it into a NULL, and the
    // backfill applies the same rule to those 17. What this pins is that the
    // endpoint drops the city either way rather than emitting a cover the
    // frontend cannot render.
    await getDb().delete(images).where(eq(images.id, coverId));

    const res = await request(app).get('/api/cities/popular?limit=10').expect(200);
    expect(res.body.data).toEqual([]);
  });
});

describe('GET /api/cities/:id', () => {
  it('returns the city with its refs expanded', async () => {
    const chain = await seedGeoChain({ cityName: 'Barcelona' });

    const res = await request(app).get(`/api/cities/${chain.cityId}`).expect(200);

    expect(res.body.data.name).toBe('Barcelona');
    expect(res.body.data.countryId.name).toBe('Spain');
  });

  it('404s for an unknown id, whatever shape it is', async () => {
    await request(app).get('/api/cities/not-an-id-at-all').expect(404);
    await request(app).get(`/api/cities/${'0'.repeat(24)}`).expect(404);
  });
});

describe('GET /api/cities/lookup', () => {
  it('matches the city name case-insensitively', async () => {
    await seedGeoChain({ cityName: 'Barcelona' });

    const res = await request(app).get('/api/cities/lookup?name=BARCELONA').expect(200);
    expect(res.body.data.name).toBe('Barcelona');
  });

  it('narrows by country and region NAME', async () => {
    const es = await seedGeoChain({ countryCode: 'ES', countryName: 'Spain', regionName: 'Catalonia', cityName: 'Valencia' });
    await seedGeoChain({ countryCode: 'VE', countryName: 'Venezuela', regionName: 'Valencia', cityName: 'Valencia' });

    const res = await request(app).get('/api/cities/lookup?name=Valencia&country=Spain&state=catalonia').expect(200);
    expect(res.body.data.id).toBe(es.cityId);
  });

  it('404s when the narrowing country or region is unknown', async () => {
    await seedGeoChain({ cityName: 'Barcelona' });
    await request(app).get('/api/cities/lookup?name=Barcelona&country=Atlantis').expect(404);
    await request(app).get('/api/cities/lookup?name=Barcelona&state=Atlantis').expect(404);
  });

  it('400s without a name', async () => {
    await request(app).get('/api/cities/lookup').expect(400);
  });
});

describe('GET /api/cities/search', () => {
  it('matches a substring and orders by popularity', async () => {
    const chain = await seedGeoChain({ cityName: 'Barcelona', propertiesCount: 1 });
    await addCity(chain, 'Barcelos', 7);
    await addCity(chain, 'Girona', 99);

    const res = await request(app).get('/api/cities/search?q=barcel').expect(200);
    expect(res.body.data.map((c: { name: string }) => c.name)).toEqual(['Barcelos', 'Barcelona']);
  });

  it('400s without a query', async () => {
    await request(app).get('/api/cities/search').expect(400);
  });
});
