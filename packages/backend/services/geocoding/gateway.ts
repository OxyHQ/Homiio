/**
 * The geo gateway: the only thing in Homiio that asks a geocoder a question on
 * behalf of a person.
 *
 * It owns caching, the fallback decision, the public DTO and — most
 * importantly — the rule that a provider failure stays a failure. Every
 * operation here either returns data or throws a typed error; none of them ever
 * answers "nothing found" because the network was unavailable.
 */

import { and, count, eq, isNotNull, max, min } from 'drizzle-orm';
import {
  isFramablePlace,
  parseLocationToken,
  boundsCenter,
  type GeoBounds,
  type GeoPlace,
  type LocationRef,
  type PlaceGeometry,
  type PlaceSource,
} from '@homiio/shared-types';

import { getDb } from '../../db/postgres';
import { cities, countries, neighborhoods, regions } from '../../db/schema';
import {
  autocompleteCacheKey,
  GEO_CACHE_TTL_MS,
  readGeoCache,
  resolveCacheKey,
  reverseCacheKey,
  writeGeoCache,
} from './cache';
import { toGeoPlace } from './normalize';
import { providerById, withFallback } from './registry';
import {
  GeocodingProviderError,
  type ProviderAttribution,
  type ProviderPlace,
} from './types';
import type { ParsedPoint, RequestablePlaceType } from './validation';

/**
 * A `loc` token that is well-formed but names no place to look up.
 *
 * `bbox.`, `at.` and `here.` carry their own geometry and describe an area or a
 * device fix; `multi.` is several of those at once. Resolving them is not
 * "failing to find a place", so answering 404 would assert something false —
 * that a place the caller named does not exist. This is a distinct, typed
 * refusal instead.
 */
export class LocNotResolvableError extends Error {
  readonly locKind: string;

  constructor(locKind: string) {
    super(`loc token of kind "${locKind}" carries its own geometry and resolves to no place`);
    this.name = 'LocNotResolvableError';
    this.locKind = locKind;
  }
}

/** A `loc` token that does not parse at all. */
export class LocMalformedError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`loc token is not valid: ${reason}`);
    this.name = 'LocMalformedError';
    this.reason = reason;
  }
}

export interface GatewayMeta {
  /** True when a later provider answered because the preferred one failed. */
  readonly degraded: boolean;
  readonly cacheHit: boolean;
  /** Absent when the cache served the request. */
  readonly providerId?: string;
  /** What the surface rendering these results is required to display. */
  readonly attribution?: ProviderAttribution;
}

export interface SearchResult extends GatewayMeta {
  readonly candidates: GeoPlace[];
}

export interface PlaceResult extends GatewayMeta {
  readonly place: GeoPlace | null;
}

export interface SearchOptions {
  readonly query: string;
  readonly language: string;
  readonly limit: number;
  readonly countryCode?: string;
  readonly types?: readonly RequestablePlaceType[];
  readonly near?: ParsedPoint;
  readonly signal?: AbortSignal;
}

/**
 * Candidates matching a typed query. ALWAYS a list, never one auto-picked
 * result (ADR §14.1).
 *
 * Auto-picking is the homonym bug: there are two cities called Barcelona, and a
 * gateway that returns the first one silently sends somebody's search to
 * Venezuela. The list is also what makes the picker's `disambiguating` state
 * possible at all.
 */
