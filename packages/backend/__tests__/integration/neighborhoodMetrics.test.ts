/**
 * Neighborhood metrics endpoints (public reads).
 *
 * Mounts the real neighborhood router and asserts that every metric is DERIVED
 * FROM SEEDED LISTINGS — listing count, average rent and the
 * neighborhood-vs-city contrast — with NO invented walkability/score fields.
 * Also covers the "no neighborhood → 404 / hidden" and unknown-city → empty
 * paths, plus popular-by-listing-count ranking and nearest-by-location lookup.
 *
 * ## The fixtures straddle both stores, because the controller does
 *
 * Geo and addresses are Postgres; `properties` lands in batch 3, so the listings
 * are still Mongo documents whose `addressId` names a Postgres address row. That
 * is not a testing convenience — it is exactly the state the branch is in, and
 * it works for the same reason the cutover works: ids are preserved verbatim, so
 * an address id is the SAME string in both stores. `seedAddress` mints 24-char
 * ObjectId hex for that reason (a uuid v7 cannot live in a Mongoose `ObjectId`
 * path), which is also what every backfilled row will carry.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { OfferingType, PropertyType, PropertyStatus } from '@homiio/shared-types';

import neighborhoodRoutes from '../../routes/neighborhoods';
import { models } from '../helpers/factories';
import { errorHandler } from '../../middlewares/errorHandler';
import {
  resetGeoTables,
  seedAddress,
  seedGeoChain,
  seedNeighborhood,
  seedProperty,
  type GeoChain,
} from '../helpers/postgresGeoFixtures';

const { Profile } = models;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/neighborhoods', neighborhoodRoutes());
  app.use(errorHandler);
  return app;
}

let addressSeq = 0;
async function seedStreet(
  chain: GeoChain,
  neighborhoodId?: string,
  coordinates: [number, number] = [2.17, 41.39],
): Promise<string> {
  addressSeq += 1;
  return seedAddress({
    chain,
    neighborhoodId,
    street: `Carrer de Test ${addressSeq}`,
    longitude: coordinates[0],
    latitude: coordinates[1],
  });
}

async function seedProfile(): Promise<{ oxyUserId: string }> {
  const oxyUserId = `oxy-${Math.random().toString(36).slice(2)}`;
  return Profile.create({ oxyUserId, personalProfile: {} });
}

/**
 * A published listing at a given address.
 *
 * POSTGRES, because that is the store the metrics now read: this endpoint used
 * to hop through Mongo for the listing half, and a fixture seeded there would
 * make the test assert against rows the handler cannot see.
 */
async function seedListing(
  oxyUserId: string,
  addressId: string,
  monthlyAmount: number,
): Promise<string> {
  return seedProperty({
    addressId,
    idShape: 'generated',
    overrides: {
      oxyUserId,
      type: PropertyType.APARTMENT,
      bedrooms: 2,
      bathrooms: 1,
      offerings: [OfferingType.LONG_TERM_RENT],
      longTermRentMonthlyAmount: monthlyAmount,
      longTermRentCurrency: 'EUR',
      status: PropertyStatus.PUBLISHED,
      availabilityIsAvailable: true,
    },
  });
}

beforeEach(async () => {
  await resetGeoTables();
});


