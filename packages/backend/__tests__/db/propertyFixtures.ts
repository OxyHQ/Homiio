/**
 * Fixtures for the `properties` suites.
 *
 * A property cannot exist without an address, and an address cannot exist
 * without the whole `country → region → city` chain, so every one of these
 * suites needs the same five-row scaffold before it can assert anything about
 * one column. This module builds it once rather than four times.
 *
 * Not a `.test.ts` file, so jest does not collect it as a suite — every pattern
 * in `testMatch` ends in `*.test.ts`.
 *
 * ## Uniqueness is not cosmetic here
 *
 * Test FILES within one jest worker share a database, and `countries.code`,
 * `regions (country_id, name)` and `cities (region_id, name)` are all UNIQUE.
 * A fixed `'ES'` would collide with a sibling file the moment two of these run
 * in the same worker, and the failure would look like a schema bug rather than
 * a fixture one. Every scaffold therefore carries a full uuid v7 suffix — not a
 * short slice, which would collide often enough to make the suites flaky.
 */

import { eq } from 'drizzle-orm';
import { uuidv7 } from '@oxyhq/db';
import type { Database } from '../../db/postgres';
import { addresses, cities, countries, properties, regions } from '../../db/schema';

/** The geo scaffold one suite owns, and the ids it must tear down. */
export interface PropertyScaffold {
  readonly countryId: string;
  readonly regionId: string;
  readonly cityId: string;
  readonly addressId: string;
}

/** Columns a test may vary when inserting a property. */
export type PropertyOverrides = Partial<typeof properties.$inferInsert>;

/**
 * Create the `country → region → city → address` chain a property hangs from.
 *
 * @param db An open database handle.
 * @param label Distinguishes one suite's scaffold from another's in a failure
 *   message. Not part of the uniqueness guarantee — the uuid is.
 */
export async function createPropertyScaffold(
  db: Database,
  label: string,
): Promise<PropertyScaffold> {
  const suffix = uuidv7().replace(/-/g, '');

  const [country] = await db
    .insert(countries)
    .values({ code: `T-${suffix}`, name: `Spain ${label} ${suffix}` })
    .returning({ id: countries.id });
  const [region] = await db
    .insert(regions)
    .values({ countryId: country.id, name: `Catalonia ${label} ${suffix}` })
    .returning({ id: regions.id });
  const [city] = await db
    .insert(cities)
    .values({ name: `Barcelona ${label} ${suffix}`, countryId: country.id, regionId: region.id })
    .returning({ id: cities.id });
  const [address] = await db
    .insert(addresses)
    .values({
      countryId: country.id,
      regionId: region.id,
      cityId: city.id,
      countryCode: 'ES',
      street: 'Carrer de Mallorca',
      postalCode: '08013',
      longitude: 2.1686,
      latitude: 41.3874,
    })
    .returning({ id: addresses.id });

  return {
    countryId: country.id,
    regionId: region.id,
    cityId: city.id,
    addressId: address.id,
  };
}

/**
 * Delete a scaffold, in reverse dependency order.
 *
 * `properties` rows must already be gone: `addresses` is referenced with
 * `ON DELETE RESTRICT`, so a leftover listing makes this throw rather than
 * silently orphaning anything — which is the constraint working, not a teardown
 * bug.
 */
export async function dropPropertyScaffold(
  db: Database,
  scaffold: PropertyScaffold,
): Promise<void> {
  await db.delete(addresses).where(eq(addresses.id, scaffold.addressId));
  await db.delete(cities).where(eq(cities.id, scaffold.cityId));
  await db.delete(regions).where(eq(regions.id, scaffold.regionId));
  await db.delete(countries).where(eq(countries.id, scaffold.countryId));
}

/**
 * Insert a listing that satisfies every constraint on the table, so a test can
 * break exactly one thing and know that is what it broke.
 *
 * The baseline carries NO offerings and NO priced blocks, which is coherent by
 * the four offering CHECKs: each reads `(<offering> = any(offerings)) = (<price>
 * is not null)`, and `false = false` holds.
 *
 * @returns The new listing's id.
 */
export async function insertProperty(
  db: Database,
  scaffold: PropertyScaffold,
  overrides: PropertyOverrides = {},
): Promise<string> {
  const [row] = await db
    .insert(properties)
    .values({ addressId: scaffold.addressId, ...overrides })
    .returning({ id: properties.id });
  return row.id;
}
