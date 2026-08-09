/**
 * Neighborhood Controller
 *
 * Public read endpoints over the DB-owned relational geo layer. A neighborhood
 * is a `neighborhoods` row (name + centre + owning `city_id`); listings
 * reference it relationally through `addresses.neighborhood_id`.
 *
 * Every returned metric is DERIVED FROM HOMIIO'S OWN LISTINGS — there are no
 * invented walkability / transit / safety scores. When a metric has no real
 * source it is returned as `null` (the frontend then hides that surface) rather
 * than fabricated.
 *
 *   listingCount — published + available listings whose address resolves to the
 *                  neighborhood.
 *   averageRent  — average long-term monthly rent across those listings (null
 *                  when none carry a positive monthly rent).
 *   vsCity       — the neighborhood average contrasted with the city-wide
 *                  average (only when both exist).
 *
 * Public (no auth), mirroring `area-insights` / `cities` reads: the handlers
 * read only `req.params`/`req.query` and never touch `req.user`.
 *
 * ## The two-store seam is gone, and so is what it cost
 *
 * This file used to straddle both stores: neighbourhoods, cities and addresses
 * in Postgres, the rent STATISTICS as Mongoose pipelines keyed by address ids
 * Postgres supplied. Every scope therefore materialised an uncapped array of
 * address ids just to hand it to an `$in`, and each id had to be converted to an
 * `ObjectId` by hand because an aggregation `$match` does not apply Mongoose's
 * casting — a string list matched nothing and returned an empty result with no
 * error, the silent-zero shape the migration contract warns about.
 *
 * Listings are in the same database as addresses now, so every one of those is
 * an ordinary join: no id arrays, no conversion, and no way for the two halves
 * to disagree about what an id is.
 */

import type { Request, Response, NextFunction } from 'express';
import { and, asc, eq, ilike, sql, inArray, type SQL } from 'drizzle-orm';
import type {
  NeighborhoodMetrics,
  NeighborhoodVsCity,
  ListingCurrency,
} from '@homiio/shared-types';

import { getDb } from '../db/postgres';
import { escapeLikePattern } from '../db/likePattern';
import { addresses, cities, neighborhoods, properties } from '../db/schema';
import { nearestAddressesQuery } from '../services/addressService';
import { AppError, successResponse } from '../middlewares/errorHandler';
import { resolveCityId } from '../services/geoQueryService';

const DEFAULT_POPULAR_LIMIT = 10;
const DEFAULT_SEARCH_LIMIT = 20;
const MAX_LIMIT = 50;
/** Radius (metres) for the nearest-neighborhood lookup in `by-location`. */
const BY_LOCATION_RADIUS_METERS = 5000;

/** Round to the nearest integer, treating non-finite input as 0. */
function roundInt(value: number): number {
  return Number.isFinite(value) ? Math.round(value) : 0;
}

