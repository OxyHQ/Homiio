/**
 * Nearby-services lookup service.
 *
 * Reports, for a fixed set of everyday-amenity categories (pharmacy, school,
 * supermarket, transit, …), whether each is NEAR a coordinate — presence, count
 * and the straight-line distance to the nearest one — sourced from
 * OpenStreetMap's Overpass API.
 *
 * Overpass is free and requires no API key, but (like Nominatim) it is rate
 * limited and its usage policy mandates a descriptive User-Agent and polite,
 * low-volume usage. We therefore mirror `geocodingService`:
 *   - send the configured User-Agent on every call,
 *   - issue a SINGLE union query per coordinate (all categories at once),
 *   - cache results in-memory keyed by rounded coordinates + radius with a long
 *     TTL (POIs change slowly), and
 *   - abort + degrade gracefully on timeout/failure instead of throwing.
 *
 * The result is deliberately aggregate-only (presence/count/nearest distance)
 * and never carries individual place names.
 *
 * @see https://wiki.openstreetmap.org/wiki/Overpass_API
 * @see https://operations.osmfoundation.org/policies/
 */

import type {
  NearbyServiceKey,
  NearbyServiceCategory,
  PropertyNearbyServices,
} from '@homiio/shared-types';
import config from '../config';
import { Logger } from '../utils/logger';

const logger = new Logger('NearbyServicesService');

/** Default search radius, in metres, around the property's coordinates. */
export const RADIUS_M = 1000;

const EARTH_RADIUS_M = 6_371_000;
const DEGREES_IN_HALF_CIRCLE = 180;

const COORD_BOUNDS = {
  minLongitude: -180,
  maxLongitude: 180,
  minLatitude: -90,
  maxLatitude: 90,
} as const;

const CACHE = {
  maxEntries: 500,
  ttlMs: 24 * 60 * 60 * 1000, // 24h — nearby POIs are stable over a day.
} as const;

/**
 * Decimal places the cache key rounds coordinates to. 3 decimals ≈ 110 m, so
 * two lookups whose coordinates land in the same ~110 m cell share a cached
 * result — coarse enough to get real cache hits across a building/street, fine
 * enough that the served result is still representative of the location.
 */
const CACHE_COORD_DECIMALS = 3;

/** Overpass server-side timeout (seconds) embedded in the query setting. */
const OVERPASS_QUERY_TIMEOUT_S = 8;
/**
 * Client-side abort budget (ms). Slightly larger than the server-side timeout
 * so Overpass gets the chance to honour its own `[timeout:…]` first; the
 * AbortController is the hard ceiling that guards against a hung connection.
 */
const OVERPASS_ABORT_MS = (OVERPASS_QUERY_TIMEOUT_S + 2) * 1000;

/**
 * Overpass tag filters per category. Each string is a single Overpass tag
 * selector (e.g. `amenity=pharmacy` or `amenity~"hospital|clinic|doctors"`);
 * a category matches an element if ANY of its selectors match. Selectors map
 * directly onto Overpass QL clauses, so adding a category is purely additive.
 */
const CATEGORY_TAG_FILTERS: Record<NearbyServiceKey, readonly string[]> = {
  pharmacy: ['amenity=pharmacy'],
  school: ['amenity=school'],
  hospital: ['amenity~"hospital|clinic|doctors"'],
  police: ['amenity=police'],
  fire_station: ['amenity=fire_station'],
  supermarket: ['shop~"supermarket|convenience"'],
  transit: ['highway=bus_stop', 'railway~"station|tram_stop"', 'public_transport=station'],
  park: ['leisure=park'],
  bank: ['amenity~"bank|atm"'],
  restaurant: ['amenity~"restaurant|cafe"'],
  gym: ['leisure~"fitness_centre|sports_centre"'],
  spa: ['leisure=spa', 'shop=massage'],
} as const;

/** Stable ordering for the returned categories (and for query generation). */
const CATEGORY_KEYS = Object.keys(CATEGORY_TAG_FILTERS) as NearbyServiceKey[];

/** A point distilled from an Overpass element, with its category. */
interface CategorizedPoint {
  key: NearbyServiceKey;
  lat: number;
  lon: number;
}

