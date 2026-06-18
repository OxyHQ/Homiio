/**
 * Test data factories. They use the REAL Mongoose models from `models/index.ts`
 * against the in-memory Mongo started in `jest.setup.ts`, so persisted documents
 * exercise the same schemas, validators and hooks as production.
 */

import { OfferingType, ProfileType, PropertyType, PropertyStatus } from '@homiio/shared-types';

const models = require('../../models');
const { Profile, Property, Address, Country, Region, City, Lease } = models;

let geoChain: { countryId: unknown; regionId: unknown; cityId: unknown } | null = null;

/** Create (once per test, cleared between) a Country → Region → City chain. */
async function ensureGeo(): Promise<{ countryId: unknown; regionId: unknown; cityId: unknown }> {
  const country = await Country.create({ code: 'ES', name: 'Spain' });
  const region = await Region.create({ countryId: country._id, name: 'Catalonia' });
  const city = await City.create({ countryId: country._id, regionId: region._id, name: 'Barcelona' });
  geoChain = { countryId: country._id, regionId: region._id, cityId: city._id };
  return geoChain;
}

export async function createProfile(oxyUserId: string): Promise<{ _id: unknown; oxyUserId: string }> {
  return Profile.create({
    oxyUserId,
    profileType: ProfileType.PERSONAL,
    isActive: true,
    personalProfile: {},
  });
}

export async function createAddress(): Promise<{ _id: unknown }> {
  const geo = await ensureGeo();
  return Address.create({
    ...geo,
    countryCode: 'ES',
    street: 'Carrer de Mallorca 100',
    postal_code: '08013',
    coordinates: { type: 'Point', coordinates: [2.17, 41.39] },
  });
}

export interface CreatePropertyOptions {
  profileId: unknown;
  status?: string;
  monthlyAmount?: number;
}

export async function createRentProperty(
  options: CreatePropertyOptions,
): Promise<{ _id: unknown; profileId: unknown; status: string; toJSON(): unknown }> {
  const address = await createAddress();
  return Property.create({
    profileId: options.profileId,
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
  landlordProfileId: unknown;
  tenantProfileId: unknown;
  status?: string;
}

export async function createLease(
  options: CreateLeaseOptions,
): Promise<{ _id: unknown; status: string }> {
  const now = new Date();
  const end = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  return Lease.create({
    propertyId: options.propertyId,
    landlordProfileId: options.landlordProfileId,
    tenantProfileId: options.tenantProfileId,
    leaseTerms: { startDate: now, endDate: end },
    rentDetails: { monthlyRent: 1200, currency: 'EUR' },
    status: options.status ?? 'draft',
  });
}

export { models };
