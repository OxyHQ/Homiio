/**
 * Test data factories.
 *
 * Every factory here writes POSTGRES — the store the controllers and services
 * under test actually read and write. Nothing in this file reaches a Mongoose
 * model any more, and nothing should: a suite that genuinely needs a Mongo
 * document (the backfill suites, and the handful of tests still pinned to a
 * domain that has not moved) imports the model it wants directly, where the
 * dependency is visible in that file rather than acquired by anyone who imports
 * a factory.
 *
 * Ids are returned as `id`, never `_id`: that is the wire contract (#287) and
 * the column name, and a factory that spelled it the old way would keep every
 * consumer speaking a shape the API does not serve.
 */

import { eq } from 'drizzle-orm';
import { OfferingType, PropertyType, PropertyStatus } from '@homiio/shared-types';

import { getDb } from '../../db/postgres';
import { addresses, cities, countries, properties, regions } from '../../db/schema';

/**
 * The shared geo hierarchy, created once per test and reused within it.
 *
 * UPSERTS rather than inserts, and the difference is a real flake rather than a
 * style choice: a test calling `createAddress()` twice must not try to insert
 * Spain twice. Against Mongo whether that threw depended on whether the unique
 * index had finished building yet, so the same code failed or passed depending
 * on how early in the run it executed. Here `countries_code_key`,
 * `regions_country_name_key` and `cities_region_name_key` exist from the
 * migration, so `ON CONFLICT DO UPDATE` is deterministic from the first call.
 *
 * `DO UPDATE ... RETURNING` rather than `DO NOTHING`: `DO NOTHING` returns no
 * row on conflict, so the second caller would get nothing back.
 */
async function ensureGeo(): Promise<{ countryId: string; regionId: string; cityId: string }> {
  const db = getDb();
  const [country] = await db
    .insert(countries)
    .values({ code: 'ES', name: 'Spain' })
    .onConflictDoUpdate({ target: countries.code, set: { name: 'Spain' } })
    .returning({ id: countries.id });
  const [region] = await db
    .insert(regions)
    .values({ countryId: country.id, name: 'Catalonia' })
    .onConflictDoUpdate({
      target: [regions.countryId, regions.name],
      set: { countryId: country.id },
    })
    .returning({ id: regions.id });
  const [city] = await db
    .insert(cities)
    .values({ countryId: country.id, regionId: region.id, name: 'Barcelona' })
    .onConflictDoUpdate({
      target: [cities.regionId, cities.name],
      set: { countryId: country.id },
    })
    .returning({ id: cities.id });
  return { countryId: country.id, regionId: region.id, cityId: city.id };
}

/**
 * An address, reused within a test.
 *
 * Looked up by street before inserting, because several listings at the same
 * door legitimately share one address row and `addresses_normalized_key_key`
 * would refuse a second — the same reason the Mongo version did this.
 */
export async function createAddress(): Promise<{ id: string }> {
  const geo = await ensureGeo();
  const db = getDb();
  const existing = await db
    .select({ id: addresses.id })
    .from(addresses)
    .where(eq(addresses.street, 'Carrer de Mallorca 100'))
    .limit(1);
  if (existing[0]) return existing[0];
  const [created] = await db
    .insert(addresses)
    .values({
      ...geo,
      countryCode: 'ES',
      street: 'Carrer de Mallorca 100',
      postalCode: '08013',
      longitude: 2.17,
      latitude: 41.39,
    })
    .returning({ id: addresses.id });
  return created;
}

export interface CreatePropertyOptions {
  oxyUserId: string;
  status?: string;
  monthlyAmount?: number;
}

/**
 * A published long-term-rent listing owned by `oxyUserId`.
 *
 * Returns the id and the fields a caller asserts on. Not the whole row: a
 * factory that returned everything would let a test assert on a column it never
 * set, which passes for the wrong reason.
 */
export async function createRentProperty(
  options: CreatePropertyOptions,
): Promise<{ id: string; oxyUserId: string; status: string }> {
  const address = await createAddress();
  const [created] = await getDb()
    .insert(properties)
    .values({
      oxyUserId: options.oxyUserId,
      addressId: address.id,
      type: PropertyType.APARTMENT,
      bedrooms: 2,
      bathrooms: 1,
      offerings: [OfferingType.LONG_TERM_RENT],
      longTermRentMonthlyAmount: options.monthlyAmount ?? 1200,
      longTermRentCurrency: 'EUR',
      status: (options.status ?? PropertyStatus.PUBLISHED) as 'published',
    })
    .returning({
      id: properties.id,
      oxyUserId: properties.oxyUserId,
      status: properties.status,
    });
  return { id: created.id, oxyUserId: created.oxyUserId ?? options.oxyUserId, status: created.status };
}