/** Subset of an Overpass element we consume (node, or way/relation w/ center). */
interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  /** Present on ways/relations when the query uses `out center`. */
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements?: OverpassElement[];
}

interface CacheEntry {
  categories: NearbyServiceCategory[];
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

const cacheKey = (longitude: number, latitude: number, radiusM: number): string => {
  const lon = longitude.toFixed(CACHE_COORD_DECIMALS);
  const lat = latitude.toFixed(CACHE_COORD_DECIMALS);
  return `${lat},${lon}@${radiusM}`;
};

const readCache = (key: string): NearbyServiceCategory[] | null => {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.categories;
};

const writeCache = (key: string, categories: NearbyServiceCategory[]): void => {
  if (cache.size >= CACHE.maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(key, { categories, expiresAt: Date.now() + CACHE.ttlMs });
};

const toRadians = (degrees: number): number => (degrees * Math.PI) / DEGREES_IN_HALF_CIRCLE;

/**
 * Great-circle (haversine) distance in metres between two lat/lon points.
 * Used to compute the distance from the property to each candidate place.
 */
const haversineMeters = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const a =
    sinLat * sinLat +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * sinLon * sinLon;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
};

/**
 * Build the single Overpass QL query covering every category within `radiusM`
 * of the point. Each tag selector becomes a `nwr(around:R,lat,lon)[selector];`
 * clause inside one union; `out center;` makes ways/relations carry a
 * representative `center` so their distance is computable like a node's.
 */
const buildOverpassQuery = (longitude: number, latitude: number, radiusM: number): string => {
  const clauses = CATEGORY_KEYS.flatMap((key) =>
    CATEGORY_TAG_FILTERS[key].map(
      (selector) => `nwr(around:${radiusM},${latitude},${longitude})[${selector}];`
    )
  ).join('');
  return `[out:json][timeout:${OVERPASS_QUERY_TIMEOUT_S}];(${clauses});out center;`;
};

const overpassHeaders = (): Record<string, string> => ({
  'User-Agent': config.overpass.userAgent,
  'Content-Type': 'application/x-www-form-urlencoded',
  Accept: 'application/json',
});

/** Resolve an element's representative coordinate (node lat/lon or way center). */
const elementCoord = (el: OverpassElement): { lat: number; lon: number } | null => {
  if (typeof el.lat === 'number' && typeof el.lon === 'number') {
    return { lat: el.lat, lon: el.lon };
  }
  if (el.center && typeof el.center.lat === 'number' && typeof el.center.lon === 'number') {
    return { lat: el.center.lat, lon: el.center.lon };
  }
  return null;
};

/** True when element `tags` satisfy one of a category's tag selectors. */
const matchesSelector = (tags: Record<string, string>, selector: string): boolean => {
  // Selector is either `key=value` or `key~"a|b|c"` (regex alternation).
  const regexMatch = selector.match(/^([\w:]+)~"(.+)"$/);
  if (regexMatch) {
    const [, tagKey, pattern] = regexMatch;
    const value = tags[tagKey];
    if (value === undefined) return false;
    return new RegExp(`^(?:${pattern})$`).test(value);
  }
  const eqMatch = selector.match(/^([\w:]+)=(.+)$/);
  if (eqMatch) {
    const [, tagKey, expected] = eqMatch;
    return tags[tagKey] === expected;
  }
  return false;
};

/**
 * Assign an Overpass element to the FIRST category whose selectors it matches.
 * First-match keeps each element in a single bucket so counts never
 * double-count an element that happens to satisfy two categories.
 */
const classifyElement = (el: OverpassElement): CategorizedPoint | null => {
  const tags = el.tags;
  if (!tags) return null;
  const coord = elementCoord(el);
  if (!coord) return null;
  for (const key of CATEGORY_KEYS) {
    if (CATEGORY_TAG_FILTERS[key].some((selector) => matchesSelector(tags, selector))) {
      return { key, lat: coord.lat, lon: coord.lon };
    }
  }
  return null;
};

/**
 * Reduce Overpass elements to one `NearbyServiceCategory` per key (always all
 * keys, in `CATEGORY_KEYS` order), computing count and nearest distance from
 * the property to each matched element.
 */
const buildCategories = (
  elements: OverpassElement[],
  longitude: number,
  latitude: number
): NearbyServiceCategory[] => {
  const counts = new Map<NearbyServiceKey, number>();
  const nearest = new Map<NearbyServiceKey, number>();

  for (const el of elements) {
    const point = classifyElement(el);
    if (!point) continue;
    const distance = haversineMeters(latitude, longitude, point.lat, point.lon);
    counts.set(point.key, (counts.get(point.key) ?? 0) + 1);
    const currentNearest = nearest.get(point.key);
    if (currentNearest === undefined || distance < currentNearest) {
      nearest.set(point.key, distance);
    }
  }

  return CATEGORY_KEYS.map((key) => {
    const count = counts.get(key) ?? 0;
    const nearestM = nearest.get(key);
    return {
      key,
      present: count > 0,
      count,
      nearestM: nearestM === undefined ? null : Math.round(nearestM),
    };
  });
};

/** All categories with `present: false` — the empty/degraded baseline. */
const emptyCategories = (): NearbyServiceCategory[] =>
  CATEGORY_KEYS.map((key) => ({ key, present: false, count: 0, nearestM: null }));

/**
 * A fully degraded snapshot: every category absent, `partial: true`. Exposed so
 * callers (e.g. a coordinate-less property) can return the all-absent payload
 * without re-listing the category keys.
 */
export function emptyNearbyServices(radiusM: number = RADIUS_M): PropertyNearbyServices {
  return { radiusM, categories: emptyCategories(), partial: true };
}

/** Query Overpass once and parse its elements; throws on transport/HTTP error. */
const fetchOverpassElements = async (
  longitude: number,
  latitude: number,
  radiusM: number
): Promise<OverpassElement[]> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OVERPASS_ABORT_MS);
  try {
    const query = buildOverpassQuery(longitude, latitude, radiusM);
    const response = await fetch(config.overpass.apiUrl, {
      method: 'POST',
      headers: overpassHeaders(),
      body: new URLSearchParams({ data: query }).toString(),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Overpass API error: ${response.status} ${response.statusText}`);
    }
    const payload = (await response.json()) as OverpassResponse;
    return Array.isArray(payload.elements) ? payload.elements : [];
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Return the nearby-services snapshot for a coordinate.
 *
 * Never throws: on Overpass timeout/failure it returns `partial: true` with
 * cached categories when available, otherwise an all-absent baseline. A
 * successful lookup is cached (keyed by rounded coordinates + radius) for
 * `CACHE.ttlMs`.
 *
 * @param longitude - Longitude ([-180, 180]), GeoJSON order.
 * @param latitude  - Latitude ([-90, 90]).
 * @param radiusM   - Search radius in metres (defaults to {@link RADIUS_M}).
 */
export async function getNearbyServices(
  longitude: number,
  latitude: number,
  radiusM: number = RADIUS_M
): Promise<PropertyNearbyServices> {
  if (
    longitude < COORD_BOUNDS.minLongitude ||
    longitude > COORD_BOUNDS.maxLongitude ||
    latitude < COORD_BOUNDS.minLatitude ||
    latitude > COORD_BOUNDS.maxLatitude ||
    Number.isNaN(longitude) ||
    Number.isNaN(latitude)
  ) {
    // Invalid coordinates can never produce a real result; degrade rather than
    // call Overpass with garbage.
    return { radiusM, categories: emptyCategories(), partial: true };
  }

  const key = cacheKey(longitude, latitude, radiusM);
  const cached = readCache(key);
  if (cached) {
    return { radiusM, categories: cached, partial: false };
  }

  try {
    const elements = await fetchOverpassElements(longitude, latitude, radiusM);
    const categories = buildCategories(elements, longitude, latitude);
    writeCache(key, categories);
    return { radiusM, categories, partial: false };
  } catch (error) {
    // Overpass is rate-limited and occasionally slow; a failure here is
    // expected operationally, so log it and degrade instead of surfacing a 5xx.
    logger.warn('Overpass lookup failed; returning degraded nearby-services result', {
      message: error instanceof Error ? error.message : String(error),
      longitude,
      latitude,
      radiusM,
    });
    const stale = readCache(key);
    return {
      radiusM,
      categories: stale ?? emptyCategories(),
      partial: true,
    };
  }
}

export default { getNearbyServices, emptyNearbyServices, RADIUS_M };
