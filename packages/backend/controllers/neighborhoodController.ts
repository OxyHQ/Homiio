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
 * ## This file straddles both stores on purpose, and the seam is explicit
 *
 * Neighborhoods, cities and addresses are Postgres. The RENT STATISTICS are
 * counts and averages over PROPERTIES, and `properties` lands in batch 3 — so
 * every aggregation here is still a Mongoose pipeline, keyed by the address ids
 * Postgres supplies. Ids are preserved verbatim across the migration, which is
 * what makes that join work at all.
 *
 * The seam has ONE sharp edge, {@link toMongoAddressIds}: an aggregation `$match`
 * does NOT apply Mongoose's schema casting, so handing it id STRINGS matches
 * nothing and returns an empty result with no error — the exact silent-zero
 * shape the migration contract warns about. The conversion is therefore
 * explicit, and it THROWS on an id Mongo cannot represent rather than dropping
 * it.
 */

import type { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import { and, asc, eq, ilike, sql, inArray, type SQL } from 'drizzle-orm';
import type {
  NeighborhoodMetrics,
  NeighborhoodVsCity,
  ListingCurrency,
} from '@homiio/shared-types';

import { Property } from '../models';
import { getDb } from '../db/postgres';
import { escapeLikePattern } from '../db/likePattern';
import { addresses, cities, neighborhoods } from '../db/schema';
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

/** Aggregation row shape for the rent-stats `$group`. */
interface RentStatsRow {
  listingCount: number;
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
 * Convert Postgres address ids into the `ObjectId`s a Mongo AGGREGATION needs.
 *
 * `Model.find({ addressId: { $in: [...] } })` casts strings through the schema;
 * `Model.aggregate([{ $match: … }])` does NOT, so a raw string list silently
 * matches zero documents. Converting explicitly makes the boundary visible, and
 * makes an id Mongo cannot represent (a post-cutover uuid v7) throw here rather
 * than read as "this neighborhood has no listings".
 *
 * Deleted in batch 4, when the properties these ids point at are in Postgres too
 * and the whole indirection becomes a join.
 */
function toMongoAddressIds(addressIds: readonly string[]): Types.ObjectId[] {
  return addressIds.map((id) => new Types.ObjectId(id));
}

/**
 * Compute listing count + average long-term monthly rent over a set of address
 * ids, restricted to published + available listings. `rentAvg` averages only
 * listings with a positive `longTermRent.monthlyAmount` (others are mapped to
 * `$$REMOVE`, so `$avg` ignores them) and is `null` when none qualify.
 */
async function rentStatsForAddressIds(addressIds: readonly string[]): Promise<RentStats> {
  if (addressIds.length === 0) return { listingCount: 0, rentAvg: null };
  const rows = await Property.aggregate<RentStatsRow>([
    {
      $match: {
        addressId: { $in: toMongoAddressIds(addressIds) },
        status: 'published',
        'availability.isAvailable': true,
      },
    },
    {
      $group: {
        _id: null,
        listingCount: { $sum: 1 },
        rentAvg: {
          $avg: {
            $cond: [
              { $gt: ['$longTermRent.monthlyAmount', 0] },
              '$longTermRent.monthlyAmount',
              '$$REMOVE',
            ],
          },
        },
      },
    },
  ]);
  const row = rows[0];
  if (!row) return { listingCount: 0, rentAvg: null };
  return { listingCount: row.listingCount, rentAvg: row.rentAvg ?? null };
}

/** Address ids whose `neighborhood_id` matches. */
async function addressIdsForNeighborhood(neighborhoodId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ id: addresses.id })
    .from(addresses)
    .where(eq(addresses.neighborhoodId, neighborhoodId));
  return rows.map((row) => row.id);
}

