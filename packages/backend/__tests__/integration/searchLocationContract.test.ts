/**
 * The search endpoint's location contract, against a REAL Postgres.
 *
 * Every assertion here is on the RESPONSE ENVELOPE — the status code and the
 * `location` echo — and none is on the result set alone. That is the whole
 * point of the file rather than a stylistic preference: in almost every failure
 * this contract exists to prevent, results still come back, just the wrong ones
 * or none, so "an empty list arrived" cannot distinguish a city nobody lives in
 * from a city the server could not find from a request that never applied the
 * filter at all. ADR 0002 §16 states it; these are the cases.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { OfferingType, PropertyStatus, PropertyType } from '@homiio/shared-types';

import { searchProperties } from '../../controllers/property/search';
import { errorHandler } from '../../middlewares/errorHandler';
import { serializeWireIds } from '../../middlewares/wireIds';
import { eq } from 'drizzle-orm';

import { getDb } from '../../db/postgres';
import { addresses, properties } from '../../db/schema';
import {
  resetGeoTables,
  seedAddress,
  seedGeoChain,
  seedNeighborhood,
  seedProperty,
  type GeoChain,
} from '../helpers/postgresGeoFixtures';

const BARCELONA = { longitude: 2.1686, latitude: 41.3874 };

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(serializeWireIds);
  app.get('/properties/search', searchProperties);
  app.use(errorHandler);
  return app;
}

async function seedBarcelonaListing(): Promise<{
  cityId: string;
  propertyId: string;
  chain: GeoChain;
}> {
  const chain = await seedGeoChain({
    cityName: 'Barcelona',
    regionName: 'Catalonia',
    countryCode: 'ES-LOC',
  });
  const addressId = await seedAddress({ chain, street: 'Carrer Gran', ...BARCELONA });
  const propertyId = await seedProperty({
    addressId,
    overrides: {
      status: PropertyStatus.PUBLISHED,
      type: PropertyType.APARTMENT,
      availabilityIsAvailable: true,
      offerings: [OfferingType.LONG_TERM_RENT],
      longTermRentMonthlyAmount: 1200,
      longTermRentCurrency: 'EUR',
    },
  });
  return { cityId: chain.cityId, propertyId, chain };
}

/** Point an existing listing's address at a neighborhood. */
async function attachNeighborhood(propertyId: string, neighborhoodId: string): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select({ addressId: properties.addressId })
    .from(properties)
    .where(eq(properties.id, propertyId))
    .limit(1);
  await db
    .update(addresses)
    .set({ neighborhoodId })
    .where(eq(addresses.id, row.addressId));
}

