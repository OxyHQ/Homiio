/**
 * Test data factories.
 *
 * The property and address factories write POSTGRES — the store the controllers
 * and services under test actually read and write. The Mongoose models are
 * still re-exported below for the domains that have not moved yet.
 *
 * Ids are returned as `id`, never `_id`: that is the wire contract (#287) and
 * the column name, and a factory that spelled it the old way would keep every
 * consumer speaking a shape the API does not serve.
 */

import { eq } from 'drizzle-orm';
import { OfferingType, PropertyType, PropertyStatus } from '@homiio/shared-types';

import * as models from '../../models';
import { getDb } from '../../db/postgres';
import { addresses, cities, countries, properties, regions } from '../../db/schema';
import { assertFound } from './assertFound';
const { Lease } = models;

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

/**
 * A MONGO address, for the fixtures of domains that have not moved yet.
 *
 * `Review.addressId` / `streetLevelId` / `buildingLevelId` are still Mongoose
 * `ObjectId` paths pointing at the Mongo `Address` collection, and
 * `reviewController` still writes through `Address.findOrCreateCanonical` — so
 * a review fixture handed a Postgres address id fails validation with a
 * `BSONError`. That is a property of where REVIEWS live, not of the address
 * port: production is self-consistent on both sides today.
 *
 * This goes when reviews move, and it is deliberately a SECOND function rather
 * than a flag on {@link createAddress}, so no caller can pick the wrong store
 * without saying which one it means.
 */
export async function createMongoAddress(): Promise<{ _id: unknown }> {
  const country = await models.Country.findOneAndUpdate(
    { code: 'ES' },
    { $setOnInsert: { code: 'ES', name: 'Spain' } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  assertFound(country, 'country');
  const region = await models.Region.findOneAndUpdate(
    { countryId: country._id, name: 'Catalonia' },
    { $setOnInsert: { countryId: country._id, name: 'Catalonia' } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  assertFound(region, 'region');
  const city = await models.City.findOneAndUpdate(
    { regionId: region._id, name: 'Barcelona' },
    { $setOnInsert: { countryId: country._id, regionId: region._id, name: 'Barcelona' } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  assertFound(city, 'city');

  const existing = await models.Address.findOne({ street: 'Carrer de Mallorca 100' });
  if (existing) return existing;
  return models.Address.create({
    countryId: country._id,
    regionId: region._id,
    cityId: city._id,
    countryCode: 'ES',
    street: 'Carrer de Mallorca 100',
    postal_code: '08013',
    coordinates: { type: 'Point', coordinates: [2.17, 41.39] },
  });
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

export interface CreateLeaseOptions {
  propertyId: unknown;
  landlordOxyUserId: string;
  tenantOxyUserId: string;
  status?: string;
}

export async function createLease(
  options: CreateLeaseOptions,
): Promise<{ _id: unknown; status: string }> {
  const now = new Date();
  const end = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  return Lease.create({
    propertyId: options.propertyId,
    landlordOxyUserId: options.landlordOxyUserId,
    tenantOxyUserId: options.tenantOxyUserId,
    status: options.status ?? 'draft',
    leaseTerms: { startDate: now, endDate: end },
    rentDetails: { monthlyRent: 1200, currency: 'EUR', dueDay: 1 },
  });
}

export { models };
