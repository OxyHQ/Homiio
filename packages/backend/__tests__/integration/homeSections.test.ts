/**
 * `GET /api/home/sections` against a REAL Postgres (#353).
 *
 * ## The fixture the issue asks for by name
 *
 * "Fixture con anuncios de Madrid y Barcelona que demuestre que no se mezclan."
 * Every section in one response is computed under ONE scope, so the assertion is
 * not "Barcelona came back" — a listing coming back proves nothing about the
 * ones that did not — but that **no section anywhere in the payload contains a
 * Madrid listing**, checked across every section at once. A per-section spot
 * check would pass while a single band leaked.
 *
 * ## Every assertion here can fail
 *
 *  - **Counts, not presence.** A throwaway database starts empty, so a test that
 *    only asserts a request succeeded passes against a scope that matched
 *    nothing. Each block asserts the rows it seeded.
 *  - **Both directions of the scope.** Barcelona's scope must EXCLUDE Madrid and
 *    Madrid's must exclude Barcelona; asserting one direction cannot tell a
 *    working filter from a filter that drops everything from one city.
 *  - **The unresolvable place is asserted on the ECHO, not on emptiness.** An
 *    unknown city returns zero sections, and so does a real city with no
 *    listings — the payload's `location.status` is the only thing that
 *    distinguishes "we did not understand where" from "there is nothing here",
 *    which is the distinction the whole endpoint is built around.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { OfferingType, PropertyStatus, PropertyType } from '@homiio/shared-types';

import { getHomeSections } from '../../controllers/home/homeSectionsController';
import { errorHandler } from '../../middlewares/errorHandler';
import { serializeWireIds } from '../../middlewares/wireIds';
import {
  resetGeoTables,
  seedAddress,
  seedGeoChain,
  seedProperty,
  type GeoChain,
} from '../helpers/postgresGeoFixtures';

/** Barcelona city centre. */
const BARCELONA = { longitude: 2.1686, latitude: 41.3874 };
/** Madrid, ~505 km away — outside every radius this suite uses. */
const MADRID = { longitude: -3.7038, latitude: 40.4168 };

interface SectionPayload {
  id: string;
  reason: string;
  source: string;
  generatedAt: string;
  location: { status: string; key?: string };
  items: { id: string; address?: { cityName?: string } }[];
}

interface HomePayload {
  location: { status: string; key?: string; requested?: { param: string; value: string } };
  generatedAt: string;
  sections: SectionPayload[];
}

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(serializeWireIds);
  app.get('/home/sections', getHomeSections);
  app.use(errorHandler);
  return app;
}

/** A published long-term listing at a point, in its own city. */
async function seedListingAt(options: {
  city: string;
  longitude: number;
  latitude: number;
  overrides?: Parameters<typeof seedProperty>[0]['overrides'];
}): Promise<{ chain: GeoChain; propertyId: string }> {
  // A unique country CODE per chain: `countries_code_key` is UNIQUE, so several
  // listings in one test cannot share one.
  const chain = await seedGeoChain({
    cityName: options.city,
    regionName: `${options.city} region`,
    countryCode: `ES-${options.city}`,
    latitude: options.latitude,
    longitude: options.longitude,
  });
  const addressId = await seedAddress({
    chain,
    street: `${options.city} street`,
    longitude: options.longitude,
    latitude: options.latitude,
  });
  const propertyId = await seedProperty({
    addressId,
    overrides: {
      title: `${options.city} home`,
      type: PropertyType.APARTMENT,
      status: PropertyStatus.PUBLISHED,
      availabilityIsAvailable: true,
      offerings: [OfferingType.LONG_TERM_RENT],
      longTermRentMonthlyAmount: 1200,
      ...options.overrides,
    },
  });
  return { chain, propertyId };
}

/** Every item across every section, so a leak in any band is visible at once. */
function allItems(payload: HomePayload): SectionPayload['items'] {
  return payload.sections.flatMap((section) => section.items);
}

