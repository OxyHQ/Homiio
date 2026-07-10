/**
 * Geo Resolution Service
 *
 * The core of "own the external geo data". Given coordinates and/or place names,
 * this resolves the canonical DB-owned geo chain — Country → Region → City →
 * (Neighborhood) — and returns their `_id`s. The external geocoder (Nominatim)
 * is consulted at most ONCE per resolution (only to discover names when the
 * caller's names are incomplete); the resolved hierarchy is then UPSERTED into
 * our own collections so every request-time read hits OUR database, not the
 * live API.
 *
 * Idempotent & de-duped:
 *   - Country  by ISO-2 `code`
 *   - Region   by (`countryId`, `name`)
 *   - City     by (`regionId`, `name`)
 *   - Neighborhood by (`cityId`, `name`)
 * Re-resolving the same place returns the same ids and creates no duplicate rows.
 *
 * A small in-memory cache short-circuits repeated resolutions of the same
 * coordinate/name within the process lifetime (the underlying geocoder also
 * caches), keeping us well within the OSM usage policy.
 */

import type { Model, Types } from 'mongoose';
import { reverseGeocode, forwardGeocode, type AddressData } from './geocodingService';
import { countryNameToCode, countryCodeToName, defaultCurrencyForCountry } from '../utils/countryData';
import { sanitizeGeoJsonCoordinates } from '../utils/geoCoordinates';

/** Resolved geo id chain returned to callers (Address stores these). */
export interface ResolvedGeo {
  countryId: Types.ObjectId;
  regionId: Types.ObjectId;
  cityId: Types.ObjectId;
  neighborhoodId?: Types.ObjectId;
  /** ISO-2 country code, denormalized onto the Address for fast filtering. */
  countryCode: string;
}

/** Names the caller already knows (any subset). Missing pieces are geocoded. */
export interface GeoNames {
  city?: string;
  /** Region / province / state / autonomous community. */
  state?: string;
  country?: string;
  countryCode?: string;
  neighborhood?: string;
}

export interface ResolveGeoInput {
  /** [longitude, latitude], GeoJSON order. */
  coordinates?: [number, number];
  names?: GeoNames;
}

export class GeoResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeoResolutionError';
  }
}

// ---- Models (resolved lazily so this module loads before model registration) ----
function models(): {
  Country: Model<CountryDoc>;
  Region: Model<RegionDoc>;
  City: Model<CityDoc>;
  Neighborhood: Model<NeighborhoodDoc>;
} {
  // `require` here (not a top-level import) so the geo models are read from the
  // central registry AFTER `models/index.ts` has registered them, avoiding a
  // load-order cycle (Address → geoResolutionService → models/index → Address).
  const registry = require('../models');
  return {
    Country: registry.Country,
    Region: registry.Region,
    City: registry.City,
    Neighborhood: registry.Neighborhood,
  };
}

interface CountryDoc {
  _id: Types.ObjectId;
  code: string;
  name: string;
  currency: string;
}
interface RegionDoc {
  _id: Types.ObjectId;
  countryId: Types.ObjectId;
  name: string;
}
interface CityDoc {
  _id: Types.ObjectId;
  regionId: Types.ObjectId;
  countryId: Types.ObjectId;
  name: string;
  coordinates?: { lat?: number; lng?: number };
}
interface NeighborhoodDoc {
  _id: Types.ObjectId;
  cityId: Types.ObjectId;
  name: string;
}

/** Placeholder name for a missing administrative level, kept stable so the
 *  fallback row is reused rather than duplicated. */
const UNKNOWN_REGION = 'Unknown';

// ---- Resolution cache (fast path; geocoder has its own cache too) ----
const RESOLUTION_CACHE_MAX = 1000;
const resolutionCache = new Map<string, ResolvedGeo>();

function readResolutionCache(key: string): ResolvedGeo | null {
  return resolutionCache.get(key) ?? null;
}

function writeResolutionCache(key: string, value: ResolvedGeo): void {
  if (resolutionCache.size >= RESOLUTION_CACHE_MAX) {
    const oldest = resolutionCache.keys().next().value;
    if (oldest !== undefined) resolutionCache.delete(oldest);
  }
  resolutionCache.set(key, value);
}

/** A stable cache key for a resolution request. */
function cacheKeyFor(input: ResolveGeoInput): string {
  const coordKey = input.coordinates
    ? `${input.coordinates[0].toFixed(5)},${input.coordinates[1].toFixed(5)}`
    : '';
  const n = input.names ?? {};
  const nameKey = [n.country, n.countryCode, n.state, n.city, n.neighborhood]
    .map((v) => (v ?? '').trim().toLowerCase())
    .join('|');
  return `${coordKey}#${nameKey}`;
}

/** True once a name set has every field we need to skip the geocoder. */
function namesAreComplete(names: GeoNames | undefined): names is Required<Pick<GeoNames, 'city' | 'state'>> & GeoNames {
  if (!names) return false;
  const hasCountry = Boolean(names.countryCode || names.country);
  return Boolean(names.city && names.state && hasCountry);
}

/** Merge geocoder output into caller-supplied names (caller wins). */
function mergeNames(provided: GeoNames | undefined, geocoded: AddressData | undefined): GeoNames {
  return {
    city: provided?.city || geocoded?.city || undefined,
    state: provided?.state || geocoded?.state || undefined,
    country: provided?.country || geocoded?.country || undefined,
    countryCode: provided?.countryCode || undefined,
    neighborhood: provided?.neighborhood || geocoded?.neighborhood || undefined,
  };
}

