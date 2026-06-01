/**
 * Property address serializer.
 *
 * A serialized Property exposes its building Address under `address` (the
 * populated `addressId`, renamed). Geo is relational, so the address only holds
 * `countryId` / `regionId` / `cityId` / `neighborhoodId` references — the
 * human-readable city/region/country NAMES live once on the geo docs.
 *
 * To let list/detail/search cards render a location label WITHOUT an N+1 lookup
 * per card, the property read controllers DEEP-populate those refs (selecting
 * only `name` / `code`). This serializer reads the populated names off the
 * `address`, attaches the derived display fields (`cityName` / `regionName` /
 * `countryName` / `neighborhoodName` / `location`), and FLATTENS each populated
 * geo ref back to its bare id — so the serialized contract stays exactly
 * "ids + resolved names" and a populated `{ _id, name }` never leaks as the
 * value of `cityId`.
 *
 * Idempotent and tolerant: an un-populated (bare-id) ref simply yields no name,
 * and re-running on an already-flattened address is a no-op.
 */

import { Types } from 'mongoose';
import type { AddressGeoNames } from '@homiio/shared-types';

/** A geo ref as found on a lean address: a bare id, a populated doc, or absent. */
type GeoRef =
  | Types.ObjectId
  | string
  | { _id?: unknown; name?: unknown }
  | null
  | undefined;

/** The geo-bearing subset of a serialized address this serializer reads/writes. */
interface SerializableAddress extends AddressGeoNames {
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

/** Reduce a ref to its bare id string (id form or populated `{ _id }`), or undefined. */
function idFromRef(ref: GeoRef): string | undefined {
  if (!ref) return undefined;
  if (ref instanceof Types.ObjectId) return ref.toString();
  if (typeof ref === 'string') return ref;
  if (typeof ref === 'object' && (ref as { _id?: unknown })._id !== undefined) {
    return String((ref as { _id: unknown })._id);
  }
  return undefined;
}

/**
 * Attach resolved geo display names to an address in place, then flatten its
 * populated geo refs back to bare ids. Safe to call on any address-like object
 * (bare-id or deep-populated); returns the same reference for chaining.
 */
export function attachAddressGeoNames<T extends SerializableAddress>(address: T | null | undefined): T | null | undefined {
  if (!address || typeof address !== 'object') return address;

  const cityName = nameFromRef(address.cityId);
  const regionName = nameFromRef(address.regionId);
  const countryName = nameFromRef(address.countryId);
  const neighborhoodName = nameFromRef(address.neighborhoodId);

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
export function serializePropertyAddresses<T extends { address?: SerializableAddress }>(
  properties: T | T[] | null | undefined,
): T | T[] | null | undefined {
  if (!properties) return properties;
  if (Array.isArray(properties)) {
    for (const property of properties) {
      if (property && property.address) attachAddressGeoNames(property.address);
    }
    return properties;
  }
  if (properties.address) attachAddressGeoNames(properties.address);
  return properties;
}

/**
 * The Mongoose populate spec that deep-populates an address's geo refs with just
 * the names/codes this serializer needs. Used wherever a property is read for
 * DISPLAY (list / detail / search / city-properties), so location names resolve
 * in the same query with no N+1.
 */
export const ADDRESS_GEO_POPULATE = {
  path: 'addressId',
  populate: [
    { path: 'cityId', select: 'name' },
    { path: 'regionId', select: 'name' },
    { path: 'countryId', select: 'name code' },
    { path: 'neighborhoodId', select: 'name' },
  ],
} as const;

export default { attachAddressGeoNames, serializePropertyAddresses, ADDRESS_GEO_POPULATE };
