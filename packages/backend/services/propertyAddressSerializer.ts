/**
 * Property address serializer.
 *
 * A serialized address exposes ids plus resolved geo NAMES: geo is relational,
 * so the address itself only holds `countryId` / `regionId` / `cityId` /
 * `neighborhoodId` references, and the human-readable city/region/country names
 * live once on the geo rows. This module derives the display fields
 * (`cityName` / `regionName` / `countryName` / `neighborhoodName` / `location`)
 * and guarantees each `*Id` serializes as a bare id string.
 *
 * ## It has to serve TWO input shapes right now, and that is temporary
 *
 * - **Joined (Postgres).** `addressService.selectAddressWithGeoNames` returns
 *   `city_id` and `cities.name` as two separate, already-flat values, so the
 *   names arrive pre-set on `cityName` / `regionName` / … and there is nothing
 *   to flatten. This is what the address endpoints now produce.
 * - **Populated (Mongo).** `properties` does not exist in Postgres (batch 3), so
 *   every property read is still a Mongoose query using
 *   {@link ADDRESS_GEO_POPULATE}, where `cityId` holds either an id or a
 *   `{ _id, name }` sub-document.
 *
 * Both are handled by ONE rule — "take the name off the ref when the ref carries
 * one, otherwise keep the name already on the address" — rather than by
 * branching on which store the row came from. When batch 4 moves the property
 * read to a join, the ref-reading half and {@link ADDRESS_GEO_POPULATE} go with
 * it and only the joined shape remains.
 */

import { Types } from 'mongoose';
import type { AddressGeoNames } from '@homiio/shared-types';

/** A geo ref as found on an address: a bare id, a populated doc, or absent. */
type GeoRef =
  | Types.ObjectId
  | string
  | { _id?: unknown; id?: unknown; name?: unknown }
  | null
  | undefined;

/** The geo-bearing subset of a serialized address this serializer reads/writes. */
export interface SerializableAddress extends AddressGeoNames {
  cityId?: GeoRef;
  regionId?: GeoRef;
  countryId?: GeoRef;
  neighborhoodId?: GeoRef;
}

/** Read a populated `{ name }` off a ref, or null when the ref is a bare id/absent. */
function nameFromRef(ref: GeoRef): string | null {
  if (
    ref &&
    typeof ref === 'object' &&
    !(ref instanceof Types.ObjectId) &&
    typeof (ref as { name?: unknown }).name === 'string'
  ) {
    return (ref as { name: string }).name;
  }
  return null;
}

/**
 * Reduce a ref to its bare id string, or undefined.
 *
 * Reads `id` before `_id` so a joined row and a populated Mongoose sub-document
 * both flatten, and neither spelling is assumed to be the only one.
 */
function idFromRef(ref: GeoRef): string | undefined {
  if (!ref) return undefined;
  if (ref instanceof Types.ObjectId) return ref.toString();
  if (typeof ref === 'string') return ref;
  if (typeof ref === 'object') {
    const record = ref as { _id?: unknown; id?: unknown };
    if (record.id !== undefined) return String(record.id);
    if (record._id !== undefined) return String(record._id);
  }
  return undefined;
}

/**
 * Attach resolved geo display names to an address in place, then flatten any
 * populated geo refs back to bare ids. Safe to call on any address-like object
 * (joined, bare-id or deep-populated); returns the same reference for chaining.
 */
export function attachAddressGeoNames<T extends SerializableAddress>(address: T | null | undefined): T | null | undefined {
  if (!address || typeof address !== 'object') return address;

  // A populated ref wins over a pre-set name because it is the fresher of the
  // two; a joined row has no ref name at all, so its pre-set names stand.
  const cityName = nameFromRef(address.cityId) ?? address.cityName ?? null;
  const regionName = nameFromRef(address.regionId) ?? address.regionName ?? null;
  const countryName = nameFromRef(address.countryId) ?? address.countryName ?? null;
  const neighborhoodName = nameFromRef(address.neighborhoodId) ?? address.neighborhoodName ?? null;

  if (cityName) address.cityName = cityName;
  if (regionName) address.regionName = regionName;
  if (countryName) address.countryName = countryName;
  if (neighborhoodName) address.neighborhoodName = neighborhoodName;

  const locationParts = [cityName, regionName, countryName].filter(
    (part): part is string => Boolean(part),
  );
  if (locationParts.length > 0) {
    address.location = locationParts.join(', ');
  }

  // Flatten populated refs back to ids so the serialized value of each `*Id`
  // stays an id string (never a `{ _id, name }` object).
  const flatCityId = idFromRef(address.cityId);
  const flatRegionId = idFromRef(address.regionId);
  const flatCountryId = idFromRef(address.countryId);
  const flatNeighborhoodId = idFromRef(address.neighborhoodId);
  if (flatCityId !== undefined) address.cityId = flatCityId;
  if (flatRegionId !== undefined) address.regionId = flatRegionId;
  if (flatCountryId !== undefined) address.countryId = flatCountryId;
  if (flatNeighborhoodId !== undefined) address.neighborhoodId = flatNeighborhoodId;

  return address;
}

/**
 * Apply {@link attachAddressGeoNames} to a property (or array of properties)
 * whose `address` has been deep-populated. Returns the input for chaining.
 */
export function serializePropertyAddresses<T extends { address?: unknown }>(
  properties: T | T[] | null | undefined,
): T | T[] | null | undefined {
  if (!properties) return properties;
  const apply = (p: T) => {
    // Address arrives as a Mixed/Loose-typed populated subdocument; we only
    // mutate the geo-ref fields it actually carries, so cast in at the boundary.
    if (p && p.address && typeof p.address === 'object') {
      attachAddressGeoNames(p.address as SerializableAddress);
    }
  };
  if (Array.isArray(properties)) {
    for (const property of properties) apply(property);
    return properties;
  }
  apply(properties);
  return properties;
}

/**
 * The Mongoose populate spec that deep-populates an address's geo refs with just
 * the names/codes this serializer needs.
 *
 * **Still Mongo, and still load-bearing.** Every property read is still a
 * Mongoose query, so removing this would strip the location label off every
 * property card. It dies with the property READ path in batch 4, replaced by the
 * join `addressService.selectAddressWithGeoNames` already performs for the
 * address endpoints.
 */
import type { PopulateOptions } from 'mongoose';

export const ADDRESS_GEO_POPULATE: PopulateOptions = {
  path: 'addressId',
  populate: [
    { path: 'cityId', select: 'name' },
    { path: 'regionId', select: 'name' },
    { path: 'countryId', select: 'name code' },
    { path: 'neighborhoodId', select: 'name' },
  ],
};

export default { attachAddressGeoNames, serializePropertyAddresses, ADDRESS_GEO_POPULATE };