describe('GET /home/sections', () => {
  const app = buildApp();

  beforeEach(async () => {
    await resetGeoTables();
  });

  describe('a scope keeps two cities apart', () => {
    it('returns Barcelona listings for a Barcelona scope and NO Madrid listing', async () => {
      const barcelona = await seedListingAt({ city: 'Barcelona', ...BARCELONA });
      await seedListingAt({ city: 'Madrid', ...MADRID });

      const response = await request(app)
        .get('/home/sections')
        .query({ loc: `city.homiio.${barcelona.chain.cityId}`, offering: OfferingType.LONG_TERM_RENT })
        .expect(200);

      const payload = response.body.data as HomePayload;
      const items = allItems(payload);

      // Floored on the row actually seeded: an empty payload would otherwise
      // satisfy "no Madrid listing" perfectly.
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((item) => item.address?.cityName === 'Barcelona')).toBe(true);
      expect(items.some((item) => item.address?.cityName === 'Madrid')).toBe(false);
    });

    it('returns Madrid listings for a Madrid scope and NO Barcelona listing', async () => {
      await seedListingAt({ city: 'Barcelona', ...BARCELONA });
      const madrid = await seedListingAt({ city: 'Madrid', ...MADRID });

      const response = await request(app)
        .get('/home/sections')
        .query({ loc: `city.homiio.${madrid.chain.cityId}`, offering: OfferingType.LONG_TERM_RENT })
        .expect(200);

      const items = allItems(response.body.data as HomePayload);

      expect(items.length).toBeGreaterThan(0);
      expect(items.every((item) => item.address?.cityName === 'Madrid')).toBe(true);
      expect(items.some((item) => item.address?.cityName === 'Barcelona')).toBe(false);
    });

    it('applies ONE scope to every section, so no two sections disagree', async () => {
      const barcelona = await seedListingAt({
        city: 'Barcelona',
        ...BARCELONA,
        // Enough flags that several rules match this one listing, so more than
        // one section is produced and the "every section, one scope" claim has
        // more than one section to be true of.
        overrides: {
          isVerified: true,
          housingType: 'public',
          listingFlagsAgencyFeePayable: false,
          utilitiesIncluded: true,
          longTermRentDeposit: 1200,
          longTermRentMonthlyAmount: 1200,
          offerings: [OfferingType.LONG_TERM_RENT],
          status: PropertyStatus.PUBLISHED,
          availabilityIsAvailable: true,
        },
      });
      await seedListingAt({
        city: 'Madrid',
        ...MADRID,
        overrides: {
          isVerified: true,
          housingType: 'public',
          listingFlagsAgencyFeePayable: false,
          utilitiesIncluded: true,
          longTermRentDeposit: 900,
          longTermRentMonthlyAmount: 900,
          offerings: [OfferingType.LONG_TERM_RENT],
          status: PropertyStatus.PUBLISHED,
          availabilityIsAvailable: true,
        },
      });

      const response = await request(app)
        .get('/home/sections')
        .query({ loc: `city.homiio.${barcelona.chain.cityId}`, offering: OfferingType.LONG_TERM_RENT })
        .expect(200);

      const payload = response.body.data as HomePayload;

      // The floor: without it, "every section is Barcelona" is vacuously true of
      // a payload with no sections at all.
      expect(payload.sections.length).toBeGreaterThan(1);
      for (const section of payload.sections) {
        expect(section.items.length).toBeGreaterThan(0);
        expect(section.items.every((item) => item.address?.cityName === 'Barcelona')).toBe(true);
        // Each section repeats the scope it was computed under, and they must
        // all be the SAME one.
        expect(section.location).toEqual(payload.location);
      }
    });
  });

  describe('every section states its reason and its source', () => {
    it('carries a reason, a source and the shared generatedAt on each section', async () => {
      const barcelona = await seedListingAt({ city: 'Barcelona', ...BARCELONA });

      const response = await request(app)
        .get('/home/sections')
        .query({ loc: `city.homiio.${barcelona.chain.cityId}`, offering: OfferingType.LONG_TERM_RENT })
        .expect(200);

      const payload = response.body.data as HomePayload;
      expect(payload.sections.length).toBeGreaterThan(0);
      for (const section of payload.sections) {
        expect(section.reason).toMatch(/^home\.sections\./);
        expect(section.source.length).toBeGreaterThan(0);
        // One timestamp for the envelope and every section — two clocks would
        // give the offline banner two answers to "how old is this?".
        expect(section.generatedAt).toBe(payload.generatedAt);
      }
    });

    it('never returns a section with zero items', async () => {
      const barcelona = await seedListingAt({ city: 'Barcelona', ...BARCELONA });

      const response = await request(app)
        .get('/home/sections')
        .query({ loc: `city.homiio.${barcelona.chain.cityId}`, offering: OfferingType.LONG_TERM_RENT })
        .expect(200);

      const payload = response.body.data as HomePayload;
      expect(payload.sections.length).toBeGreaterThan(0);
      // A heading with nothing under it is what invites somebody to fill it with
      // invented content. It is not representable in this response.
      expect(payload.sections.every((section) => section.items.length > 0)).toBe(true);
    });
  });

  describe('a location that was requested and lost never widens', () => {
    it('answers an unresolvable city with an UNRESOLVED echo and no sections', async () => {
      // Seeded so the database is NOT empty: the failure being guarded against
      // is answering globally, and an empty database cannot tell a global answer
      // from a scoped one.
      await seedListingAt({ city: 'Barcelona', ...BARCELONA });
      await seedListingAt({ city: 'Madrid', ...MADRID });

      const response = await request(app)
        .get('/home/sections')
        .query({ loc: 'city.homiio.no-such-city-id', offering: OfferingType.LONG_TERM_RENT })
        .expect(200);

      const payload = response.body.data as HomePayload;
      expect(payload.location.status).toBe('unresolved');
      expect(payload.location.requested).toEqual({ param: 'city', value: 'no-such-city-id' });
      expect(payload.sections).toHaveLength(0);
    });

    it('rejects an unreadable loc token with 400 rather than answering globally', async () => {
      await seedListingAt({ city: 'Barcelona', ...BARCELONA });

      const response = await request(app)
        .get('/home/sections')
        .query({ loc: 'not-a-token', offering: OfferingType.LONG_TERM_RENT })
        .expect(400);

      expect(response.body.error).toBe('INVALID_LOCATION_TOKEN');
    });

    it('rejects a here. scope with no position rather than answering globally', async () => {
      await seedListingAt({ city: 'Barcelona', ...BARCELONA });

      const response = await request(app)
        .get('/home/sections')
        .query({ loc: 'here.25000', offering: OfferingType.LONG_TERM_RENT })
        .expect(400);

      expect(response.body.error).toBe('MISSING_DEVICE_POSITION');
    });

    it('answers a request with NO loc globally, and says so', async () => {
      // The legitimate case, and the one the client only reaches after an
      // explicit "Explore everywhere": no location was REQUESTED, so nothing was
      // lost. The echo must say `none` rather than pretending to a scope.
      await seedListingAt({ city: 'Barcelona', ...BARCELONA });
      await seedListingAt({ city: 'Madrid', ...MADRID });

      const response = await request(app)
        .get('/home/sections')
        .query({ offering: OfferingType.LONG_TERM_RENT })
        .expect(200);

      const payload = response.body.data as HomePayload;
      expect(payload.location.status).toBe('none');
      const cities = allItems(payload).map((item) => item.address?.cityName);
      expect(cities).toContain('Barcelona');
      expect(cities).toContain('Madrid');
    });
  });

  describe('a device scope filters by radius', () => {
    it('keeps Barcelona and drops Madrid at 25 km', async () => {
      await seedListingAt({ city: 'Barcelona', ...BARCELONA });
      await seedListingAt({ city: 'Madrid', ...MADRID });

      const response = await request(app)
        .get('/home/sections')
        .query({
          loc: 'here.25000',
          lat: BARCELONA.latitude,
          lng: BARCELONA.longitude,
          offering: OfferingType.LONG_TERM_RENT,
        })
        .expect(200);

      const payload = response.body.data as HomePayload;
      const items = allItems(payload);

      expect(items.length).toBeGreaterThan(0);
      expect(items.every((item) => item.address?.cityName === 'Barcelona')).toBe(true);
      // The echo carries the radius and NOT the position: `here:25000` is what
      // `locationKeyOfRef` emits, and it has no coordinate to emit.
      expect(payload.location.key).toBe('here:25000');
      expect(JSON.stringify(payload.location)).not.toContain(String(BARCELONA.latitude));
    });
  });

  describe('the rules read real columns', () => {
    it('puts a rented listing in no-longer-available and keeps it out of new-in-area', async () => {
      const barcelona = await seedListingAt({
        city: 'Barcelona',
        ...BARCELONA,
        overrides: {
          status: PropertyStatus.RENTED,
          availabilityIsAvailable: false,
          offerings: [OfferingType.LONG_TERM_RENT],
        },
      });

      const response = await request(app)
        .get('/home/sections')
        .query({ loc: `city.homiio.${barcelona.chain.cityId}`, offering: OfferingType.LONG_TERM_RENT })
        .expect(200);

      const payload = response.body.data as HomePayload;
      const ids = payload.sections.map((section) => section.id);
      expect(ids).toContain('no_longer_available');
      expect(ids).not.toContain('new_in_area');
    });

    it('excludes a listing that says NOTHING about an agency fee from the no-fee section', async () => {
      // The distinction the strict `= false` exists to make: NULL means the
      // listing did not say, and an unknown is not a promise. A fixture that only
      // seeded `false` and `true` could not tell the strict predicate from
      // `is not true`, which would sweep every silent listing into the section.
      const chain = await seedGeoChain({
        cityName: 'Barcelona',
        regionName: 'Catalonia',
        countryCode: 'ES-BCN',
        latitude: BARCELONA.latitude,
        longitude: BARCELONA.longitude,
      });
      const silentAddress = await seedAddress({ chain, street: 'Silent street', ...BARCELONA });
      const declaredAddress = await seedAddress({ chain, street: 'Declared street', ...BARCELONA });

      await seedProperty({
        addressId: silentAddress,
        overrides: {
          title: 'Says nothing about fees',
          status: PropertyStatus.PUBLISHED,
          availabilityIsAvailable: true,
          offerings: [OfferingType.LONG_TERM_RENT],
          // `properties_offering_long_term_rent_check` makes the offering and
          // its price mutually implied, so a long-term listing MUST carry one.
          longTermRentMonthlyAmount: 1100,
          listingFlagsAgencyFeePayable: null,
        },
      });
      await seedProperty({
        addressId: declaredAddress,
        overrides: {
          title: 'Declares no fee',
          status: PropertyStatus.PUBLISHED,
          availabilityIsAvailable: true,
          offerings: [OfferingType.LONG_TERM_RENT],
          longTermRentMonthlyAmount: 1150,
          listingFlagsAgencyFeePayable: false,
        },
      });

      const response = await request(app)
        .get('/home/sections')
        .query({ loc: `city.homiio.${chain.cityId}`, offering: OfferingType.LONG_TERM_RENT })
        .expect(200);

      const payload = response.body.data as HomePayload;
      const noFee = payload.sections.find((section) => section.id === 'no_agency_fee');
      expect(noFee).toBeDefined();
      expect(noFee?.items).toHaveLength(1);
    });

    it('offers price-reduced only for SALE, because rent has no price history', async () => {
      const chain = await seedGeoChain({
        cityName: 'Barcelona',
        regionName: 'Catalonia',
        countryCode: 'ES-BCN2',
        latitude: BARCELONA.latitude,
        longitude: BARCELONA.longitude,
      });
      const addressId = await seedAddress({ chain, street: 'Sale street', ...BARCELONA });
      await seedProperty({
        addressId,
        overrides: {
          title: 'Reduced',
          status: PropertyStatus.PUBLISHED,
          availabilityIsAvailable: true,
          offerings: [OfferingType.SALE, OfferingType.LONG_TERM_RENT],
          salePrice: 300_000,
          longTermRentMonthlyAmount: 1300,
          saleIsPriceReduced: true,
        },
      });

      const sale = await request(app)
        .get('/home/sections')
        .query({ loc: `city.homiio.${chain.cityId}`, offering: OfferingType.SALE })
        .expect(200);
      const rent = await request(app)
        .get('/home/sections')
        .query({ loc: `city.homiio.${chain.cityId}`, offering: OfferingType.LONG_TERM_RENT })
        .expect(200);

      const saleIds = (sale.body.data as HomePayload).sections.map((section) => section.id);
      const rentIds = (rent.body.data as HomePayload).sections.map((section) => section.id);

      expect(saleIds).toContain('price_reduced');
      // Not "missing because empty": the same listing carries both offerings, so
      // the rent response DOES have sections — the rule simply does not apply.
      expect(rentIds.length).toBeGreaterThan(0);
      expect(rentIds).not.toContain('price_reduced');
    });
  });
});