describe('search location contract', () => {
  beforeEach(async () => {
    await resetGeoTables();
  });

  describe('incompatible geographic combinations are refused, not silently resolved', () => {
    it('rejects a bounding box AND a centre+radius with a typed 400', async () => {
      const res = await request(buildApp()).get(
        '/properties/search?swLat=41.3&swLng=2.0&neLat=41.5&neLng=2.3&lat=40.4&lng=-3.7&radius=25000',
      );

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_LOCATION');
      // The old behaviour was a 200 in which the box quietly won. A test
      // asserting only "not 200" would pass against a 500 too.
      expect(res.body.success).toBe(false);
    });

    it.each([
      ['a box missing a corner', 'swLat=41.3&swLng=2.0&neLat=41.5'],
      ['an out-of-range latitude', 'swLat=-91&swLng=2.0&neLat=41.5&neLng=2.3'],
      ['an out-of-range longitude', 'swLat=41.3&swLng=181&neLat=41.5&neLng=2.3'],
      ['an inverted latitude order', 'swLat=41.5&swLng=2.0&neLat=41.3&neLng=2.3'],
      ['a centre missing its longitude', 'lat=41.38'],
      ['an out-of-range centre', 'lat=91&lng=2.17'],
    ])('rejects %s with INVALID_LOCATION', async (_label, qs) => {
      const res = await request(buildApp()).get(`/properties/search?${qs}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_LOCATION');
    });
  });

  describe('the response says which location it applied', () => {
    it('marks a place that could not be resolved as unresolved, and still filters', async () => {
      await seedBarcelonaListing();

      const res = await request(buildApp()).get(
        '/properties/search?city=ThisCityDoesNotExistAnywhere',
      );

      expect(res.status).toBe(200);
      // The list is empty AND says why. Without the echo these two answers are
      // the same bytes, which is the bug: a client renders "no homes here" over
      // a place it never found.
      expect(res.body.data).toHaveLength(0);
      expect(res.body.location).toEqual({
        status: 'unresolved',
        requested: { param: 'city', value: 'ThisCityDoesNotExistAnywhere' },
      });
    });

    it('never widens an unresolvable place into a global feed', async () => {
      // The listing exists and would be returned by an unfiltered query, so a
      // fallback-to-everything implementation returns 1 here and this fails.
      const { propertyId } = await seedBarcelonaListing();

      const unfiltered = await request(buildApp()).get('/properties/search');
      expect(unfiltered.body.data.map((p: { id: string }) => p.id)).toContain(propertyId);

      const res = await request(buildApp()).get('/properties/search?city=NoSuchPlaceAtAll');
      expect(res.body.data).toHaveLength(0);
    });

    it('echoes the canonical city id a resolved place narrowed to', async () => {
      const { cityId, propertyId } = await seedBarcelonaListing();

      const res = await request(buildApp()).get(`/properties/search?city=${cityId}`);

      expect(res.status).toBe(200);
      expect(res.body.data.map((p: { id: string }) => p.id)).toEqual([propertyId]);
      expect(res.body.location).toEqual({ status: 'resolved', cityId });
    });

    it('echoes the bounding box a box search actually ran under', async () => {
      const { propertyId } = await seedBarcelonaListing();

      const res = await request(buildApp()).get(
        '/properties/search?swLat=41.32&swLng=2.05&neLat=41.47&neLng=2.23',
      );

      expect(res.status).toBe(200);
      expect(res.body.data.map((p: { id: string }) => p.id)).toEqual([propertyId]);
      expect(res.body.location).toEqual({
        status: 'resolved',
        bounds: { west: 2.05, south: 41.32, east: 2.23, north: 41.47 },
      });
    });

    it('echoes the centre and the radius IN METRES for a radius search', async () => {
      // The unit is the point. `radius` is metres here and was being sent as
      // kilometres by the "Near you" lens, which is a 1000× error that returns
      // plausible results rather than an obvious failure.
      const { propertyId } = await seedBarcelonaListing();

      const res = await request(buildApp()).get(
        `/properties/search?lat=${BARCELONA.latitude}&lng=${BARCELONA.longitude}&radius=25000`,
      );

      expect(res.status).toBe(200);
      expect(res.body.data.map((p: { id: string }) => p.id)).toEqual([propertyId]);
      expect(res.body.location).toEqual({
        status: 'resolved',
        center: { longitude: BARCELONA.longitude, latitude: BARCELONA.latitude },
        radiusMeters: 25000,
      });
    });

    it('scopes by a canonical NEIGHBORHOOD id and echoes it', async () => {
      // ADR 0002 §14.2 gives the endpoint `neighborhoodId`, and without it a
      // `neighborhood` place had no id param to scope by: it fell through to
      // its geometry, and a neighborhood whose record carries an extent but no
      // centre had nothing at all — a query answered globally under the
      // neighborhood's name.
      const { chain, propertyId } = await seedBarcelonaListing();
      const neighborhoodId = await seedNeighborhood({ cityId: chain.cityId, name: 'Gracia' });
      await attachNeighborhood(propertyId, neighborhoodId);

      const res = await request(buildApp()).get(
        `/properties/search?neighborhood=${neighborhoodId}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.data.map((p: { id: string }) => p.id)).toEqual([propertyId]);
      expect(res.body.location).toEqual({ status: 'resolved', neighborhoodId });
    });

    it('marks an unresolvable neighborhood as unresolved rather than ignoring it', async () => {
      // The floor for the case above: an unknown neighborhood must not silently
      // drop the filter and answer with everything.
      const { propertyId } = await seedBarcelonaListing();

      const unfiltered = await request(buildApp()).get('/properties/search');
      expect(unfiltered.body.data.map((p: { id: string }) => p.id)).toContain(propertyId);

      const res = await request(buildApp()).get('/properties/search?neighborhood=NoSuchBarrio');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
      expect(res.body.location).toEqual({
        status: 'unresolved',
        requested: { param: 'neighborhood', value: 'NoSuchBarrio' },
      });
    });

    it('reports `none` when no location was requested, which is a legitimate query', async () => {
      const { propertyId } = await seedBarcelonaListing();

      const res = await request(buildApp()).get('/properties/search');

      expect(res.status).toBe(200);
      // A global feed is fine when nobody asked for a place. What the contract
      // forbids is a location requested and lost — and `none` is precisely how
      // a heading can honestly say "everywhere" instead of naming a place the
      // query never used.
      expect(res.body.data.map((p: { id: string }) => p.id)).toEqual([propertyId]);
      expect(res.body.location).toEqual({ status: 'none' });
    });

    it('distinguishes `none` from `unresolved` — the two empty-looking answers', async () => {
      // No fixture at all, so BOTH requests return an empty list. Only the echo
      // separates them, which is the property under test.
      const noLocation = await request(buildApp()).get('/properties/search');
      const lostLocation = await request(buildApp()).get('/properties/search?city=Nowhereville');

      expect(noLocation.body.data).toHaveLength(0);
      expect(lostLocation.body.data).toHaveLength(0);
      expect(noLocation.body.location.status).toBe('none');
      expect(lostLocation.body.location.status).toBe('unresolved');
    });
  });
});
