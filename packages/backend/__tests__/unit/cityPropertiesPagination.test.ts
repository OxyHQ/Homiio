/**
 * `GET /api/cities/:id/properties` pagination contract.
 *
 * Covers the flat `hasMore` / `totalPages` aliases the infinite city hook reads
 * (added for parity with `/properties/search`) and the server-side `minBathrooms`
 * filter, so the city grid can paginate + filter without breaking under offset
 * pagination.
 *
 * Seeded in POSTGRES: the city feed reads the city, its addresses and its
 * listings there, in ONE join. The `Address.find({cityId}).select('_id')` step
 * this endpoint used to run before it could count anything is gone, which is
 * also why the last test below no longer describes "no matching addresses" as a
 * distinct branch — an empty page is now the ordinary result of a join that
 * matched nothing, not an early return the handler took on its own.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { OfferingType, PropertyType, PropertyStatus } from '@homiio/shared-types';

import publicRoutes from '../../routes/public';
import { errorHandler } from '../../middlewares/errorHandler';
import {
  resetGeoTables,
  seedAddress,
  seedGeoChain,
  seedProperty,
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

/**
 * A city in its own country.
 *
 * The country CODE is unique per city rather than a shared `'ES'`:
 * `countries_code_key` is a real unique index here, and three tests in one file
 * would collide on it.
 */
async function seedSpainCity(name: string): Promise<GeoChain> {
  return seedGeoChain({ cityName: name, countryCode: `ES-${name}` });
}

/** Seed one published external listing resolvable to the given city. */
async function seedCityListing(chain: GeoChain, index: number, bathrooms: number): Promise<void> {
  const addressId = await seedAddress({
    chain,
    street: `Carrer Test ${index}`,
    postalCode: '08001',
    longitude: 2.17 + index * 0.001,
    latitude: 41.38,
  });
  await seedProperty({
    addressId,
    overrides: {
      type: PropertyType.APARTMENT,
      bedrooms: 2,
      bathrooms,
      offerings: [OfferingType.LONG_TERM_RENT],
      longTermRentMonthlyAmount: 900 + index,
      longTermRentCurrency: 'EUR',
      status: PropertyStatus.PUBLISHED,
      isExternal: true,
      source: 'fixture',
      sourceId: `city-pagination-${index}`,
      sourceUrl: `https://fixtures.homiio.com/city-${index}`,
    },
  });
}

describe('GET /api/cities/:id/properties pagination aliases', () => {
  beforeEach(async () => {
    await resetGeoTables();
  });

  it('returns flat hasMore/totalPages and paginates by page', async () => {
    const app = buildApp();
    const chain = await seedSpainCity('Barcelona');
    // 5 listings, 2 per page → 3 pages.
    for (let i = 0; i < 5; i += 1) {
      await seedCityListing(chain, i, 1);
    }

    const page1 = await request(app)
      .get(`/api/cities/${chain.cityId}/properties`)
      .query({ limit: 2, page: 1 });

    expect(page1.status).toBe(200);
    expect(page1.body.success).toBe(true);
    expect(page1.body.data.properties).toHaveLength(2);
    expect(page1.body.data.total).toBeUndefined(); // total stays nested in pagination
    expect(page1.body.data.pagination.total).toBe(5);
    expect(page1.body.data.totalPages).toBe(3);
    expect(page1.body.data.hasMore).toBe(true);

    const page3 = await request(app)
      .get(`/api/cities/${chain.cityId}/properties`)
      .query({ limit: 2, page: 3 });

    expect(page3.body.data.properties).toHaveLength(1);
    expect(page3.body.data.totalPages).toBe(3);
    // Last page: (3-1)*2 + 1 === 5, so nothing more to load.
    expect(page3.body.data.hasMore).toBe(false);
  });

  it('applies the server-side minBathrooms filter', async () => {
    const app = buildApp();
    const chain = await seedSpainCity('Girona');
    await seedCityListing(chain, 0, 1);
    await seedCityListing(chain, 1, 2);
    await seedCityListing(chain, 2, 3);

    const res = await request(app)
      .get(`/api/cities/${chain.cityId}/properties`)
      .query({ minBathrooms: 2 });

    expect(res.status).toBe(200);
    // Two of three — a filter that did nothing would report 3, and one that
    // matched nothing would report 0.
    expect(res.body.data.pagination.total).toBe(2);
    expect(res.body.data.hasMore).toBe(false);
    for (const property of res.body.data.properties) {
      expect(property.bathrooms).toBeGreaterThanOrEqual(2);
    }
  });

  it('returns hasMore=false for a city with no listings', async () => {
    const app = buildApp();
    const chain = await seedSpainCity('Sitges');

    const res = await request(app).get(`/api/cities/${chain.cityId}/properties`);

    expect(res.status).toBe(200);
    expect(res.body.data.properties).toHaveLength(0);
    expect(res.body.data.hasMore).toBe(false);
    expect(res.body.data.totalPages).toBe(0);
  });
});
