/**
 * Geo Display Service
 *
 * Resolves the human-readable geo labels (city / region / country / neighborhood
 * names) for a building address whose administrative geo is stored relationally.
 * The names live ONCE on the country / region / city / neighborhood rows; this
 * helper reads them from an already-resolved value when the caller has one, and
 * otherwise fetches them by id. Used by display-only consumers (Telegram
 * messages, AI context, diagnostic payloads) that need names, not ids.
 *
 * ## Why this still issues up to four lookups
 *
 * Its call sites (Telegram, the AI route) hand over an address OBJECT they
 * already hold, not an address id; a name already resolved on that object is
 * used as-is, and only a bare id is fetched. Given an address id, all four names
 * come back from one join — `addressController` does exactly that for its own
 * reads, in `addressService.selectAddressWithGeoNames`.
 */

import { eq } from 'drizzle-orm';

import { getDb } from '../db/postgres';
import { cities, countries, neighborhoods, regions } from '../db/schema';

/**
 * A geo ref as found on an address-like object: an id, an already-resolved
 * `{ name }`, or absent.
 */
type GeoRef = string | { id?: unknown; name?: unknown; code?: unknown } | null | undefined;

/** The geo-bearing subset of an address this service reads. */
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

const EMPTY_DISPLAY: GeoDisplay = {
  city: null,
  region: null,
  country: null,
  neighborhood: null,
  countryCode: null,
};

/** Read an already-resolved `{ name }` off a ref, or null when it is a bare id. */
function nameFromResolvedRef(ref: GeoRef): string | null {
  if (ref && typeof ref === 'object' && typeof ref.name === 'string') return ref.name;
  return null;
}

/** Read a bare id off a ref (id form or resolved `{ id }`), or null. */
function idFromRef(ref: GeoRef): string | null {
  if (!ref) return null;
  if (typeof ref === 'string') return ref;
  if (typeof ref === 'object' && typeof ref.id === 'string') return ref.id;
  return null;
}

/** One name by id, or null. */
async function nameById(
  table: typeof cities | typeof regions | typeof countries | typeof neighborhoods,
  ref: GeoRef,
): Promise<string | null> {
  const resolved = nameFromResolvedRef(ref);
  if (resolved) return resolved;
  const id = idFromRef(ref);
  if (!id) return null;
  const rows = await getDb()
    .select({ name: table.name })
    .from(table)
    .where(eq(table.id, id))
    .limit(1);
  return rows[0]?.name ?? null;
}

/**
 * Resolve `{ city, region, country, neighborhood, countryCode }` display names
 * for an address-like object carrying geo REFS.
 *
 * Prefer {@link resolveAddressDisplayById} where the caller has an address id —
 * it is one statement instead of four. This entry point exists for callers that
 * hold a partially resolved address object rather than its id.
 */
export async function resolveAddressDisplay(
  address: AddressGeoLike | null | undefined,
): Promise<GeoDisplay> {
  if (!address) return EMPTY_DISPLAY;
  const [city, region, country, neighborhood] = await Promise.all([
    nameById(cities, address.cityId),
    nameById(regions, address.regionId),
    nameById(countries, address.countryId),
    nameById(neighborhoods, address.neighborhoodId),
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