/** Clamp/normalize a `limit` query param. */
function parseLimit(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

interface NeighborhoodRow {
  id: string;
  name: string;
  cityId: string;
  latitude: number | null;
  longitude: number | null;
}

interface CityInfo {
  name: string;
  currency?: string;
}

interface RentStats {
  listingCount: number;
  /** Average long-term monthly rent over positive-rent listings, or null. */
  rentAvg: number | null;
}


/** The neighborhood columns every response reads. */
const NEIGHBORHOOD_COLUMNS = {
  id: neighborhoods.id,
  name: neighborhoods.name,
  cityId: neighborhoods.cityId,
  latitude: neighborhoods.latitude,
  longitude: neighborhoods.longitude,
} as const;

/**
 * Listing count + average long-term monthly rent over a set of addresses,
 * restricted to published + available listings.
 *
 * Takes a PREDICATE on `addresses`, not a list of address ids. The Mongo
 * version could only take ids — it read every address in the neighbourhood (or
 * the whole city) into an uncapped array, converted each to an `ObjectId`
 * because `aggregate` does not cast, and `$in`-ed the result. Listings live in
 * the same database as addresses now, so it is one join, and `toMongoAddressIds`
 * plus the two id-list helpers are gone rather than ported.
 *
 * `rentAvg` averages only listings with a positive monthly amount — `avg()`
 * ignores NULLs, so `nullif(..., 0)` does what the `$$REMOVE` branch did — and
 * is `null` when none qualify.
 */
async function rentStatsForAddresses(addressScope: SQL): Promise<RentStats> {
  const [row] = await getDb()
    .select({
      listingCount: sql<number>`count(*)::int`,
      rentAvg: sql<number | null>`avg(nullif(${properties.longTermRentMonthlyAmount}, 0))`,
    })
    .from(properties)
    .innerJoin(addresses, eq(properties.addressId, addresses.id))
    .where(
      and(
        addressScope,
        eq(properties.status, 'published'),
        eq(properties.availabilityIsAvailable, true),
      ),
    );
  if (!row) return { listingCount: 0, rentAvg: null };
  // postgres.js returns `numeric` aggregates as strings.
  return { listingCount: row.listingCount, rentAvg: row.rentAvg === null ? null : Number(row.rentAvg) };
}

/** Resolve a city's display name + currency (once per city, via the caches). */
async function resolveCityInfo(cityId: string): Promise<CityInfo> {
  const rows = await getDb()
    .select({ name: cities.name, currency: cities.currency })
    .from(cities)
    .where(eq(cities.id, cityId))
    .limit(1);
  return { name: rows[0]?.name ?? '', currency: rows[0]?.currency };
}

/** Build the neighborhood-vs-city contrast, or null when it can't be computed. */
function buildVsCity(neighborhoodAvg: number | null, cityAvg: number | null): NeighborhoodVsCity | null {
  if (neighborhoodAvg === null || cityAvg === null || cityAvg <= 0) return null;
  return {
    cityAverageRent: roundInt(cityAvg),
    percentDiff: roundInt(((neighborhoodAvg - cityAvg) / cityAvg) * 100),
  };
}

/**
 * Build the full metrics DTO for a neighborhood. `cityInfoCache`/`cityStatsCache`
 * are shared across a request so a batch of neighborhoods in the same city
 * resolves the city name + city-wide average exactly once. `presetStats` skips
 * the per-neighborhood rent query when the caller already aggregated it (the
 * `popular` path).
 */
async function buildMetrics(
  n: NeighborhoodRow,
  cityInfoCache: Map<string, CityInfo>,
  cityStatsCache: Map<string, RentStats>,
  presetStats?: RentStats,
): Promise<NeighborhoodMetrics> {
  const cityKey = n.cityId;

  let cityInfo = cityInfoCache.get(cityKey);
  if (!cityInfo) {
    cityInfo = await resolveCityInfo(n.cityId);
    cityInfoCache.set(cityKey, cityInfo);
  }

  const stats = presetStats ?? (await rentStatsForAddresses(eq(addresses.neighborhoodId, n.id)));

  let vsCity: NeighborhoodVsCity | null = null;
  if (stats.rentAvg !== null) {
    let cityStats = cityStatsCache.get(cityKey);
    if (!cityStats) {
      cityStats = await rentStatsForAddresses(eq(addresses.cityId, n.cityId));
      cityStatsCache.set(cityKey, cityStats);
    }
    vsCity = buildVsCity(stats.rentAvg, cityStats.rentAvg);
  }

  const centroid =
    typeof n.latitude === 'number' && typeof n.longitude === 'number'
      ? { lat: n.latitude, lng: n.longitude }
      : undefined;

  return {
    id: n.id,
    name: n.name,
    city: cityInfo.name,
    cityId: cityKey,
    centroid,
    listingCount: stats.listingCount,
    averageRent: stats.rentAvg === null ? null : roundInt(stats.rentAvg),
    currency: cityInfo.currency as ListingCurrency | undefined,
    vsCity,
  };
}

/**
 * GET /api/neighborhoods/by-location?latitude=&longitude=
 *
 * Resolve the neighborhood nearest to a coordinate by finding the closest
 * address that carries a `neighborhood_id` (within a bounded radius). 404 when no
 * neighborhood-bearing address is near enough.
 */
export async function getNeighborhoodByLocation(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const latitude = Number(req.query.latitude);
    const longitude = Number(req.query.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return next(new AppError('latitude and longitude are required', 400, 'INVALID_COORDINATES'));
    }

    // `$near` + `$maxDistance` becomes `ST_DWithin` (index-backed) plus the KNN
    // `<->` ordering; see `addressService.nearestAddressesQuery` for why the
    // obvious `ST_Distance(...) < r` spelling is not equivalent.
    const nearest = nearestAddressesQuery({
      longitude,
      latitude,
      radiusMeters: BY_LOCATION_RADIUS_METERS,
      withNeighborhood: true,
    });
    const rows = await getDb()
      .select(NEIGHBORHOOD_COLUMNS)
      .from(addresses)
      .innerJoin(neighborhoods, eq(addresses.neighborhoodId, neighborhoods.id))
      .where(nearest.where)
      .orderBy(nearest.orderBy)
      .limit(1);

    if (!rows[0]) {
      return next(new AppError('No neighborhood found near this location', 404, 'NOT_FOUND'));
    }

    const metrics = await buildMetrics(rows[0], new Map(), new Map());
    res.json(successResponse(metrics, 'Neighborhood retrieved successfully'));
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/neighborhoods/by-name?name=&city=
 *
 * Resolve a neighborhood by its (case-insensitive) name, optionally scoped to a
 * city (id or name). 404 when unknown.
 */
export async function getNeighborhoodByName(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const name = typeof req.query.name === 'string' ? req.query.name.trim() : '';
    if (!name) {
      return next(new AppError('name is required', 400, 'INVALID_QUERY'));
    }

    const conditions: SQL[] = [
      eq(neighborhoods.isActive, true),
      // Anchored `^name$/i` is a case-insensitive EQUALITY, so `=` on
      // `lower(name)` — not `ILIKE`, which would read `%`/`_` as wildcards.
      sql`lower(${neighborhoods.name}) = lower(${name})`,
    ];

    const cityQuery = typeof req.query.city === 'string' ? req.query.city.trim() : '';
    if (cityQuery) {
      const cityId = await resolveCityId(cityQuery);
      if (!cityId) {
        return next(new AppError('Neighborhood not found', 404, 'NOT_FOUND'));
      }
      conditions.push(eq(neighborhoods.cityId, cityId));
    }

    const rows = await getDb().select(NEIGHBORHOOD_COLUMNS).from(neighborhoods).where(and(...conditions)).limit(1);
    if (!rows[0]) {
      return next(new AppError('Neighborhood not found', 404, 'NOT_FOUND'));
    }

    const metrics = await buildMetrics(rows[0], new Map(), new Map());
    res.json(successResponse(metrics, 'Neighborhood retrieved successfully'));
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/neighborhoods/by-property/:propertyId
 *
 * Resolve the neighborhood a property sits in (via its address). 404 when the
 * property has no resolved neighborhood.
 *
 * The PROPERTY lookup is still Mongo (batch 3 owns `properties`); the
 * neighborhood it resolves to is read from Postgres.
 */
export async function getNeighborhoodByProperty(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { propertyId } = req.params;
    // No id-SHAPE guard — `Types.ObjectId.isValid` rejects every uuid v7 id
    // minted after the cutover. See `db/ids.ts`.

    // ONE statement, listings → addresses → neighbourhoods. The Mongo hop this
    // replaces read `properties.addressId` from a different store first, which
    // is what made `addressId` nullable-looking here; the column is `NOT NULL`
    // with a RESTRICT reference, so a listing always has an address and the
    // only real absence is a neighbourhood the address never resolved.
    const rows = await getDb()
      .select(NEIGHBORHOOD_COLUMNS)
      .from(properties)
      .innerJoin(addresses, eq(properties.addressId, addresses.id))
      .innerJoin(neighborhoods, eq(addresses.neighborhoodId, neighborhoods.id))
      .where(eq(properties.id, propertyId))
      .limit(1);
    if (!rows[0]) {
      // Deliberately one message for both "no such listing" and "no
      // neighbourhood resolved": the endpoint answers a neighbourhood or it does
      // not, and distinguishing them would confirm a listing exists.
      return next(new AppError('Property has no resolved neighborhood', 404, 'NOT_FOUND'));
    }

    const metrics = await buildMetrics(rows[0], new Map(), new Map());
    res.json(successResponse(metrics, 'Neighborhood retrieved successfully'));
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/neighborhoods/search?city=&query=&limit=
 *
 * List neighborhoods (optionally scoped to a city, optionally name-filtered),
 * each with derived metrics. Returns an empty list when a provided city is
 * unknown.
 */
export async function searchNeighborhoods(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const limit = parseLimit(req.query.limit, DEFAULT_SEARCH_LIMIT);
    const conditions: SQL[] = [eq(neighborhoods.isActive, true)];

    const cityQuery = typeof req.query.city === 'string' ? req.query.city.trim() : '';
    if (cityQuery) {
      const cityId = await resolveCityId(cityQuery);
      if (!cityId) {
        res.json(successResponse([], 'Neighborhoods retrieved successfully'));
        return;
      }
      conditions.push(eq(neighborhoods.cityId, cityId));
    }

    const queryText = typeof req.query.query === 'string' ? req.query.query.trim() : '';
    if (queryText) {
      // Unanchored `/q/i` — a substring match, served by the `gin_trgm_ops`
      // index. The term is escaped so a typed `%` filters instead of matching
      // everything.
      conditions.push(ilike(neighborhoods.name, `%${escapeLikePattern(queryText)}%`));
    }

    const rows = await getDb()
      .select(NEIGHBORHOOD_COLUMNS)
      .from(neighborhoods)
      .where(and(...conditions))
      // `name` is NOT NULL, so Postgres' NULLS LAST and Mongo's missing-first
      // cannot disagree about this ordering.
      .orderBy(asc(neighborhoods.name))
      .limit(limit);

    const cityInfoCache = new Map<string, CityInfo>();
    const cityStatsCache = new Map<string, RentStats>();
    const metrics = await Promise.all(
      rows.map((n) => buildMetrics(n, cityInfoCache, cityStatsCache)),
    );

    res.json(successResponse(metrics, 'Neighborhoods retrieved successfully'));
  } catch (error) {
    next(error);
  }
}


/**
 * GET /api/neighborhoods/popular?city=&limit=
 *
 * The city's neighborhoods ranked by real listing count (published + available
 * listings whose address resolves to each neighborhood). `city` is required (id
 * or name); an unknown city yields an empty list. Neighborhoods with zero
 * listings never appear.
 */
export async function getPopularNeighborhoods(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const cityQuery = typeof req.query.city === 'string' ? req.query.city.trim() : '';
    if (!cityQuery) {
      return next(new AppError('city is required', 400, 'INVALID_QUERY'));
    }
    const cityId = await resolveCityId(cityQuery);
    if (!cityId) {
      res.json(successResponse([], 'Popular neighborhoods retrieved successfully'));
      return;
    }

    const limit = parseLimit(req.query.limit, DEFAULT_POPULAR_LIMIT);

    // ONE grouped join, where this used to be: read every neighbourhood-bearing
    // address in the city into an array, `$in` it against a Mongo aggregation,
    // then fold the per-address groups up to their neighbourhood in JS. The
    // grouping is the query's now, and nothing intermediate is materialised.
    const grouped = await getDb()
      .select({
        neighborhoodId: addresses.neighborhoodId,
        listingCount: sql<number>`count(*)::int`,
        rentAvg: sql<number | null>`avg(nullif(${properties.longTermRentMonthlyAmount}, 0))`,
      })
      .from(properties)
      .innerJoin(addresses, eq(properties.addressId, addresses.id))
      .where(
        and(
          eq(addresses.cityId, cityId),
          sql`${addresses.neighborhoodId} is not null`,
          eq(properties.status, 'published'),
          eq(properties.availabilityIsAvailable, true),
        ),
      )
      .groupBy(addresses.neighborhoodId);

    const ranked = grouped
      .map((row) => ({
        neighborhoodId: String(row.neighborhoodId),
        stats: {
          listingCount: row.listingCount,
          // postgres.js returns `numeric` aggregates as strings.
          rentAvg: row.rentAvg === null ? null : Number(row.rentAvg),
        } satisfies RentStats,
      }))
      .sort((a, b) => b.stats.listingCount - a.stats.listingCount)
      .slice(0, limit);

    if (ranked.length === 0) {
      res.json(successResponse([], 'Popular neighborhoods retrieved successfully'));
      return;
    }

    const neighborhoodRows = await getDb()
      .select(NEIGHBORHOOD_COLUMNS)
      .from(neighborhoods)
      .where(inArray(neighborhoods.id, ranked.map((r) => r.neighborhoodId)));
    const byId = new Map(neighborhoodRows.map((n) => [n.id, n]));

    const cityInfoCache = new Map<string, CityInfo>();
    const cityStatsCache = new Map<string, RentStats>();
    // Preserve the listing-count ordering.
    const ordered: NeighborhoodMetrics[] = [];
    for (const entry of ranked) {
      const neighborhood = byId.get(entry.neighborhoodId);
      if (!neighborhood) continue;
      ordered.push(await buildMetrics(neighborhood, cityInfoCache, cityStatsCache, entry.stats));
    }

    res.json(successResponse(ordered, 'Popular neighborhoods retrieved successfully'));
  } catch (error) {
    next(error);
  }
}