/** Resolve an ISO-2 country code + canonical country name from the merged names. */
function resolveCountryCodeAndName(names: GeoNames): { code: string; name: string } {
  const explicitCode = names.countryCode?.trim().toUpperCase();
  if (explicitCode && /^[A-Z]{2}$/.test(explicitCode)) {
    return { code: explicitCode, name: names.country?.trim() || countryCodeToName(explicitCode) || explicitCode };
  }
  const fromName = names.country ? countryNameToCode(names.country) : undefined;
  if (fromName) {
    return { code: fromName, name: names.country?.trim() || countryCodeToName(fromName) || fromName };
  }
  throw new GeoResolutionError('Unable to resolve a country (no countryCode and unrecognised country name)');
}

// ---- Idempotent upserts (each returns the canonical doc id) ----

async function upsertCountry(code: string, name: string): Promise<Types.ObjectId> {
  const { Country } = models();
  const currency = defaultCurrencyForCountry(code);
  const doc = await Country.findOneAndUpdate(
    { code },
    { $setOnInsert: { code, name, currency, isActive: true } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return doc._id;
}

async function upsertRegion(countryId: Types.ObjectId, name: string): Promise<Types.ObjectId> {
  const { Region } = models();
  const doc = await Region.findOneAndUpdate(
    { countryId, name },
    { $setOnInsert: { countryId, name, isActive: true } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return doc._id;
}

async function upsertCity(
  regionId: Types.ObjectId,
  countryId: Types.ObjectId,
  name: string,
  countryCode: string,
  coordinates?: [number, number]
): Promise<Types.ObjectId> {
  const { City } = models();
  const setOnInsert: Record<string, unknown> = {
    regionId,
    countryId,
    name,
    currency: defaultCurrencyForCountry(countryCode),
    isActive: true,
  };
  if (coordinates) {
    const sanitized = sanitizeGeoJsonCoordinates(coordinates);
    if (sanitized) {
      setOnInsert.coordinates = { lng: sanitized[0], lat: sanitized[1] };
    }
  }
  const doc = await City.findOneAndUpdate(
    { regionId, name },
    { $setOnInsert: setOnInsert },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return doc._id;
}

async function upsertNeighborhood(
  cityId: Types.ObjectId,
  name: string,
  centroid?: [number, number]
): Promise<Types.ObjectId> {
  const { Neighborhood } = models();
  const setOnInsert: Record<string, unknown> = { cityId, name, isActive: true };
  if (centroid) {
    setOnInsert.centroid = { lng: centroid[0], lat: centroid[1] };
  }
  const doc = await Neighborhood.findOneAndUpdate(
    { cityId, name },
    { $setOnInsert: setOnInsert },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return doc._id;
}

/**
 * Resolve the canonical geo id chain for a place, upserting any missing
 * Country/Region/City/Neighborhood rows. The geocoder is consulted at most once
 * (only when the caller's names are incomplete and coordinates are available).
 *
 * @throws GeoResolutionError when neither names nor coordinates yield a city.
 */
export async function resolveGeo(input: ResolveGeoInput): Promise<ResolvedGeo> {
  const cacheKey = cacheKeyFor(input);
  const cached = readResolutionCache(cacheKey);
  if (cached) return cached;

  // 1) Discover names. Use caller-supplied names; geocode only to fill gaps.
  let names = input.names;
  if (!namesAreComplete(names) && input.coordinates) {
    const [lng, lat] = input.coordinates;
    const geocoded = await reverseGeocode(lng, lat);
    names = mergeNames(names, geocoded.success ? geocoded.data : undefined);
  } else if (!namesAreComplete(names) && names?.city) {
    // No coordinates but a partial name set with a city — try a forward lookup
    // to enrich region/country (best-effort; failures fall through to defaults).
    const query = [names.city, names.state, names.country].filter(Boolean).join(', ');
    const geocoded = await forwardGeocode(query);
    names = mergeNames(names, geocoded.success ? geocoded.data : undefined);
  }

  if (!names?.city) {
    throw new GeoResolutionError('Unable to resolve a city for the provided coordinates/names');
  }

  // 2) Country (canonical code + name).
  const { code: countryCode, name: countryName } = resolveCountryCodeAndName(names);
  const countryId = await upsertCountry(countryCode, countryName);

  // 3) Region — fall back to a stable placeholder so the chain is always whole.
  const regionName = names.state?.trim() || UNKNOWN_REGION;
  const regionId = await upsertRegion(countryId, regionName);

  // 4) City.
  const cityId = await upsertCity(regionId, countryId, names.city.trim(), countryCode, input.coordinates);

  // 5) Neighborhood (optional).
  let neighborhoodId: Types.ObjectId | undefined;
  if (names.neighborhood?.trim()) {
    neighborhoodId = await upsertNeighborhood(cityId, names.neighborhood.trim(), input.coordinates);
  }

  const resolved: ResolvedGeo = { countryId, regionId, cityId, neighborhoodId, countryCode };
  writeResolutionCache(cacheKey, resolved);
  return resolved;
}

export default { resolveGeo };
