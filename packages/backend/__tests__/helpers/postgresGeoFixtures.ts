/**
 * Postgres geo fixtures for the batch-1 suites.
 *
 * ## Ids are 24-char ObjectId hex, deliberately
 *
 * `generatedId()` mints a uuid v7 for a row created by the application, and the
 * backfill copies each Mongo `_id` VERBATIM — so after the cutover both shapes
 * are live in the same column. During the migration there is a third fact these
 * fixtures have to respect: the property read path is still Mongoose, and a
 * Mongo `ObjectId` path cannot hold a uuid. Seeding 24-hex ids is therefore not
 * a convenience, it is the only shape that reproduces what production will
 * actually contain when a Postgres address id meets a Mongo `Property.addressId`.
 *
 * ## Truncation, not per-file uniqueness
 *
 * `resetGeoTables` empties the five tables these suites touch. Jest runs one
 * test FILE at a time per worker and each worker owns its own throwaway
 * database, so a truncate cannot race a sibling file — but it WOULD wipe
 * fixtures another file created in its own `beforeAll`, which is why it is
 * called from `beforeEach` in the files that want it rather than installed
 * globally in `jest.setup.ts`.
 */

import { Types } from 'mongoose';

import { getDb } from '../../db/postgres';
import { addresses, cities, countries, images, neighborhoods, regions } from '../../db/schema';

/** A fresh 24-char ObjectId hex — the id shape every pre-cutover row carries. */
export function objectIdHex(): string {
  return new Types.ObjectId().toHexString();
}

/**
 * Empty every table these suites write, child-first so the RESTRICT foreign
 * keys are satisfied.
 */
export async function resetGeoTables(): Promise<void> {
  const db = getDb();
  await db.delete(addresses);
  await db.delete(neighborhoods);
  // `cities.cover_image_id` / `regions.cover_image_id` are ON DELETE SET NULL,
  // so images have to go before the rows that point at them only to avoid
  // leaving those columns pointing at nothing mid-cleanup; the order below
  // deletes the referencing rows first, which needs no such care.
  await db.delete(cities);
  await db.delete(regions);
  await db.delete(countries);
  await db.delete(images);
}

export interface GeoChain {
  countryId: string;
  regionId: string;
  cityId: string;
}

/** Insert a country → region → city chain and return its ids. */
export async function seedGeoChain(options: {
  countryCode?: string;
  countryName?: string;
  regionName?: string;
  cityName?: string;
  propertiesCount?: number;
  latitude?: number;
  longitude?: number;
}): Promise<GeoChain> {
  const db = getDb();
  const [country] = await db
    .insert(countries)
    .values({
      id: objectIdHex(),
      code: options.countryCode ?? 'ES',
      name: options.countryName ?? 'Spain',
    })
    .returning({ id: countries.id });
  const [region] = await db
    .insert(regions)
    .values({ id: objectIdHex(), countryId: country.id, name: options.regionName ?? 'Catalonia' })
    .returning({ id: regions.id });
  const [city] = await db
    .insert(cities)
    .values({
      id: objectIdHex(),
      countryId: country.id,
      regionId: region.id,
      name: options.cityName ?? 'Barcelona',
      propertiesCount: options.propertiesCount ?? 0,
      latitude: options.latitude ?? null,
      longitude: options.longitude ?? null,
    })
    .returning({ id: cities.id });
  return { countryId: country.id, regionId: region.id, cityId: city.id };
}

/** Insert an `entityType: 'city'` image and return its id. */
export async function seedCityImage(cityId: string): Promise<string> {
  const url = 'https://api.homiio.test/api/images/file/test/medium.webp';
  const [image] = await getDb()
    .insert(images)
    .values({
      id: objectIdHex(),
      entityType: 'city',
      entityId: cityId,
      keysOriginal: 'city/o.jpg',
      keysSmall: 'city/s.webp',
      keysMedium: 'city/m.webp',
      keysLarge: 'city/l.webp',
      urlsOriginal: url,
      urlsSmall: url,
      urlsMedium: url,
      urlsLarge: url,
      format: 'webp',
      bytes: 1024,
      isPrimary: true,
    })
    .returning({ id: images.id });
  return image.id;
}

/** Insert an address in a geo chain and return its id. */
export async function seedAddress(options: {
  chain: GeoChain;
  street?: string;
  postalCode?: string;
  longitude?: number;
  latitude?: number;
  neighborhoodId?: string;
  countryCode?: string;
  number?: string;
  floor?: string;
}): Promise<string> {
  const [address] = await getDb()
    .insert(addresses)
    .values({
      id: objectIdHex(),
      countryId: options.chain.countryId,
      regionId: options.chain.regionId,
      cityId: options.chain.cityId,
      neighborhoodId: options.neighborhoodId ?? null,
      countryCode: options.countryCode ?? 'ES',
      street: options.street ?? 'Carrer de Test',
      postalCode: options.postalCode ?? '08001',
      number: options.number ?? null,
      floor: options.floor ?? null,
      longitude: options.longitude ?? 2.17,
      latitude: options.latitude ?? 41.38,
    })
    .returning({ id: addresses.id });
  return address.id;
}

/** Insert a neighborhood in a city and return its id. */
export async function seedNeighborhood(options: {
  cityId: string;
  name: string;
  latitude?: number;
  longitude?: number;
}): Promise<string> {
  const [neighborhood] = await getDb()
    .insert(neighborhoods)
    .values({
      id: objectIdHex(),
      cityId: options.cityId,
      name: options.name,
      latitude: options.latitude ?? null,
      longitude: options.longitude ?? null,
    })
    .returning({ id: neighborhoods.id });
  return neighborhood.id;
}
