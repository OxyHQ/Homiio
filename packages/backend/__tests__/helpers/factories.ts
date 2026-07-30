/**
 * Test data factories using real Mongoose models against in-memory Mongo.
 */

import { OfferingType, PropertyType, PropertyStatus } from '@homiio/shared-types';

const models = require('../../models');
const { Property, Address, Country, Region, City, Lease } = models;

/**
 * The shared geo hierarchy, created once per test and reused within it.
 *
 * UPSERTS rather than inserts, and the difference is a real flake rather than a
 * style choice. `Country.code` is unique, so a test calling `createAddress()`
 * twice used to insert Spain twice — and whether that threw depended on whether
 * Mongoose had finished building the unique index yet, because `autoIndex` runs
 * asynchronously against the in-memory server. Early in a run both inserts
 * succeeded; once the index existed, the second raised
 * `E11000 duplicate key error ... index: code_1`. Same code, same data,
 * different outcome per run.
 *
 * There was a module-level `geoChain` cache here that was assigned and never
 * read, which is what this was clearly meant to do. Caching would not be right
 * anyway: the global `afterEach` wipes every collection, so a value cached in
 * one test names documents that no longer exist in the next. Upserting is
 * correct in both directions — idempotent within a test, and rebuilt after a
 * wipe.
 */
const UPSERT = { upsert: true, new: true, setDefaultsOnInsert: true };

async function ensureGeo(): Promise<{ countryId: unknown; regionId: unknown; cityId: unknown }> {
  const country = await Country.findOneAndUpdate(
    { code: 'ES' },
    { $setOnInsert: { code: 'ES', name: 'Spain' } },
    UPSERT,
  );
  const region = await Region.findOneAndUpdate(
    { countryId: country._id, name: 'Catalonia' },
    { $setOnInsert: { countryId: country._id, name: 'Catalonia' } },
    UPSERT,
  );
  const city = await City.findOneAndUpdate(
    { regionId: region._id, name: 'Barcelona' },
    { $setOnInsert: { countryId: country._id, regionId: region._id, name: 'Barcelona' } },
    UPSERT,
  );
  return { countryId: country._id, regionId: region._id, cityId: city._id };
}

/**
 * An address, reused within a test.
 *
 * `Address.normalizedKey` is unique too — the canonical-address model refuses
 * two rows for the same door — so a test building several listings at the same
 * street shares one address rather than colliding on the second.
 */
export async function createAddress(): Promise<{ _id: unknown }> {
  const geo = await ensureGeo();
  const existing = await Address.findOne({ street: 'Carrer de Mallorca 100' });
  if (existing) return existing;
  return Address.create({
    ...geo,
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

export async function createRentProperty(
  options: CreatePropertyOptions,
): Promise<{ _id: unknown; oxyUserId: string; status: string; toJSON(): unknown }> {
  const address = await createAddress();
  return Property.create({
    oxyUserId: options.oxyUserId,
    addressId: address._id,
    type: PropertyType.APARTMENT,
    bedrooms: 2,
    bathrooms: 1,
    offerings: [OfferingType.LONG_TERM_RENT],
    longTermRent: { monthlyAmount: options.monthlyAmount ?? 1200, currency: 'EUR' },
    status: options.status ?? PropertyStatus.PUBLISHED,
  });
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