/** Address ids whose `city_id` matches. */
async function addressIdsForCity(cityId: string): Promise<string[]> {
  const rows = await getDb().select({ id: addresses.id }).from(addresses).where(eq(addresses.cityId, cityId));
  return rows.map((row) => row.id);
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

  const stats = presetStats ?? (await rentStatsForAddressIds(await addressIdsForNeighborhood(n.id)));

  let vsCity: NeighborhoodVsCity | null = null;
  if (stats.rentAvg !== null) {
    let cityStats = cityStatsCache.get(cityKey);
    if (!cityStats) {
      cityStats = await rentStatsForAddressIds(await addressIdsForCity(n.cityId));
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
    if (!Types.ObjectId.isValid(propertyId)) {
      return next(new AppError('Invalid property ID', 400, 'INVALID_ID'));
    }

    const property = await Property.findById(propertyId)
      .select('addressId')
      .lean<{ addressId?: Types.ObjectId } | null>();
    if (!property) {
      return next(new AppError('Property not found', 404, 'NOT_FOUND'));
    }
    if (!property.addressId) {
      return next(new AppError('Property has no resolved neighborhood', 404, 'NOT_FOUND'));
    }

    const rows = await getDb()
      .select(NEIGHBORHOOD_COLUMNS)
      .from(addresses)
      .innerJoin(neighborhoods, eq(addresses.neighborhoodId, neighborhoods.id))
      .where(eq(addresses.id, String(property.addressId)))
      .limit(1);
    if (!rows[0]) {
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
 * One `$group` row of the popular-neighborhoods ranking: the listings at a
 * single address.
 *
 * The rent total and its count are carried SEPARATELY rather than pre-averaged,
 * because the groups are folded up to their neighborhood afterwards and an
 * average of per-address averages is not the average over listings.
 */
interface PopularAddressGroup {
  _id: Types.ObjectId;
  listingCount: number;
  rentSum: number;
  rentCount: number;
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

    // The `$lookup` into `addresses` is gone: addresses live in Postgres now, so
    // the city's neighborhood-bearing addresses are read here and the Mongo
    // aggregation groups by the neighborhood id carried alongside them. Batch 4
    // collapses the whole two-store shape into one join.
    const cityAddresses = await getDb()
      .select({ id: addresses.id, neighborhoodId: addresses.neighborhoodId })
      .from(addresses)
      .where(and(eq(addresses.cityId, cityId), sql`${addresses.neighborhoodId} is not null`));
    if (cityAddresses.length === 0) {
      res.json(successResponse([], 'Popular neighborhoods retrieved successfully'));
      return;
    }

    const neighborhoodByAddressId = new Map(cityAddresses.map((a) => [a.id, a.neighborhoodId as string]));
    const rows = await Property.aggregate<PopularAddressGroup>([
      {
        $match: {
          addressId: { $in: toMongoAddressIds(cityAddresses.map((a) => a.id)) },
          status: 'published',
          'availability.isAvailable': true,
        },
      },
      {
        $group: {
          _id: '$addressId',
          listingCount: { $sum: 1 },
          rentSum: {
            $sum: {
              $cond: [{ $gt: ['$longTermRent.monthlyAmount', 0] }, '$longTermRent.monthlyAmount', 0],
            },
          },
          rentCount: {
            $sum: { $cond: [{ $gt: ['$longTermRent.monthlyAmount', 0] }, 1, 0] },
          },
        },
      },
    ]);

    // Fold the per-address groups up to their neighborhood.
    const totals = new Map<string, { listingCount: number; rentSum: number; rentCount: number }>();
    for (const row of rows) {
      const neighborhoodId = neighborhoodByAddressId.get(String(row._id));
      if (!neighborhoodId) continue;
      const acc = totals.get(neighborhoodId) ?? { listingCount: 0, rentSum: 0, rentCount: 0 };
      acc.listingCount += row.listingCount;
      acc.rentSum += row.rentSum;
      acc.rentCount += row.rentCount;
      totals.set(neighborhoodId, acc);
    }

    const ranked = [...totals.entries()]
      .map(([neighborhoodId, acc]) => ({
        neighborhoodId,
        stats: {
          listingCount: acc.listingCount,
          rentAvg: acc.rentCount > 0 ? acc.rentSum / acc.rentCount : null,
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
