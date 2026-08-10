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

    /**
     * A SHAPE and a NAMED PLACE are two authoritative scopes, and ANDing them
     * is the Barcelona/Madrid defect arriving over the wire instead of out of
     * the store.
     *
     * "Inside Barcelona AND inside this Madrid rectangle" is empty, and empty
     * is the plausible-looking answer that renders as "this area has no homes".
     * No `LocationSelection` can produce both, so a request carrying both was
     * assembled by merging two selections — a client bug every time, and the
     * loud failure is the one that gets it fixed.
     */
    it.each([
      ['a box and a city', 'swLat=41.3&swLng=2.0&neLat=41.5&neLng=2.3&city=barcelona'],
      ['a box and a region', 'swLat=41.3&swLng=2.0&neLat=41.5&neLng=2.3&state=catalonia'],
      ['a box and a neighborhood', 'swLat=41.3&swLng=2.0&neLat=41.5&neLng=2.3&neighborhood=gracia'],
      ['a radius and a city', 'lat=41.38&lng=2.17&radius=25000&city=barcelona'],
    ])('rejects %s with INVALID_LOCATION', async (_label, qs) => {
      const res = await request(buildApp()).get(`/properties/search?${qs}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_LOCATION');
      // The message names BOTH scopes, because the caller has to know which
      // two it sent — "invalid location" alone sends people to the wrong half.
      expect(res.body.message).toMatch(/bounding box|centre and radius/);
      expect(res.body.message).toMatch(/city|state|neighborhood/);
    });

    it('still accepts place ids that NEST rather than compete', async () => {
      // The negative control for the rule above, and it is not a formality:
      // `resolveNeighborhoodId` deliberately uses the city to disambiguate a
      // name, so a rule that refused every pair of geographic params would
      // break the one combination the endpoint is built around.
      const { chain, propertyId } = await seedBarcelonaListing();
      const neighborhoodId = await seedNeighborhood({ cityId: chain.cityId, name: 'Gracia' });
      await attachNeighborhood(propertyId, neighborhoodId);

      const res = await request(buildApp()).get(
        `/properties/search?city=${chain.cityId}&neighborhood=${neighborhoodId}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.data.map((p: { id: string }) => p.id)).toEqual([propertyId]);
      // The NARROWEST applied scope is what the echo names — it is the one
      // that decided the result set.
      expect(res.body.location).toMatchObject({
        status: 'resolved',
        appliedLocationKind: 'neighborhood',
        cityId: chain.cityId,
        neighborhoodId,
      });
    });
  });

  describe('`q` is free text, and a place name only when nothing else says where', () => {
    /**
     * The discriminating pair, and it needs both halves to mean anything.
     *
     * The listing sits in Barcelona and its own text says nothing about
     * Barcelona — no title, no description, street "Carrer Gran". So the word
     * can only match it through the PLACE expansion, which is exactly the
     * behaviour under test.
     */
    it('does NOT expand `q` into a place when a box already scoped the query', async () => {
      await seedBarcelonaListing();

      const res = await request(buildApp()).get(
        '/properties/search?swLat=41.32&swLng=2.05&neLat=41.47&neLng=2.23&q=Barcelona',
      );

      expect(res.status).toBe(200);
      // Before the fix this returned the listing, because the query was
      // `inside the box AND (text ~ Barcelona OR city = Barcelona)` and the
      // city branch matched. A person who has already said WHERE by moving the
      // map is describing the home when they type, not the city (ADR 0002
      // §4.1) — and the same request with a Madrid box would have returned
      // nothing while looking identical.
      expect(res.body.data).toHaveLength(0);
      expect(res.body.location).toMatchObject({ appliedLocationKind: 'bbox' });
    });

    it('DOES expand `q` into a place when nothing else says where', async () => {
      // The other half. Without it, the assertion above would also pass
      // against an endpoint that had simply stopped reading `q` at all.
      const { propertyId } = await seedBarcelonaListing();

      const res = await request(buildApp()).get('/properties/search?q=Barcelona');

      expect(res.status).toBe(200);
      expect(res.body.data.map((p: { id: string }) => p.id)).toEqual([propertyId]);
      expect(res.body.location).toMatchObject({ appliedLocationKind: 'none' });
    });

    it('does NOT expand `q` into a place when a city id already scoped the query', async () => {
      const { cityId } = await seedBarcelonaListing();

      const res = await request(buildApp()).get(
        `/properties/search?city=${cityId}&q=Barcelona`,
      );

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });

    it('still matches free text against the listing itself inside a scope', async () => {
      // The floor under the three cases above: `q` is not ignored when a scope
      // is present, it is READ AS TEXT. A listing whose own description
      // carries the word still matches inside the box.
      const chain = await seedGeoChain({
        cityName: 'Barcelona',
        regionName: 'Catalonia',
        countryCode: 'ES-TXT',
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
          description: 'Sunny loft with a terrace',
        },
      });

      const res = await request(buildApp()).get(
        '/properties/search?swLat=41.32&swLng=2.05&neLat=41.47&neLng=2.23&q=terrace',
      );

      expect(res.body.data.map((p: { id: string }) => p.id)).toEqual([propertyId]);
    });
  });

  describe('the response is stamped with the identity it was asked under', () => {
    const QUERY_ID = 'a1b2c3d4e5f60718';

    it('echoes a well-formed query id verbatim', async () => {
      await seedBarcelonaListing();

      const res = await request(buildApp()).get(`/properties/search?queryId=${QUERY_ID}`);

      expect(res.status).toBe(200);
      expect(res.body.queryId).toBe(QUERY_ID);
    });

    it('echoes it on the unresolvable-place path too', async () => {
      // The path that answers with an empty page. A client comparing ids would
      // otherwise refuse the one answer it most needs to render — "we could
      // not find that place" — as belonging to another query.
      const res = await request(buildApp()).get(
        `/properties/search?city=NoSuchPlaceAtAll&queryId=${QUERY_ID}`,
      );

      expect(res.body.queryId).toBe(QUERY_ID);
      expect(res.body.location.status).toBe('unresolved');
    });

    it.each([
      ['a value that is not an opaque id', 'not-an-id'],
      ['an id of the wrong length', 'a1b2c3'],
      ['uppercase hex, which is a second spelling of one id', 'A1B2C3D4E5F60718'],
      ['a value carrying markup', '<script>alert(1)</script>'],
    ])('drops %s rather than reflecting it', async (_label, value) => {
      // An echo writes caller-supplied bytes into a JSON body. Validating it
      // against the ONE shape the observability contract defines is what keeps
      // that from becoming a payload — and the uppercase case matters for a
      // second reason: two spellings of one id are two cache entries.
      const res = await request(buildApp()).get(
        `/properties/search?queryId=${encodeURIComponent(value)}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.queryId).toBeUndefined();
    });

    it('says nothing when the caller sent no id', async () => {
      // Absent, not null: a client has to tell "this server does not stamp
      // answers" from "this answer belongs to another query", and treating the
      // two alike would black out its results against an older deployment.
      const res = await request(buildApp()).get('/properties/search');
      expect(res.body).not.toHaveProperty('queryId');
    });
  });

  describe('the count answers the same question as the page', () => {
    it('counts only what the scope matched, however small the page', async () => {
      // A count assembled from a different `where` than the list is the defect
      // this pins, and it does not look like one: "3 homes" over a single card
      // reads as pagination. The fixture makes the two answers differ — one
      // listing inside the box, two outside — so a count that dropped the geo
      // predicate reports 3 and a count that shares the `where` reports 1.
      const { propertyId } = await seedBarcelonaListing();
      const madrid = await seedGeoChain({
        cityName: 'Madrid',
        regionName: 'Madrid',
        countryCode: 'ES-CNT',
      });
      for (const street of ['Gran Via', 'Calle Mayor']) {
        const addressId = await seedAddress({
          chain: madrid,
          street,
          longitude: -3.7038,
          latitude: 40.4168,
        });
        await seedProperty({
          addressId,
          overrides: {
            status: PropertyStatus.PUBLISHED,
            type: PropertyType.APARTMENT,
            availabilityIsAvailable: true,
            offerings: [OfferingType.LONG_TERM_RENT],
            longTermRentMonthlyAmount: 1400,
            longTermRentCurrency: 'EUR',
          },
        });
      }

      const unfiltered = await request(buildApp()).get('/properties/search');
      expect(unfiltered.body.total).toBe(3);

      const res = await request(buildApp()).get(
        '/properties/search?swLat=41.32&swLng=2.05&neLat=41.47&neLng=2.23&limit=1',
      );

      expect(res.body.data.map((p: { id: string }) => p.id)).toEqual([propertyId]);
      expect(res.body.total).toBe(1);
      expect(res.body.hasMore).toBe(false);
      expect(res.body.totalPages).toBe(1);
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
        appliedLocationKind: 'none',
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
      expect(res.body.location).toEqual({
        status: 'resolved',
        appliedLocationKind: 'city',
        cityId,
      });
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
        appliedLocationKind: 'bbox',
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
        appliedLocationKind: 'radius',
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
      expect(res.body.location).toEqual({
        status: 'resolved',
        appliedLocationKind: 'neighborhood',
        neighborhoodId,
      });
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
        appliedLocationKind: 'none',
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
      expect(res.body.location).toEqual({ status: 'none', appliedLocationKind: 'none' });
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