describe('GET /api/neighborhoods/by-property/:propertyId', () => {
  it('returns real, listing-derived metrics for the property neighborhood', async () => {
    const chain = await seedGeoChain({ cityName: 'Barcelona' });
    const gracia = await seedNeighborhood({ cityId: chain.cityId, name: 'Gracia' });
    const profile = await seedProfile();
    const addressId = await seedStreet(chain, gracia);
    const listingId = await seedListing(profile.oxyUserId, addressId, 1000);

    const res = await request(buildApp()).get(`/api/neighborhoods/by-property/${listingId}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      id: gracia,
      name: 'Gracia',
      city: 'Barcelona',
      cityId: chain.cityId,
      listingCount: 1,
      averageRent: 1000,
    });
    // No invented scores leak into the DTO.
    expect(res.body.data.overallScore).toBeUndefined();
    expect(res.body.data.ratings).toBeUndefined();
    expect(res.body.data.walkScore).toBeUndefined();
  });

  it('404s when the property has no resolved neighborhood', async () => {
    const chain = await seedGeoChain({ cityName: 'Barcelona' });
    const profile = await seedProfile();
    const addressId = await seedStreet(chain, undefined);
    const listingId = await seedListing(profile.oxyUserId, addressId, 1000);

    const res = await request(buildApp()).get(`/api/neighborhoods/by-property/${listingId}`);

    expect(res.status).toBe(404);
  });

  it('404s for a non-existent property', async () => {
    const res = await request(buildApp()).get(
      '/api/neighborhoods/by-property/507f1f77bcf86cd799439011',
    );
    expect(res.status).toBe(404);
  });
});

describe('GET /api/neighborhoods/by-name', () => {
  it('resolves by name and computes the neighborhood-vs-city rent contrast', async () => {
    const chain = await seedGeoChain({ cityName: 'Barcelona' });
    const gracia = await seedNeighborhood({ cityId: chain.cityId, name: 'Gracia' });
    const eixample = await seedNeighborhood({ cityId: chain.cityId, name: 'Eixample' });
    const profile = await seedProfile();

    // Gracia: one 800€ listing. Eixample: one 2000€ listing. City avg = 1400€.
    await seedListing(profile.oxyUserId, await seedStreet(chain, gracia), 800);
    await seedListing(profile.oxyUserId, await seedStreet(chain, eixample), 2000);

    const res = await request(buildApp())
      .get('/api/neighborhoods/by-name')
      .query({ name: 'gracia', city: 'Barcelona' });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Gracia');
    expect(res.body.data.averageRent).toBe(800);
    expect(res.body.data.vsCity).toMatchObject({
      cityAverageRent: 1400,
      // (800 - 1400) / 1400 * 100 ≈ -43
      percentDiff: -43,
    });
  });

  it('404s for an unknown neighborhood name', async () => {
    await seedGeoChain({ cityName: 'Barcelona' });
    const res = await request(buildApp())
      .get('/api/neighborhoods/by-name')
      .query({ name: 'Nowhere' });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/neighborhoods/popular', () => {
  it('ranks a city neighborhoods by real listing count', async () => {
    const chain = await seedGeoChain({ cityName: 'Barcelona' });
    const gracia = await seedNeighborhood({ cityId: chain.cityId, name: 'Gracia' });
    const eixample = await seedNeighborhood({ cityId: chain.cityId, name: 'Eixample' });
    const profile = await seedProfile();

    // Gracia: 2 listings, Eixample: 1 listing.
    await seedListing(profile.oxyUserId, await seedStreet(chain, gracia), 900);
    await seedListing(profile.oxyUserId, await seedStreet(chain, gracia), 1100);
    await seedListing(profile.oxyUserId, await seedStreet(chain, eixample), 2000);

    const res = await request(buildApp())
      .get('/api/neighborhoods/popular')
      .query({ city: 'Barcelona' });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].name).toBe('Gracia');
    expect(res.body.data[0].listingCount).toBe(2);
    // The average is over LISTINGS (900 + 1100) / 2, not over the two addresses'
    // own averages — which happen to agree here only because each address holds
    // one listing.
    expect(res.body.data[0].averageRent).toBe(1000);
    expect(res.body.data[1].name).toBe('Eixample');
    expect(res.body.data[1].listingCount).toBe(1);
  });

  it('averages over listings, not over addresses', async () => {
    const chain = await seedGeoChain({ cityName: 'Barcelona' });
    const gracia = await seedNeighborhood({ cityId: chain.cityId, name: 'Gracia' });
    const profile = await seedProfile();
    // Two listings at one address, one at another: an average of per-address
    // averages would give (1000 + 4000) / 2 = 2500 rather than the true 2000.
    const busy = await seedStreet(chain, gracia);
    await seedListing(profile.oxyUserId, busy, 500);
    await seedListing(profile.oxyUserId, busy, 1500);
    await seedListing(profile.oxyUserId, await seedStreet(chain, gracia), 4000);

    const res = await request(buildApp())
      .get('/api/neighborhoods/popular')
      .query({ city: 'Barcelona' });

    expect(res.body.data[0].listingCount).toBe(3);
    expect(res.body.data[0].averageRent).toBe(2000);
  });

  it('returns an empty list for an unknown city', async () => {
    const res = await request(buildApp())
      .get('/api/neighborhoods/popular')
      .query({ city: 'Atlantis' });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('400s when city is omitted', async () => {
    const res = await request(buildApp()).get('/api/neighborhoods/popular');
    expect(res.status).toBe(400);
  });
});

describe('GET /api/neighborhoods/search', () => {
  it('lists neighborhoods scoped to a city with metrics', async () => {
    const chain = await seedGeoChain({ cityName: 'Barcelona' });
    const gracia = await seedNeighborhood({ cityId: chain.cityId, name: 'Gracia' });
    await seedNeighborhood({ cityId: chain.cityId, name: 'Eixample' });
    const profile = await seedProfile();
    await seedListing(profile.oxyUserId, await seedStreet(chain, gracia), 1000);

    const res = await request(buildApp())
      .get('/api/neighborhoods/search')
      .query({ city: 'Barcelona' });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    const names = res.body.data.map((n: { name: string }) => n.name).sort();
    expect(names).toEqual(['Eixample', 'Gracia']);
  });

  it('filters by name query', async () => {
    const chain = await seedGeoChain({ cityName: 'Barcelona' });
    await seedNeighborhood({ cityId: chain.cityId, name: 'Gracia' });
    await seedNeighborhood({ cityId: chain.cityId, name: 'Eixample' });

    const res = await request(buildApp())
      .get('/api/neighborhoods/search')
      .query({ city: 'Barcelona', query: 'grac' });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Gracia');
  });

  it('treats a typed % in the name query as a literal', async () => {
    const chain = await seedGeoChain({ cityName: 'Barcelona' });
    await seedNeighborhood({ cityId: chain.cityId, name: 'Gracia' });

    const res = await request(buildApp())
      .get('/api/neighborhoods/search')
      .query({ city: 'Barcelona', query: '%' });

    expect(res.body.data).toEqual([]);
  });

  it('returns an empty list for an unknown city', async () => {
    const res = await request(buildApp())
      .get('/api/neighborhoods/search')
      .query({ city: 'Atlantis' });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

describe('GET /api/neighborhoods/by-location', () => {
  it('resolves the nearest neighborhood-bearing address', async () => {
    const chain = await seedGeoChain({ cityName: 'Barcelona' });
    const gracia = await seedNeighborhood({ cityId: chain.cityId, name: 'Gracia' });
    const eixample = await seedNeighborhood({ cityId: chain.cityId, name: 'Eixample' });
    const profile = await seedProfile();
    const near = await seedStreet(chain, gracia, [2.17, 41.39]);
    // ~1.6 km east: inside the 5 km radius, so it is only excluded by being
    // FARTHER — which is what makes this an ordering assertion rather than a
    // "something came back" one.
    await seedStreet(chain, eixample, [2.189, 41.39]);
    await seedListing(profile.oxyUserId, near, 1000);

    const res = await request(buildApp())
      .get('/api/neighborhoods/by-location')
      .query({ latitude: 41.39, longitude: 2.17 });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Gracia');
    expect(res.body.data.listingCount).toBe(1);
  });

  it('ignores an address with no neighborhood even when it is nearer', async () => {
    const chain = await seedGeoChain({ cityName: 'Barcelona' });
    const gracia = await seedNeighborhood({ cityId: chain.cityId, name: 'Gracia' });
    await seedStreet(chain, undefined, [2.17, 41.39]);
    await seedStreet(chain, gracia, [2.189, 41.39]);

    const res = await request(buildApp())
      .get('/api/neighborhoods/by-location')
      .query({ latitude: 41.39, longitude: 2.17 });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Gracia');
  });

  it('404s when no neighborhood is near the coordinate', async () => {
    const chain = await seedGeoChain({ cityName: 'Barcelona' });
    const gracia = await seedNeighborhood({ cityId: chain.cityId, name: 'Gracia' });
    await seedStreet(chain, gracia, [2.17, 41.39]);

    const res = await request(buildApp())
      .get('/api/neighborhoods/by-location')
      .query({ latitude: 0, longitude: 0 });
    expect(res.status).toBe(404);
  });

  it('400s on missing coordinates', async () => {
    const res = await request(buildApp()).get('/api/neighborhoods/by-location');
    expect(res.status).toBe(400);
  });
});
