/**
 * Geo Query Service
 *
 * Read-time translation of a human location query (city / region name or id)
 * into canonical geo ids, and from there into the set of Address ids in that
 * place. Every consumer that used to regex free-text `address.city` /
 * `address.state` now resolves through here, so location filtering is fully
 * relational and index-backed (City/Region → Address.cityId/regionId).
 *
 * `null` is returned when a filter value is present but matches no city/region
 * (the caller should treat that as "no results"), distinct from an empty filter
 * (no geo constraint at all), which the callers detect before calling.
 */

import { Types, type Model } from 'mongoose';

/** Minimal document shapes for the geo collections this service reads. */
interface CityGeoDoc { _id: Types.ObjectId; name: string }
interface RegionGeoDoc { _id: Types.ObjectId; name: string }
interface NeighborhoodGeoDoc { _id: Types.ObjectId; name: string; cityId: Types.ObjectId }
interface AddressGeoDoc {
  _id: Types.ObjectId;
  cityId: Types.ObjectId;
  regionId: Types.ObjectId;
  neighborhoodId?: Types.ObjectId;
  countryCode: string;
}

const registry = require('../models');
const City: Model<CityGeoDoc> = registry.City;
const Region: Model<RegionGeoDoc> = registry.Region;
const Neighborhood: Model<NeighborhoodGeoDoc> = registry.Neighborhood;
const Address: Model<AddressGeoDoc> = registry.Address;

export interface GeoFilterInput {
  /** City name or City `_id`. */
  city?: string;
  /** Region (province/state) name or Region `_id`. */
  state?: string;
  /** Neighborhood name or Neighborhood `_id` (scoped within the resolved city). */
  neighborhood?: string;
  /** ISO-2 country code. */
  countryCode?: string;
}

type IdLean = { _id: Types.ObjectId };

function asTrimmed(value: string | undefined): string | undefined {
  const t = value?.trim();
  return t && t.length > 0 ? t : undefined;
}

/** Resolve a city query (id or name) to a single City `_id`, or null if unknown. */
export async function resolveCityId(city: string): Promise<Types.ObjectId | null> {
  const value = asTrimmed(city);
  if (!value) return null;
  if (Types.ObjectId.isValid(value)) {
    const byId = await City.findById(value).select('_id').lean<IdLean | null>();
    if (byId) return byId._id;
  }
  const byName = await City.findOne({ name: new RegExp(`^${escapeRegExp(value)}$`, 'i') })
    .select('_id')
    .lean<IdLean | null>();
  return byName ? byName._id : null;
}

/** Resolve a region query (id or name) to a single Region `_id`, or null if unknown. */
export async function resolveRegionId(state: string): Promise<Types.ObjectId | null> {
  const value = asTrimmed(state);
  if (!value) return null;
  if (Types.ObjectId.isValid(value)) {
    const byId = await Region.findById(value).select('_id').lean<IdLean | null>();
    if (byId) return byId._id;
  }
  const byName = await Region.findOne({ name: new RegExp(`^${escapeRegExp(value)}$`, 'i') })
    .select('_id')
    .lean<IdLean | null>();
  return byName ? byName._id : null;
}

/** Escape a user string for safe use inside a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Resolve a city/state/neighborhood/countryCode filter to the set of Address
 * ids that satisfy ALL provided constraints.
 *
 * Returns:
 *  - `null` when at least one constraint was provided but resolved to nothing
 *    (unknown city/region → no addresses can match), and
 *  - an array of Address ids otherwise (possibly empty if the place exists but
 *    has no addresses yet).
 *
 * Callers that pass no constraint at all should not call this (they have no
 * narrowing to do); when every provided field is blank this returns `null`.
 */
export async function resolveGeoFilterAddressIds(input: GeoFilterInput): Promise<Types.ObjectId[] | null> {
  const addressFilter: Record<string, unknown> = {};
  let hasConstraint = false;

  const cityValue = asTrimmed(input.city);
  if (cityValue) {
    const cityId = await resolveCityId(cityValue);
    if (!cityId) return null;
    addressFilter.cityId = cityId;
    hasConstraint = true;
  }

  const stateValue = asTrimmed(input.state);
  if (stateValue) {
    const regionId = await resolveRegionId(stateValue);
    if (!regionId) return null;
    addressFilter.regionId = regionId;
    hasConstraint = true;
  }

  const countryCode = asTrimmed(input.countryCode);
  if (countryCode) {
    addressFilter.countryCode = countryCode.toUpperCase();
    hasConstraint = true;
  }

  const neighborhoodValue = asTrimmed(input.neighborhood);
  if (neighborhoodValue) {
    // Neighborhood is scoped to the resolved city when one was given.
    const neighborhoodFilter: Record<string, unknown> = {};
    if (Types.ObjectId.isValid(neighborhoodValue)) {
      neighborhoodFilter._id = new Types.ObjectId(neighborhoodValue);
    } else {
      neighborhoodFilter.name = new RegExp(`^${escapeRegExp(neighborhoodValue)}$`, 'i');
      if (addressFilter.cityId) neighborhoodFilter.cityId = addressFilter.cityId;
    }
    const neighborhood = await Neighborhood.findOne(neighborhoodFilter)
      .select('_id')
      .lean<IdLean | null>();
    if (!neighborhood) return null;
    addressFilter.neighborhoodId = neighborhood._id;
    hasConstraint = true;
  }

  if (!hasConstraint) return null;

  const addresses = await Address.find(addressFilter).select('_id').lean<IdLean[]>();
  return addresses.map((a) => a._id);
}

export default {
  resolveCityId,
  resolveRegionId,
  resolveGeoFilterAddressIds,
};
