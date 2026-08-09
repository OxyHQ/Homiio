/**
 * The catalogue read path, against a REAL Postgres.
 *
 * These are the assertions that would have caught the port going wrong, and
 * each is written so that it can FAIL — which is not automatic here:
 *
 *  - **Geo is asserted on ORDERING against an independently checkable
 *    real-world distance**, never on "a row came back". A latitude/longitude
 *    transposition yields a perfectly valid point in the wrong hemisphere and
 *    returns plausible rows, so a presence assertion passes against the exact
 *    bug the named coordinate columns exist to prevent. The anchor is Barcelona
 *    → Madrid: **~505 km** the right way round, **~658 km** transposed
 *    (`__tests__/db/postgis.test.ts` measures both against this database), so a
 *    500 km radius that includes Madrid but not Seville is a fixture the two
 *    orderings genuinely disagree about.
 *  - **Every read assertion is floored on real seeded rows.** A test that
 *    passes against an empty table proves nothing, and an empty table is the
 *    default state of a throwaway database — so each block asserts the count it
 *    expects, not merely that the request succeeded.
 *  - **The wire contract is `id`, never `_id`** (#287). The suite mounts the
 *    real `serializeWireIds` middleware, because that is where the rename
 *    happens in production and a suite that skipped it would assert a shape the
 *    API does not serve.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { OfferingType, PropertyStatus, PropertyType } from '@homiio/shared-types';

import { getProperties } from '../../controllers/property/list';
import { getPropertyById } from '../../controllers/property/retrieve';
import { searchProperties } from '../../controllers/property/search';
import { findPropertiesInRadius } from '../../controllers/property/geospatial';
import { errorHandler } from '../../middlewares/errorHandler';
import { serializeWireIds } from '../../middlewares/wireIds';
import {
  resetGeoTables,
  seedAddress,
  seedGeoChain,
  seedProperty,
  seedPropertyImage,
  type GeoChain,
} from '../helpers/postgresGeoFixtures';

/** Barcelona city centre. */
const BARCELONA = { longitude: 2.1686, latitude: 41.3874 };
/** Madrid, ~505 km from Barcelona on the spheroid. */
const MADRID = { longitude: -3.7038, latitude: 40.4168 };
/** Seville, ~830 km from Barcelona — outside every radius this suite uses. */
const SEVILLE = { longitude: -5.9845, latitude: 37.3891 };

/** The radius that separates Madrid from Seville, and only that. */
const RADIUS_BETWEEN_MADRID_AND_SEVILLE = 600_000;

function buildApp(oxyUserId?: string): Express {
  const app = express();
  app.use(express.json());
  app.use(serializeWireIds);
  app.use((req, _res, next) => {
    if (oxyUserId) {
      const authed = req as unknown as { user: { id: string }; userId: string };
      authed.user = { id: oxyUserId };
      authed.userId = oxyUserId;
    }
    next();
  });
  app.get('/properties', getProperties);
  app.get('/properties/search', searchProperties);
  app.get('/properties/radius', findPropertiesInRadius);
  app.get('/properties/:propertyId', getPropertyById);
  app.use(errorHandler);
  return app;
}

/** A published long-term listing at a point, in its own city. */
async function seedListingAt(options: {
  city: string;
  longitude: number;
  latitude: number;
  street?: string;
  monthlyAmount?: number;
  overrides?: Parameters<typeof seedProperty>[0]['overrides'];
}): Promise<{ chain: GeoChain; addressId: string; propertyId: string }> {
  // A unique country CODE per chain: `countries_code_key` is UNIQUE, so several
  // listings in one test cannot share one. The NAME stays `Spain` — it carries
  // no unique index and the display assertions read it.
  const chain = await seedGeoChain({
    cityName: options.city,
    regionName: `${options.city} region`,
    countryCode: `ES-${options.city}`,
  });
  const addressId = await seedAddress({
    chain,
    street: options.street ?? `Carrer de ${options.city}`,
    longitude: options.longitude,
    latitude: options.latitude,
  });
  const propertyId = await seedProperty({
    addressId,
    overrides: {
      status: PropertyStatus.PUBLISHED,
      type: PropertyType.APARTMENT,
      availabilityIsAvailable: true,
      offerings: [OfferingType.LONG_TERM_RENT],
      longTermRentMonthlyAmount: options.monthlyAmount ?? 1000,
      longTermRentCurrency: 'EUR',
      ...options.overrides,
    },
  });
  return { chain, addressId, propertyId };
}

