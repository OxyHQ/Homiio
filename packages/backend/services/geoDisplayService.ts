/**
 * Geo Display Service
 *
 * Resolves the human-readable geo labels (city / region / country names) for a
 * building Address whose administrative geo is stored relationally. The names
 * live ONCE on the Country / Region / City / Neighborhood docs; this helper
 * reads them from a populated ref when present, and otherwise fetches them by id
 * (batched, de-duped). Used by display-only consumers (Telegram messages, AI
 * context, diagnostic payloads) that need names, not ids.
 */

import { Types, type Model } from 'mongoose';

interface NamedGeoDoc { _id: Types.ObjectId; name: string }
interface CountryGeoDoc { _id: Types.ObjectId; name: string; code: string }

const registry = require('../models');
const Country: Model<CountryGeoDoc> = registry.Country;
const Region: Model<NamedGeoDoc> = registry.Region;
const City: Model<NamedGeoDoc> = registry.City;
const Neighborhood: Model<NamedGeoDoc> = registry.Neighborhood;

/** A geo ref as found on an Address: an id, a populated doc, or absent. */
type GeoRef = Types.ObjectId | string | { _id?: unknown; name?: unknown; code?: unknown } | null | undefined;

/** The geo-bearing subset of an Address this service reads. */
export interface AddressGeoLike {
  cityId?: GeoRef;
  regionId?: GeoRef;
  countryId?: GeoRef;
  neighborhoodId?: GeoRef;
  countryCode?: string;
}

/** Resolved display labels for an address. Any field may be null when unknown. */
export interface GeoDisplay {
  city: string | null;
  region: string | null;
  country: string | null;
  neighborhood: string | null;
  countryCode: string | null;
}

/** Read a populated `{ name }` off a ref, or null when the ref is a bare id/absent. */
function nameFromPopulatedRef(ref: GeoRef): string | null {
  if (ref && typeof ref === 'object' && !(ref instanceof Types.ObjectId) && typeof ref.name === 'string') {
    return ref.name;
  }
  return null;
}

/** Read a bare id off a ref (id form or populated `{ _id }`), or null. */
function idFromRef(ref: GeoRef): Types.ObjectId | null {
  if (!ref) return null;
  if (ref instanceof Types.ObjectId) return ref;
  if (typeof ref === 'string') return Types.ObjectId.isValid(ref) ? new Types.ObjectId(ref) : null;
  if (typeof ref === 'object' && ref._id) {
    const raw = ref._id;
    if (raw instanceof Types.ObjectId) return raw;
    if (typeof raw === 'string' && Types.ObjectId.isValid(raw)) return new Types.ObjectId(raw);
  }
  return null;
}

async function nameById(model: Model<NamedGeoDoc>, ref: GeoRef): Promise<string | null> {
  const populated = nameFromPopulatedRef(ref);
  if (populated) return populated;
  const id = idFromRef(ref);
  if (!id) return null;
  const doc = await model.findById(id).select('name').lean<NamedGeoDoc | null>();
  return doc ? doc.name : null;
}

async function countryName(ref: GeoRef): Promise<string | null> {
  const populated = nameFromPopulatedRef(ref);
  if (populated) return populated;
  const id = idFromRef(ref);
  if (!id) return null;
  const doc = await Country.findById(id).select('name').lean<CountryGeoDoc | null>();
  return doc ? doc.name : null;
}

/**
 * Resolve `{ city, region, country, neighborhood, countryCode }` display names
 * for an Address. Populated refs are used as-is; un-populated ids are fetched.
 */
export async function resolveAddressDisplay(address: AddressGeoLike | null | undefined): Promise<GeoDisplay> {
  if (!address) {
    return { city: null, region: null, country: null, neighborhood: null, countryCode: null };
  }
  const [city, region, country, neighborhood] = await Promise.all([
    nameById(City, address.cityId),
    nameById(Region, address.regionId),
    countryName(address.countryId),
    nameById(Neighborhood, address.neighborhoodId),
  ]);
  return {
    city,
    region,
    country,
    neighborhood,
    countryCode: address.countryCode ? address.countryCode.toUpperCase() : null,
  };
}

export default { resolveAddressDisplay };
