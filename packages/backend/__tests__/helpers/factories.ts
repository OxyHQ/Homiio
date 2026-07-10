/**
 * Test data factories using real Mongoose models against in-memory Mongo.
 */

import { OfferingType, PropertyType, PropertyStatus } from '@homiio/shared-types';

const models = require('../../models');
const { Property, Address, Country, Region, City, Lease } = models;

let geoChain: { countryId: unknown; regionId: unknown; cityId: unknown } | null = null;

async function ensureGeo(): Promise<{ countryId: unknown; regionId: unknown; cityId: unknown }> {
  const country = await Country.create({ code: 'ES', name: 'Spain' });
  const region = await Region.create({ countryId: country._id, name: 'Catalonia' });
  const city = await City.create({ countryId: country._id, regionId: region._id, name: 'Barcelona' });
  geoChain = { countryId: country._id, regionId: region._id, cityId: city._id };
  return geoChain;
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