describe('property catalogue reads (Postgres)', () => {
  beforeEach(async () => {
    await resetGeoTables();
  });

  describe('the geo collapse: one join, ordered by real distance', () => {
    it('orders by TRUE spheroid distance, which a transposed coordinate pair would not', async () => {
      // Seeded FURTHEST-first so a query that ignores distance entirely, or
      // falls back to insertion order, cannot accidentally produce the right
      // answer.
      const seville = await seedListingAt({ city: 'Seville', ...SEVILLE });
      const madrid = await seedListingAt({ city: 'Madrid', ...MADRID });
      const barcelona = await seedListingAt({ city: 'Barcelona', ...BARCELONA });

      const res = await request(buildApp()).get(
        `/properties?lat=${BARCELONA.latitude}&lng=${BARCELONA.longitude}&limit=50`,
      );

      expect(res.status).toBe(200);
      // Vacuity floor: all three listings really are in the result.
      expect(res.body.data).toHaveLength(3);

      const byId = new Map<string, number>(
        res.body.data.map((entry: { id: string; distance: number }) => [entry.id, entry.distance]),
      );
      expect(byId.get(barcelona.propertyId)).toBeLessThan(1_000);
      // ~505 km, measured on the spheroid. The transposed pair reads ~658 km,
      // so this window fails on a lat/lng swap rather than merely being loose.
      expect(byId.get(madrid.propertyId)).toBeGreaterThan(500_000);
      expect(byId.get(madrid.propertyId)).toBeLessThan(520_000);
      expect(byId.get(seville.propertyId)).toBeGreaterThan(800_000);

      // And the ORDER, which is the half a distance assertion alone misses.
      expect(res.body.data.map((entry: { id: string }) => entry.id)).toEqual([
        barcelona.propertyId,
        madrid.propertyId,
        seville.propertyId,
      ]);
    });

    it('bounds a radius search by ST_DWithin — Madrid in, Seville out', async () => {
      const barcelona = await seedListingAt({ city: 'Barcelona', ...BARCELONA });
      const madrid = await seedListingAt({ city: 'Madrid', ...MADRID });
      await seedListingAt({ city: 'Seville', ...SEVILLE });

      const res = await request(buildApp()).get(
        `/properties/radius?longitude=${BARCELONA.longitude}&latitude=${BARCELONA.latitude}` +
        `&radius=${RADIUS_BETWEEN_MADRID_AND_SEVILLE}&limit=50`,
      );

      expect(res.status).toBe(200);
      const ids = res.body.data.map((entry: { id: string }) => entry.id).sort();
      // Exactly two — a predicate that admitted everything would return three,
      // and one that admitted nothing would return zero. Both are excluded.
      expect(ids).toEqual([barcelona.propertyId, madrid.propertyId].sort());
    });

    it('scopes a search to a city through the joined address, not an id list', async () => {
      const barcelona = await seedListingAt({ city: 'Barcelona', ...BARCELONA });
      await seedListingAt({ city: 'Madrid', ...MADRID });

      const res = await request(buildApp()).get('/properties/search?city=Barcelona');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe(barcelona.propertyId);
      // The city is matched by NAME here, which is the branch that used to run a
      // `resolveCityId` and then load every address id in the city.
      expect(res.body.data[0].address.cityName).toBe('Barcelona');
    });

    it('answers an unknown city with an empty page, not with every listing', async () => {
      await seedListingAt({ city: 'Barcelona', ...BARCELONA });

      const res = await request(buildApp()).get('/properties/search?city=Atlantis');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
      expect(res.body.total).toBe(0);
    });
  });

  describe('the wire shape', () => {
    it('nests the address with its resolved geo names and carries no addressId', async () => {
      const seeded = await seedListingAt({
        city: 'Barcelona',
        ...BARCELONA,
        street: 'Carrer de Mallorca',
      });

      const res = await request(buildApp()).get(`/properties/${seeded.propertyId}`);

      expect(res.status).toBe(200);
      const property = res.body.data;
      expect(property.id).toBe(seeded.propertyId);
      // #287: `id`, never `_id`, at any depth.
      expect(JSON.stringify(res.body)).not.toContain('"_id"');
      expect(property.addressId).toBeUndefined();
      expect(property.address).toMatchObject({
        id: seeded.addressId,
        street: 'Carrer de Mallorca',
        cityId: seeded.chain.cityId,
        cityName: 'Barcelona',
        countryName: 'Spain',
        // Rebuilt from the NAMED longitude/latitude columns, in the GeoJSON
        // order the wire has always used.
        coordinates: { type: 'Point', coordinates: [BARCELONA.longitude, BARCELONA.latitude] },
      });
      expect(property.address.location).toBe('Barcelona, Barcelona region, Spain');
    });

    it('re-nests a priced block and OMITS the ones the listing does not carry', async () => {
      const seeded = await seedListingAt({ city: 'Barcelona', ...BARCELONA, monthlyAmount: 1450 });

      const res = await request(buildApp()).get(`/properties/${seeded.propertyId}`);

      const property = res.body.data;
      expect(property.longTermRent).toEqual({ monthlyAmount: 1450, currency: 'EUR' });
      // Absent, not null: Mongoose omitted an unset subdocument and `res.json`
      // would have shipped an explicit `null`.
      expect('shortTermRent' in property).toBe(false);
      expect('sale' in property).toBe(false);
      expect('exchange' in property).toBe(false);
      // …while the four blocks that are present on every row still are.
      expect(property.availability).toMatchObject({ isAvailable: true });
      expect(property.rules).toMatchObject({ pets: false, guests: true });
      expect(property.rating).toEqual({ average: 0, count: 0 });
      expect(property.accommodationDetails).toBeDefined();
    });

    it('never ships the wifi password or the search vector', async () => {
      const seeded = await seedListingAt({
        city: 'Barcelona',
        ...BARCELONA,
        overrides: {
          description: 'Piso luminoso en Málaga con vistas',
          accommodationDetailsWifiPassword: 'hunter2-not-for-the-wire',
        },
      });

      const res = await request(buildApp()).get(`/properties/${seeded.propertyId}`);

      // Vacuity floor: the row really did carry both, so their absence below is
      // an exclusion and not an empty fixture.
      expect(res.body.data.description).toBe('Piso luminoso en Málaga con vistas');
      const body = JSON.stringify(res.body);
      expect(body).not.toContain('hunter2-not-for-the-wire');
      expect(body).not.toContain('searchVector');
      expect(body).not.toContain('search_vector');
    });

    it('carries photos in order, with the full variant map', async () => {
      const seeded = await seedListingAt({ city: 'Barcelona', ...BARCELONA });
      await seedPropertyImage({ propertyId: seeded.propertyId, order: 1, url: 'https://cdn.test/b.webp' });
      await seedPropertyImage({ propertyId: seeded.propertyId, order: 0, url: 'https://cdn.test/a.webp', isPrimary: true });

      const res = await request(buildApp()).get(`/properties/${seeded.propertyId}`);

      const property = res.body.data;
      expect(property.images).toHaveLength(2);
      expect(property.images.map((image: { url: string }) => image.url)).toEqual([
        'https://cdn.test/a.webp',
        'https://cdn.test/b.webp',
      ]);
      expect(property.images[0].isPrimary).toBe(true);
      expect(property.images[0].urls).toMatchObject({ medium: 'https://cdn.test/a.webp' });
      // Derived by `db/hasImages.ts`, never copied from a fixture.
      expect(property.hasImages).toBe(true);
    });
  });

  describe('full-text search', () => {
    it('matches through unaccent, and does not match an unrelated listing', async () => {
      const malaga = await seedListingAt({
        city: 'Malaga',
        longitude: -4.4214,
        latitude: 36.7213,
        overrides: { description: 'Ático reformado en Málaga centro' },
      });
      await seedListingAt({
        city: 'Bilbao',
        longitude: -2.935,
        latitude: 43.263,
        overrides: { description: 'Loft junto a la ría' },
      });

      const res = await request(buildApp()).get('/properties/search?q=malaga');

      expect(res.status).toBe(200);
      // Exactly one: the accented description matched an unaccented term, and
      // the other listing did NOT match — which is what makes this a search
      // rather than a table scan that returns everything.
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe(malaga.propertyId);
    });
  });

  describe('visibility', () => {
    it('excludes soft-deleted and jury-restricted listings from the feed', async () => {
      const visible = await seedListingAt({ city: 'Barcelona', ...BARCELONA });
      await seedListingAt({
        city: 'Girona',
        longitude: 2.8249,
        latitude: 41.9794,
        overrides: { deletedAt: new Date() },
      });
      await seedListingAt({
        city: 'Lleida',
        longitude: 0.6206,
        latitude: 41.6176,
        overrides: { moderationRestricted: true },
      });

      const res = await request(buildApp()).get('/properties?limit=50');

      expect(res.status).toBe(200);
      // One of three: a filter that did nothing would return all three, and the
      // two excluded rows differ in WHICH clause excludes them.
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe(visible.propertyId);
    });

    it('404s a restricted listing for a stranger and serves it to its owner', async () => {
      const seeded = await seedListingAt({
        city: 'Barcelona',
        ...BARCELONA,
        overrides: { oxyUserId: 'oxy-landlord', moderationRestricted: true },
      });

      await expect(
        request(buildApp('oxy-stranger')).get(`/properties/${seeded.propertyId}`),
      ).resolves.toMatchObject({ status: 404 });
      await expect(
        request(buildApp()).get(`/properties/${seeded.propertyId}`),
      ).resolves.toMatchObject({ status: 404 });
      // The owner keeps their own view so they can appeal it.
      await expect(
        request(buildApp('oxy-landlord')).get(`/properties/${seeded.propertyId}`),
      ).resolves.toMatchObject({ status: 200 });
    });
  });

  describe('exclusion by id', () => {
    /**
     * The bug this closes: the old filter passed every entry through
     * `ObjectId.isValid` and silently DROPPED what failed, so an excluded
     * listing reappeared. A uuid v7 id is the shape that used to be dropped,
     * which is why one of the two listings here carries one.
     */
    it('excludes an id of any shape, including one no ObjectId guard would accept', async () => {
      const chain = await seedGeoChain({ cityName: 'Barcelona' });
      const addressId = await seedAddress({ chain, ...BARCELONA });
      // No explicit id: `generatedId()` mints a uuid v7, exactly as a listing
      // created after the cutover will carry.
      const uuidListing = await seedProperty({
        addressId,
        idShape: 'generated',
        overrides: { status: PropertyStatus.PUBLISHED, availabilityIsAvailable: true },
      });
      const hexListing = await seedProperty({
        addressId,
        overrides: { status: PropertyStatus.PUBLISHED, availabilityIsAvailable: true },
      });

      // Vacuity floor: both are visible when nothing is excluded, and the uuid
      // one really is a uuid.
      expect(uuidListing).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
      const unfiltered = await request(buildApp()).get('/properties?limit=50');
      expect(unfiltered.body.data).toHaveLength(2);

      const res = await request(buildApp()).get(`/properties?limit=50&excludeIds=${uuidListing}`);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe(hexListing);
    });
  });
});
