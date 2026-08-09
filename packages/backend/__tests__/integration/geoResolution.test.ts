/**
 * The geo upsert chain and the canonical address write, against real Postgres.
 *
 * These are the hot ingest path: every external listing resolves
 * country → region → city → neighborhood and then dedupes its building. What
 * has to hold is that re-resolving the same place returns the SAME ids and
 * creates no second row — the property Mongo's `$setOnInsert` upserts gave, and
 * that `insert … on conflict do nothing` has to reproduce exactly.
 *
 * The geocoder is mocked: `resolveGeo` consults it only to fill missing names,
 * and every case here supplies a complete name set, so a live call would mean
 * the "names are complete" short-circuit had broken.
 */

import { count, eq, sql } from 'drizzle-orm';

import { getDb } from '../../db/postgres';
import { addresses, cities, countries, neighborhoods, regions } from '../../db/schema';
import { GeoResolutionError } from '../../services/geoResolutionService';
import {
  computeAddressNormalizedKey,
  findOrCreateCanonicalAddress,
  normalizeAddressAliases,
  resolveGeoChain,
} from '../../services/addressService';
import { resetGeoTables } from '../helpers/postgresGeoFixtures';

jest.mock('../../services/geocodingService', () => ({
  __esModule: true,
  reverseGeocode: jest.fn(async () => ({ success: false as const, error: 'not called in this suite' })),
  forwardGeocode: jest.fn(async () => ({ success: false as const, error: 'not called in this suite' })),
}));

const BARCELONA: [number, number] = [2.1734, 41.3851];

const COMPLETE_NAMES = {
  city: 'Barcelona',
  state: 'Catalonia',
  country: 'Spain',
  countryCode: 'ES',
};

beforeEach(async () => {
  await resetGeoTables();
});


describe('resolveGeo', () => {
  it('creates the whole chain once and returns the same ids on re-resolution', async () => {
    const first = await resolveGeoChain({ coordinates: BARCELONA, names: { ...COMPLETE_NAMES, neighborhood: 'Gràcia' } });
    const second = await resolveGeoChain({ coordinates: BARCELONA, names: { ...COMPLETE_NAMES, neighborhood: 'Gràcia' } });

    expect(second).toEqual(first);

    const db = getDb();
    const [countryCount] = await db.select({ n: count() }).from(countries);
    const [regionCount] = await db.select({ n: count() }).from(regions);
    const [cityCount] = await db.select({ n: count() }).from(cities);
    const [neighborhoodCount] = await db.select({ n: count() }).from(neighborhoods);
    expect([countryCount.n, regionCount.n, cityCount.n, neighborhoodCount.n]).toEqual([1, 1, 1, 1]);
  });

  it('never OVERWRITES an existing row — the `$setOnInsert` guarantee', async () => {
    const first = await resolveGeoChain({ coordinates: BARCELONA, names: COMPLETE_NAMES });
    // Someone edits the city between resolutions (a cover sync, an operator).
    await getDb().update(cities).set({ description: 'edited', propertiesCount: 42 }).where(eq(cities.id, first.cityId));

    await resolveGeoChain({ coordinates: [2.2, 41.4], names: COMPLETE_NAMES });

    const [city] = await getDb()
      .select({ description: cities.description, propertiesCount: cities.propertiesCount })
      .from(cities)
      .where(eq(cities.id, first.cityId));
    expect(city).toEqual({ description: 'edited', propertiesCount: 42 });
  });

  it('stores the city centre in NAMED columns, not a positional pair', async () => {
    const resolved = await resolveGeoChain({ coordinates: BARCELONA, names: COMPLETE_NAMES });

    const [city] = await getDb()
      .select({ latitude: cities.latitude, longitude: cities.longitude })
      .from(cities)
      .where(eq(cities.id, resolved.cityId));
    // Barcelona is at ~41.4 N, ~2.2 E. A transposition would put it at 2.17 N /
    // 41.39 E — a perfectly valid point off the coast of Somalia — so asserting
    // WHICH column got which value is the assertion that matters.
    expect(city.latitude).toBeCloseTo(41.3851, 4);
    expect(city.longitude).toBeCloseTo(2.1734, 4);
  });

  it('falls back to a stable placeholder region so the chain is always whole', async () => {
    const resolved = await resolveGeoChain({
      coordinates: BARCELONA,
      names: { city: 'Barcelona', country: 'Spain', countryCode: 'ES', state: undefined },
    });

    const [region] = await getDb().select({ name: regions.name }).from(regions).where(eq(regions.id, resolved.regionId));
    expect(region.name).toBe('Unknown');
  });

  it('throws when no country can be resolved', async () => {
    await expect(
      resolveGeoChain({ names: { city: 'Nowhere', state: 'Nowhere', country: 'Not A Country' } }),
    ).rejects.toBeInstanceOf(GeoResolutionError);
  });
});

