/**
 * Bloom's feature chips, resolved against what Homiio records (#518 §6).
 *
 * ## The thing worth testing
 *
 * Several features are recorded in TWO places. A garden is
 * `properties.has_garden` and also the amenity slugs `garden_space` and
 * `garden_access`; a lift is `has_elevator` and the slug `elevator`. The column
 * wins, because it is present on every row while a slug is free text a listing
 * carries or does not — so a home with a garden whose ingest never emitted
 * `garden_space` must still come back.
 *
 * That is what the fixture is built to catch: each column-backed case seeds a
 * home with the COLUMN set and NO matching amenity slug. A version that had
 * quietly filtered on the slug would return nothing, and every "is absent"
 * assertion would still pass — so each case also names what it expects.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { OfferingType, PropertyStatus, PropertyType } from '@homiio/shared-types';

import { searchProperties } from '../../controllers/property/search';
import { errorHandler } from '../../middlewares/errorHandler';
import { serializeWireIds } from '../../middlewares/wireIds';
import { resetGeoTables, seedAddress, seedGeoChain, seedProperty } from '../helpers/postgresGeoFixtures';

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(serializeWireIds);
  app.get('/properties/search', searchProperties);
  app.use(errorHandler);
  return app;
}

const idsOf = (body: { data?: Array<{ id?: string }> }): string[] =>
  (body.data ?? []).map((row) => String(row.id)).sort();

let city: string;
let plain: string;
let withLift: string;
let withGarden: string;
let withParking: string;
let furnished: string;
let partlyFurnished: string;
let petFriendly: string;
let withPool: string;
let counter = 0;

beforeEach(async () => {
  await resetGeoTables();
  counter += 1;
  const chain = await seedGeoChain({
    cityName: `Featureton ${counter}`,
    regionName: 'Feature Region',
    countryCode: `F${counter}`,
    countryName: `Featureland ${counter}`,
  });
  city = chain.cityId;

  const seed = async (overrides: Record<string, unknown>): Promise<string> =>
    seedProperty({
      addressId: await seedAddress({ chain }),
      overrides: {
        status: PropertyStatus.PUBLISHED,
        type: PropertyType.APARTMENT,
        availabilityIsAvailable: true,
        offerings: [OfferingType.LONG_TERM_RENT],
        longTermRentMonthlyAmount: 900,
        longTermRentCurrency: 'EUR',
        ...overrides,
      } as never,
    });

  // Every column-backed home carries NO amenity slug, on purpose.
  plain = await seed({});
  withLift = await seed({ hasElevator: true });
  withGarden = await seed({ hasGarden: true });
  withParking = await seed({ parkingType: 'garage', parkingSpaces: 1 });
  furnished = await seed({ furnishedStatus: 'furnished' });
  partlyFurnished = await seed({ furnishedStatus: 'partially_furnished' });
  petFriendly = await seed({ petFriendly: true });
  // The amenity-backed half has no column to fall back on.
  withPool = await seed({ amenities: ['swimming_pool'] });
});

const search = (features: string) =>
  request(buildApp()).get('/properties/search').query({ city, features });

describe('a feature with a column is answered by the column', () => {
  it('finds a lift with no `elevator` amenity slug on the listing', async () => {
    const res = await search('elevator');
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toEqual([withLift]);
  });

  it('finds a garden with neither `garden_space` nor `garden_access`', async () => {
    expect(idsOf((await search('garden')).body)).toEqual([withGarden]);
  });

  it('finds pets allowed', async () => {
    expect(idsOf((await search('pets')).body)).toEqual([petFriendly]);
  });

  it('reads parking as "any arrangement that is not none"', async () => {
    // `parking_type` is not a boolean and `'none'` is a real value. Treating
    // the column as merely non-null would return the whole catalogue.
    expect(idsOf((await search('parking')).body)).toEqual([withParking]);
  });

  it('counts partially furnished, and not "nobody said"', async () => {
    // Somebody filtering for furnished wants a home they can move into, and a
    // half-furnished one is an answer they can judge. An unstated fact is not
    // a yes — `plain` defaults to `not_specified` and must not appear.
    const ids = idsOf((await search('furnished')).body);
    expect(ids).toEqual([furnished, partlyFurnished].sort());
    // `plain` defaults to `not_specified`, and silence is not a yes.
    expect(ids).not.toContain(plain);
  });
});

describe('a feature with no column is answered by its slug', () => {
  it('finds a pool by the amenity the listing declared', async () => {
    expect(idsOf((await search('pool')).body)).toEqual([withPool]);
  });

  it('returns nothing for a feature nobody declared', async () => {
    // The honest answer to "which homes SAID they have air conditioning" when
    // none did. An unknown slug matching nothing is the same bargain the
    // amenity filter already makes everywhere else.
    expect(idsOf((await search('airConditioning')).body)).toEqual([]);
  });
});

describe('combining and refusing', () => {
  it('means ALL of them', async () => {
    const both = await search('elevator,garden');
    // One home has a lift, another a garden, neither has both.
    expect(idsOf(both.body)).toEqual([]);
  });

  it('folds a feature slug into the caller\'s own amenities', async () => {
    const res = await request(buildApp())
      .get('/properties/search')
      .query({ city, features: 'pool', amenities: 'swimming_pool' });
    // Asking twice for the same thing is still one question.
    expect(idsOf(res.body)).toEqual([withPool]);
  });

  it('drops a feature nobody defined rather than narrowing on it', async () => {
    const res = await search('elevator,teleporter');
    // A chip from a newer client must not silently empty the results; the
    // known half still applies.
    expect(idsOf(res.body)).toEqual([withLift]);
  });

  it('narrows nothing when no feature was asked for', async () => {
    const res = await request(buildApp()).get('/properties/search').query({ city });
    expect(idsOf(res.body)).toHaveLength(8);
  });
});
