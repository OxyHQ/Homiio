/**
 * Geo Resolution Service
 *
 * The ingest coordinate fallback ({@link resolveCityCentroid}) plus the types the
 * geo chain shares. The canonical Country → Region → City → (Neighborhood)
 * resolution and upsert is `addressService.resolveGeoChain`, over the
 * `countries` / `regions` / `cities` / `neighborhoods` tables.
 *
 * The external geocoder (Nominatim) is consulted at most ONCE per resolution,
 * and its own cache keeps us well within the OSM usage policy.
 */

import { forwardGeocode } from './geocodingService';
import { countryNameToCode } from '../utils/countryData';
import { sanitizeGeoJsonCoordinates } from '../utils/geoCoordinates';
import { and, eq, sql } from 'drizzle-orm';

import { getDb } from '../db/postgres';
import { cities, countries, regions } from '../db/schema';

/** Names the caller already knows (any subset). Missing pieces are geocoded. */
export interface GeoNames {
  city?: string;
  /** Region / province / state / autonomous community. */
  state?: string;
  country?: string;
  countryCode?: string;
  neighborhood?: string;
}

export class GeoResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeoResolutionError';
  }
}

/**
 * Resolve APPROXIMATE coordinates for a place from its city, without a
 * per-listing external geocode. Used as the ingest coordinate fallback so an
 * external listing is NEVER dropped for want of a precise street geocode: the
 * city is essentially always known (discovery is city-scoped), and a
 * city-centroid point is an acceptable location for an aggregator listing.
 *
 * Resolution order (cheapest first):
 *   1. An existing City doc's stored centroid — ZERO external calls. A burst of
 *      same-city listings therefore triggers at most ONE city geocode: the first
 *      persists the centroid via {@link resolveGeo}'s City upsert, the rest read
 *      it straight back from the DB (surviving the geocoder's in-memory cache
 *      eviction and process restarts).
 *   2. A single forward geocode of the city query (throttled + cached in
 *      {@link forwardGeocode}, so it is reused across every listing in the city).
 *
 * Returns GeoJSON `[lng, lat]`, or `null` when no city name is available or the
 * city cannot be resolved by any means.
 */
export async function resolveCityCentroid(names: GeoNames): Promise<[number, number] | null> {
  const cityName = names.city?.trim();
  if (!cityName) return null;

  // 1) DB-first: reuse a City centroid we already own (no external geocode).
  //    Resolve the country code WITHOUT the throwing `resolveCountryCodeAndName`
  //    helper — an unrecognised country name here is not exceptional, it just
  //    means we skip the DB shortcut and fall through to the geocoder.
  const explicitCode = names.countryCode?.trim().toUpperCase();
  const countryCode =
    explicitCode && /^[A-Z]{2}$/.test(explicitCode)
      ? explicitCode
      : names.country
        ? countryNameToCode(names.country)
        : undefined;
  if (countryCode) {
    // POSTGRES, because that is where the city was created. `addressService`'s
    // `resolveGeoChain` owns the geo upsert now, so the centroid this reads
    // back is the one the previous listing's ingest just persisted, so a
    // placeholder-street listing does not go to the geocoder — the exact flood
    // this shortcut exists to avoid.
    //
    // ONE statement with two LEFT JOINs, not four sequential lookups: the state
    // name narrows the match when it is given and is simply absent from the
    // predicate when it is not, so the "by region, else by country" fallback is
    // an ORDER BY rather than a second round trip.
    const stateName = names.state?.trim();
    const rows = await getDb()
      .select({ longitude: cities.longitude, latitude: cities.latitude })
      .from(cities)
      .innerJoin(countries, eq(cities.countryId, countries.id))
      .leftJoin(regions, eq(cities.regionId, regions.id))
      .where(and(eq(countries.code, countryCode), eq(cities.name, cityName)))
      // A city matching the named region ranks above one matched on country
      // alone.
      .orderBy(
        stateName === undefined
          ? sql`1`
          : sql`case when ${regions.name} = ${stateName} then 0 else 1 end`,
      )
      .limit(1);

    const row = rows[0];
    if (typeof row?.longitude === 'number' && typeof row?.latitude === 'number') {
      const centroid = sanitizeGeoJsonCoordinates([row.longitude, row.latitude]);
      if (centroid) return centroid;
    }
  }

  // 2) One forward geocode of the city (cached, so reused across the whole city).
  const query = [cityName, names.state, names.country].filter(Boolean).join(', ');
  const geocoded = await forwardGeocode(query);
  if (geocoded.success && geocoded.data?.coordinates) {
    return sanitizeGeoJsonCoordinates(geocoded.data.coordinates) ?? null;
  }
  return null;
}

export default { resolveCityCentroid };