describe('findOrCreateCanonicalAddress', () => {
  const INPUT = {
    street: 'Carrer de Mallorca',
    number: '401',
    postal_code: '08013',
    coordinates: { type: 'Point', coordinates: BARCELONA } as { type: string; coordinates: [number, number] },
    ...COMPLETE_NAMES,
  };

  it('dedupes the same building instead of creating a second row', async () => {
    const first = await findOrCreateCanonicalAddress(INPUT);
    const second = await findOrCreateCanonicalAddress(INPUT);

    expect(second.id).toBe(first.id);
    const [rows] = await getDb().select({ n: count() }).from(addresses);
    expect(rows.n).toBe(1);
  });

  it('stores the SAME normalized key the shared hash computes for those fields', async () => {
    const address = await findOrCreateCanonicalAddress(INPUT);

    // The stored key is copied verbatim by the backfill and never recomputed,
    // so what matters is that the hash input is exactly the documented field
    // list in exactly that order — asserted by recomputing it independently.
    expect(address.normalizedKey).toBe(
      computeAddressNormalizedKey({
        street: 'Carrer de Mallorca',
        number: '401',
        postalCode: '08013',
        cityId: address.cityId,
        countryCode: 'ES',
      }),
    );
    expect(address.normalizedKey).toHaveLength(40);
  });

  it('keys the building to its CITY, so the same street in two cities is two buildings', async () => {
    const barcelona = await findOrCreateCanonicalAddress(INPUT);
    const madrid = await findOrCreateCanonicalAddress({
      ...INPUT,
      city: 'Madrid',
      state: 'Community of Madrid',
      coordinates: { type: 'Point', coordinates: [-3.7038, 40.4168] },
    });

    expect(madrid.id).not.toBe(barcelona.id);
    expect(madrid.normalizedKey).not.toBe(barcelona.normalizedKey);
  });

  it('moves an existing building when the geocode drifts, and leaves it when it does not', async () => {
    const original = await findOrCreateCanonicalAddress(INPUT);

    const nudged = await findOrCreateCanonicalAddress({
      ...INPUT,
      coordinates: { type: 'Point', coordinates: [BARCELONA[0] + 0.0001, BARCELONA[1]] },
    });
    expect(nudged.id).toBe(original.id);
    expect(nudged.longitude).toBeCloseTo(BARCELONA[0], 6);

    const moved = await findOrCreateCanonicalAddress({
      ...INPUT,
      coordinates: { type: 'Point', coordinates: [BARCELONA[0] + 0.01, BARCELONA[1]] },
    });
    expect(moved.id).toBe(original.id);
    expect(moved.longitude).toBeCloseTo(BARCELONA[0] + 0.01, 6);
  });

  it('derives address_level from the fields, in the database', async () => {
    const street = await findOrCreateCanonicalAddress({ ...INPUT, number: undefined });
    expect(street.addressLevel).toBe('STREET');

    const building = await findOrCreateCanonicalAddress(INPUT);
    expect(building.addressLevel).toBe('BUILDING');

    const unit = await findOrCreateCanonicalAddress({ ...INPUT, floor: '3', unit: '2' });
    expect(unit.addressLevel).toBe('UNIT');
  });

  it('generates the PostGIS point from the named coordinate columns, in the right order', async () => {
    const address = await findOrCreateCanonicalAddress(INPUT);

    const [row] = await getDb()
      .select({
        // `ST_X` reads LONGITUDE and `ST_Y` reads LATITUDE. A transposed write
        // would still store a valid point, so asserting which value came out of
        // which accessor is the only assertion that discriminates.
        lon: sql<number>`ST_X(${addresses.geo}::geometry)`,
        lat: sql<number>`ST_Y(${addresses.geo}::geometry)`,
        srid: sql<number>`ST_SRID(${addresses.geo}::geometry)`,
      })
      .from(addresses)
      .where(eq(addresses.id, address.id));

    expect(row.lon).toBeCloseTo(BARCELONA[0], 5);
    expect(row.lat).toBeCloseTo(BARCELONA[1], 5);
    expect(Number(row.srid)).toBe(4326);
  });

  it('refuses an address with no coordinates', async () => {
    await expect(
      findOrCreateCanonicalAddress({ ...INPUT, coordinates: undefined }),
    ).rejects.toThrow('Coordinates are required');
  });
});

describe('normalizeAddressAliases', () => {
  it('maps every portal alias onto the canonical field', () => {
    const normalized = normalizeAddressAliases({
      street: 'Carrer de Test',
      piso: '4',
      torre: 'B',
      nivel: '2',
      codigo_postal: '08001',
      line1: 'first',
      line2: 'second',
    });

    expect(normalized.unit).toBe('4');
    expect(normalized.block).toBe('B');
    expect(normalized.floor).toBe('2');
    expect(normalized.postal_code).toBe('08001');
    expect(normalized.address_lines).toEqual(['first', 'second']);
  });

  it('leaves the geo NAMES untouched — they are resolved to ids, never stored', () => {
    const normalized = normalizeAddressAliases({ street: 'x', city: 'Barcelona', state: 'Catalonia' });
    expect(normalized.city).toBe('Barcelona');
    expect(normalized.state).toBe('Catalonia');
  });
});