export async function searchPlaces(options: SearchOptions): Promise<SearchResult> {
  const key = autocompleteCacheKey({
    query: options.query,
    language: options.language,
    limit: options.limit,
    ...(options.countryCode === undefined ? {} : { countryCode: options.countryCode }),
    ...(options.types === undefined ? {} : { types: options.types }),
    ...(options.near === undefined ? {} : { near: options.near }),
  });

  const cached = readGeoCache<GeoPlace[]>(key);
  if (cached) {
    return { candidates: cached, degraded: false, cacheHit: true };
  }

  const outcome = await withFallback((provider) =>
    provider
      .autocomplete({
        query: options.query,
        language: options.language,
        limit: options.limit,
        ...(options.countryCode === undefined ? {} : { countryCode: options.countryCode }),
        ...(options.near === undefined ? {} : { near: options.near }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
      .then((places) => ({ places, attribution: provider.attribution })),
  );

  const candidates = filterByType(toGeoPlaces(outcome.value.places), options.types).slice(
    0,
    options.limit,
  );

  // Only successes are cached, and an empty list IS a success here: a bounded
  // negative entry absorbs somebody hammering a misspelling. It is short-lived
  // precisely so a provider finishing an import becomes visible almost at once.
  writeGeoCache(
    key,
    candidates,
    candidates.length > 0 ? GEO_CACHE_TTL_MS.autocomplete : GEO_CACHE_TTL_MS.negative,
  );

  return {
    candidates,
    degraded: outcome.degraded,
    cacheHit: false,
    providerId: outcome.providerId,
    attribution: outcome.value.attribution,
  };
}

/**
 * Resolve a `loc` token to the place it names, or `null` if it names none.
 *
 * Never a fallback (ADR §14.1). For an external token the ref belongs to ONE
 * provider — `osm`'s `R349036` means nothing to anybody else — so asking a
 * second provider would either fail or, far worse, return a DIFFERENT place
 * under the identity the caller asked for.
 */
export async function resolvePlace(
  token: string,
  language: string,
  signal?: AbortSignal,
): Promise<PlaceResult> {
  const parsed = parseLocationToken(token);
  if (!parsed.ok) throw new LocMalformedError(parsed.reason);

  const ref: LocationRef = parsed.value;
  if (ref.kind !== 'place') throw new LocNotResolvableError(ref.kind);

  if (ref.source.kind === 'homiio') {
    const place = await resolveHomiioPlace(ref.placeType, ref.id);
    return { place: displayable(place), degraded: false, cacheHit: false };
  }

  const provider = providerById(ref.source.provider);
  if (!provider) {
    // The token names a provider this deployment does not have. That is not
    // "no such place" — it is a gateway that cannot answer — so it must not be
    // reported as a 404.
    throw new GeocodingProviderError('provider_unavailable', ref.source.provider);
  }

  const key = resolveCacheKey(provider.id, ref.id, language);
  const cached = readGeoCache<GeoPlace>(key);
  if (cached) return { place: cached, degraded: false, cacheHit: true };

  const resolved = await provider.resolve({
    ref: ref.id,
    language,
    ...(signal === undefined ? {} : { signal }),
  });
  const place = displayable(resolved ? toGeoPlace(resolved) : null);
  if (place) writeGeoCache(key, place, GEO_CACHE_TTL_MS.resolved);

  return {
    place,
    degraded: false,
    cacheHit: false,
    providerId: provider.id,
    attribution: provider.attribution,
  };
}

/** The place a coordinate falls in. */
export async function reversePlace(
  point: ParsedPoint,
  language: string,
  signal?: AbortSignal,
): Promise<PlaceResult> {
  const key = reverseCacheKey(point.longitude, point.latitude, language);
  const cached = readGeoCache<GeoPlace>(key);
  if (cached) return { place: cached, degraded: false, cacheHit: true };

  const outcome = await withFallback((provider) =>
    provider
      .reverse({
        point: { longitude: point.longitude, latitude: point.latitude },
        language,
        ...(signal === undefined ? {} : { signal }),
      })
      .then((value) => ({ value, attribution: provider.attribution })),
  );

  const place = outcome.value.value ? toGeoPlace(outcome.value.value) : null;
  if (place) writeGeoCache(key, place, GEO_CACHE_TTL_MS.resolved);

  return {
    place,
    degraded: outcome.degraded,
    cacheHit: false,
    providerId: outcome.providerId,
    attribution: outcome.value.attribution,
  };
}

/**
 * A place is only an answer to `/resolve` if a screen can actually draw it.
 *
 * `isFramablePlace` is the shared predicate (`@homiio/shared-types`): a point
 * place always qualifies, an `area` place qualifies only if it brought an
 * extent. A place with neither centre nor bounds hands a map nothing to frame,
 * and a map that frames nothing reports no error — it looks exactly like one
 * still loading, which is the quiet failure the predicate exists to prevent.
 *
 * The asymmetry is deliberate and is the whole reason this is not enforced on
 * the type: **a place being RESOLVED FOR DISPLAY must be framable; a place
 * being OFFERED FOR SELECTION need not be.** `/api/geo/search` therefore does
 * NOT apply this — a coordinate-less city is a legitimate disambiguation
 * candidate, and dropping it would remove a real choice from the picker.
 */
const displayable = (place: GeoPlace | null): GeoPlace | null =>
  place && isFramablePlace(place) ? place : null;

/**
 * Build the geometry half of a `GeoPlace` from what a row actually holds.
 *
 * `PlaceGeometry` is a discriminated union, so this is the one place the choice
 * between "a representative point" and "an extent" is made. A centre is emitted
 * only when one is stored; `precision: 'area'` cannot carry a `center` at all,
 * which is what makes a fabricated coordinate a compile error rather than a
 * discouraged habit.
 */
function geometryOf(
  center: { longitude: number; latitude: number } | null,
  bounds: GeoBounds | undefined,
): PlaceGeometry {
  if (center) {
    // `centroid` is the right LABEL for a representative point of an area, and
    // it says what it means: a framing device, not anybody's location. How
    // ACCURATE that point is is a separate question from what kind of point it
    // is — labelling a coarse one `exact` or `approximate` would be the error.
    return { precision: 'centroid', center, ...(bounds ? { bounds } : {}) };
  }
  return { precision: 'area', ...(bounds ? { bounds } : {}) };
}

/** Four nullable columns that the table's CHECK keeps all-or-none. */
function boundsOfColumns(
  west: number | null,
  south: number | null,
  east: number | null,
  north: number | null,
): GeoBounds | undefined {
  if (west === null || south === null || east === null || north === null) return undefined;
  return { west, south, east, north };
}

const toGeoPlaces = (places: ProviderPlace[]): GeoPlace[] =>
  places
    .map(toGeoPlace)
    .filter((place): place is GeoPlace => place !== null);

/**
 * Keep only the requested place types.
 *
 * Applied AFTER normalisation because the type is assigned there — a provider
 * has no idea what Homiio calls a `district`. Filtering an already-short list
 * in memory is also why `limit` is applied afterwards: asking the provider for
 * exactly `limit` results and then discarding some would silently return fewer
 * than asked for.
 */
function filterByType(
  candidates: GeoPlace[],
  types: readonly RequestablePlaceType[] | undefined,
): GeoPlace[] {
  if (!types || types.length === 0) return candidates;
  const wanted = new Set<string>(types);
  return candidates.filter((candidate) => wanted.has(candidate.placeType));
}

/**
 * Resolve a place Homiio owns, straight out of the canonical geo tables.
 *
 * A `homiio` source is a row in this database whose id will still mean the same
 * place after a provider swap, so it is resolved by id and never re-geocoded.
 * The queries are deliberately read-only and local to the gateway rather than
 * routed through `cityService`: this is one join per entity and needs none of
 * that module's search behaviour.
 */
async function resolveHomiioPlace(
  placeType: string,
  id: string,
): Promise<GeoPlace | null> {
  const db = getDb();

  const source = (entity: 'country' | 'region' | 'city' | 'neighborhood'): PlaceSource => ({
    kind: 'homiio',
    entity,
    id,
  });

  if (placeType === 'country') {
    const [row] = await db
      .select({ name: countries.name, code: countries.code })
      .from(countries)
      .where(and(eq(countries.id, id), eq(countries.isActive, true)))
      .limit(1);
    if (!row) return null;

    const extent = await cityExtent(eq(cities.countryId, id));

    return {
      source: source('country'),
      placeType: 'country',
      label: { primary: row.name, kind: 'place' },
      admin: { countryCode: row.code.toUpperCase() },
      ...geometryOf(extent?.center ?? null, extent?.bounds),
    };
  }

  if (placeType === 'region') {
    const [row] = await db
      .select({
        name: regions.name,
        code: regions.code,
        countryCode: countries.code,
        countryName: countries.name,
      })
      .from(regions)
      .innerJoin(countries, eq(countries.id, regions.countryId))
      .where(and(eq(regions.id, id), eq(regions.isActive, true)))
      .limit(1);
    if (!row) return null;

    const extent = await cityExtent(eq(cities.regionId, id));

    return {
      source: source('region'),
      placeType: 'region',
      label: { primary: row.name, secondary: row.countryName, kind: 'place' },
      admin: {
        countryCode: row.countryCode.toUpperCase(),
        ...(row.code === null ? {} : { regionCode: row.code }),
        regionName: row.name,
      },
      ...geometryOf(extent?.center ?? null, extent?.bounds),
    };
  }

  if (placeType === 'city') {
    const [row] = await db
      .select({
        name: cities.name,
        latitude: cities.latitude,
        longitude: cities.longitude,
        bboxWest: cities.bboxWest,
        bboxSouth: cities.bboxSouth,
        bboxEast: cities.bboxEast,
        bboxNorth: cities.bboxNorth,
        regionName: regions.name,
        regionCode: regions.code,
        countryCode: countries.code,
        countryName: countries.name,
      })
      .from(cities)
      .innerJoin(regions, eq(regions.id, cities.regionId))
      .innerJoin(countries, eq(countries.id, cities.countryId))
      .where(and(eq(cities.id, id), eq(cities.isActive, true)))
      .limit(1);
    if (!row) return null;

    return {
      source: source('city'),
      placeType: 'city',
      label: {
        primary: row.name,
        secondary: [row.regionName, row.countryName].filter(Boolean).join(', '),
        kind: 'place',
      },
      admin: {
        countryCode: row.countryCode.toUpperCase(),
        ...(row.regionCode === null ? {} : { regionCode: row.regionCode }),
        regionName: row.regionName,
        cityName: row.name,
      },
      // A city with no stored centroid is not 404'd outright any more: #389
      // added `cities.bbox_*`, so such a row can still resolve as an EXTENT if
      // it has one. `isFramablePlace` at the boundary refuses it only when it
      // has neither, which is the honest "we do not know where this is".
      ...geometryOf(
        row.longitude !== null && row.latitude !== null
          ? { longitude: row.longitude, latitude: row.latitude }
          : null,
        boundsOfColumns(row.bboxWest, row.bboxSouth, row.bboxEast, row.bboxNorth),
      ),
    };
  }

  if (placeType === 'neighborhood') {
    const [row] = await db
      .select({
        name: neighborhoods.name,
        latitude: neighborhoods.latitude,
        longitude: neighborhoods.longitude,
        bboxWest: neighborhoods.bboxWest,
        bboxSouth: neighborhoods.bboxSouth,
        bboxEast: neighborhoods.bboxEast,
        bboxNorth: neighborhoods.bboxNorth,
        cityName: cities.name,
        regionName: regions.name,
        regionCode: regions.code,
        countryCode: countries.code,
      })
      .from(neighborhoods)
      .innerJoin(cities, eq(cities.id, neighborhoods.cityId))
      .innerJoin(regions, eq(regions.id, cities.regionId))
      .innerJoin(countries, eq(countries.id, cities.countryId))
      .where(and(eq(neighborhoods.id, id), eq(neighborhoods.isActive, true)))
      .limit(1);
    if (!row) return null;

    const bounds = boundsOfColumns(row.bboxWest, row.bboxSouth, row.bboxEast, row.bboxNorth);

    // Prefer the stored centroid; fall back to the centre of the stored
    // envelope, which is a real derivation from real data rather than an
    // invention. With neither, the place resolves as a bare `area` and
    // `isFramablePlace` refuses it at the boundary.
    const center =
      row.longitude !== null && row.latitude !== null
        ? { longitude: row.longitude, latitude: row.latitude }
        : bounds
          ? centerOfBounds(bounds)
          : null;

    return {
      source: source('neighborhood'),
      placeType: 'neighborhood',
      label: {
        primary: row.name,
        secondary: [row.cityName, row.regionName].filter(Boolean).join(', '),
        kind: 'place',
      },
      admin: {
        countryCode: row.countryCode.toUpperCase(),
        ...(row.regionCode === null ? {} : { regionCode: row.regionCode }),
        regionName: row.regionName,
        cityName: row.cityName,
        neighborhoodName: row.name,
      },
      ...geometryOf(center, bounds),
    };
  }

  // `district`, `postcode` and `address` have no canonical Homiio table of
  // their own. Returning null (a 404) is correct and not a gap: Homiio does not
  // own a row with that id, so there is nothing to resolve.
  return null;
}


/**
 * The middle of a rectangle, CORRECT across the antimeridian.
 *
 * This used to carry a comment saying it was "not valid across the
 * antimeridian" — a documented wrong answer rather than a fixed one, which
 * survives review precisely because it looks like a known limitation. The
 * shared `boundsCenter` walks east from `west` by half the eastward span, so a
 * wrapping box is measured the short way round; a non-wrapping one is
 * unchanged.
 */
function centerOfBounds(bounds: GeoBounds): { longitude: number; latitude: number } {
  return boundsCenter(bounds);
}

/**
 * The extent of the cities Homiio knows inside a country or a region.
 *
 * ## Why this exists, rather than a stored centroid
 *
 * `countries` and `regions` carry NO coordinate columns — deliberately, since
 * nothing queries them spatially (see the note on `cities.latitude` in
 * `db/schema/geo.ts`). But `GeoPlace.center` is required, and the first version
 * of this resolver satisfied it by emitting `{ longitude: 0, latitude: 0 }`
 * with `precision: 'area'` as the only hint that the point meant nothing.
 *
 * That was a real, user-visible bug and it failed silently in the worst way.
 * `0,0` is a valid coordinate in the Gulf of Guinea: no null check trips and
 * nothing is logged. A map framing itself from `place.center` — the natural
 * read, and what ADR 0002 §6.3 tells it to do — showed open ocean, and the
 * ±0.05° fallback box drawn around it turned "search Spain" into an 11 km
 * rectangle in the Atlantic returning ZERO listings from a request that
 * succeeded. Zero results is the plausible-looking failure: it reads as "no
 * homes in Spain", never as "we invented a centre".
 *
 * So the centre is DERIVED from data Homiio actually holds — the bounding
 * extent of the country's or region's cities — and when there are none with
 * coordinates the resolver returns null and the caller gets a 404. "We do not
 * know where this is" is a true statement; a point in the Atlantic is not.
 *
 * Two limits, stated rather than papered over. The extent of the cities Homiio
 * has ingested is not the extent of the country, so this is a framing device
 * and is typed `centroid` accordingly — which is exactly what `centroid` means:
 * a representative point of an area, and not anybody's location. And it does
 * not handle a country straddling the antimeridian (Fiji, Kiribati): the min/max
 * would span the globe the long way. No such country has cities in this
 * database today, and the honest fix is a PostGIS extent computed with
 * `::geography`, which is a schema change rather than a query change.
 */
async function cityExtent(
  scope: ReturnType<typeof eq>,
): Promise<{
  center: { longitude: number; latitude: number };
  bounds: { west: number; south: number; east: number; north: number };
} | null> {
  const [row] = await getDb()
    .select({
      west: min(cities.longitude),
      east: max(cities.longitude),
      south: min(cities.latitude),
      north: max(cities.latitude),
      n: count(),
    })
    .from(cities)
    .where(
      and(
        scope,
        eq(cities.isActive, true),
        isNotNull(cities.longitude),
        isNotNull(cities.latitude),
      ),
    );

  if (!row || row.n === 0) return null;
  const west = Number(row.west);
  const east = Number(row.east);
  const south = Number(row.south);
  const north = Number(row.north);
  if ([west, east, south, north].some((value) => !Number.isFinite(value))) return null;

  const bounds = { west, south, east, north };
  return { center: centerOfBounds(bounds), bounds };
}
