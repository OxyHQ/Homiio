/**
 * Neighborhood Controller
 *
 * Public read endpoints over the DB-owned relational geo layer. A neighborhood
 * is a `Neighborhood` document (name + centroid + owning `cityId`); listings
 * reference it relationally through `Address.neighborhoodId`.
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
 */

import type { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import type {
  NeighborhoodMetrics,
  NeighborhoodVsCity,
  ListingCurrency,
} from '@homiio/shared-types';
import { Neighborhood, Address, Property, City } from '../models';
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

/** Escape a user string for safe use inside a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Clamp/normalize a `limit` query param. */
function parseLimit(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

type IdLean = { _id: Types.ObjectId };

interface NeighborhoodLean {
  _id: Types.ObjectId;
  name: string;
  cityId: Types.ObjectId;
  centroid?: { lat?: number; lng?: number };
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

/**
 * Compute listing count + average long-term monthly rent over a set of address
 * ids, restricted to published + available listings. `rentAvg` averages only
 * listings with a positive `longTermRent.monthlyAmount` (others are mapped to
 * `$$REMOVE`, so `$avg` ignores them) and is `null` when none qualify.
 */
async function rentStatsForAddressIds(addressIds: Types.ObjectId[]): Promise<RentStats> {
  if (addressIds.length === 0) return { listingCount: 0, rentAvg: null };
  const rows = await Property.aggregate<RentStatsRow>([
    {
      $match: {
        addressId: { $in: addressIds },
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

/** Address ids whose `neighborhoodId` matches. */
async function addressIdsForNeighborhood(neighborhoodId: Types.ObjectId): Promise<Types.ObjectId[]> {
  const addrs = await Address.find({ neighborhoodId }).select('_id').lean<IdLean[]>();
  return addrs.map((a) => a._id);
}

/** Address ids whose `cityId` matches. */
async function addressIdsForCity(cityId: Types.ObjectId): Promise<Types.ObjectId[]> {
  const addrs = await Address.find({ cityId }).select('_id').lean<IdLean[]>();
  return addrs.map((a) => a._id);
}

/** Resolve a city's display name + currency (once per city, via the caches). */
async function resolveCityInfo(cityId: Types.ObjectId): Promise<CityInfo> {
  const city = await City.findById(cityId)
    .select('name currency')
    .lean<{ name?: string; currency?: string } | null>();
  return { name: city?.name ?? '', currency: city?.currency };
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
  n: NeighborhoodLean,
  cityInfoCache: Map<string, CityInfo>,
  cityStatsCache: Map<string, RentStats>,
  presetStats?: RentStats,
): Promise<NeighborhoodMetrics> {
  const cityKey = String(n.cityId);

  let cityInfo = cityInfoCache.get(cityKey);
  if (!cityInfo) {
    cityInfo = await resolveCityInfo(n.cityId);
    cityInfoCache.set(cityKey, cityInfo);
  }

  const stats = presetStats ?? (await rentStatsForAddressIds(await addressIdsForNeighborhood(n._id)));

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
    typeof n.centroid?.lat === 'number' && typeof n.centroid?.lng === 'number'
      ? { lat: n.centroid.lat, lng: n.centroid.lng }
      : undefined;

  return {
    id: String(n._id),
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
 * Address that carries a `neighborhoodId` (within a bounded radius). 404 when no
 * neighborhood-bearing address is near enough.
 */
export async function getNeighborhoodByLocation(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const latitude = Number(req.query.latitude);
    const longitude = Number(req.query.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return next(new AppError('latitude and longitude are required', 400, 'INVALID_COORDINATES'));
    }

    const nearest = await Address.findOne({
      neighborhoodId: { $ne: null },
      coordinates: {
        $near: {
          $geometry: { type: 'Point', coordinates: [longitude, latitude] },
          $maxDistance: BY_LOCATION_RADIUS_METERS,
        },
      },
    })
      .select('neighborhoodId')
      .lean<{ neighborhoodId?: Types.ObjectId } | null>();

    if (!nearest?.neighborhoodId) {
      return next(new AppError('No neighborhood found near this location', 404, 'NOT_FOUND'));
    }

    const neighborhood = await Neighborhood.findById(nearest.neighborhoodId)
      .select('name cityId centroid')
      .lean<NeighborhoodLean | null>();
    if (!neighborhood) {
      return next(new AppError('No neighborhood found near this location', 404, 'NOT_FOUND'));
    }

    const metrics = await buildMetrics(neighborhood, new Map(), new Map());
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

    const filter: Record<string, unknown> = {
      isActive: true,
      name: new RegExp(`^${escapeRegExp(name)}$`, 'i'),
    };

    const cityQuery = typeof req.query.city === 'string' ? req.query.city.trim() : '';
    if (cityQuery) {
      const cityId = await resolveCityId(cityQuery);
      if (!cityId) {
        return next(new AppError('Neighborhood not found', 404, 'NOT_FOUND'));
      }
      filter.cityId = cityId;
    }

    const neighborhood = await Neighborhood.findOne(filter)
      .select('name cityId centroid')
      .lean<NeighborhoodLean | null>();
    if (!neighborhood) {
      return next(new AppError('Neighborhood not found', 404, 'NOT_FOUND'));
    }

    const metrics = await buildMetrics(neighborhood, new Map(), new Map());
    res.json(successResponse(metrics, 'Neighborhood retrieved successfully'));
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/neighborhoods/by-property/:propertyId
 *
 * Resolve the neighborhood a property sits in (via its Address). 404 when the
 * property has no resolved neighborhood.
 */
export async function getNeighborhoodByProperty(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { propertyId } = req.params;
    if (!Types.ObjectId.isValid(propertyId)) {
      return next(new AppError('Invalid property ID', 400, 'INVALID_ID'));
    }

    const property = await Property.findById(propertyId)
      .populate({ path: 'addressId', select: 'neighborhoodId' })
      .lean<{ address?: { neighborhoodId?: Types.ObjectId }; addressId?: { neighborhoodId?: Types.ObjectId } } | null>();
    if (!property) {
      return next(new AppError('Property not found', 404, 'NOT_FOUND'));
    }

    // The schema's post-find hook renames a populated `addressId` to `address`.
    const address = property.address ?? property.addressId ?? null;
    const neighborhoodId = address?.neighborhoodId;
    if (!neighborhoodId) {
      return next(new AppError('Property has no resolved neighborhood', 404, 'NOT_FOUND'));
    }

    const neighborhood = await Neighborhood.findById(neighborhoodId)
      .select('name cityId centroid')
      .lean<NeighborhoodLean | null>();
    if (!neighborhood) {
      return next(new AppError('Property has no resolved neighborhood', 404, 'NOT_FOUND'));
    }

    const metrics = await buildMetrics(neighborhood, new Map(), new Map());
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
    const filter: Record<string, unknown> = { isActive: true };

    const cityQuery = typeof req.query.city === 'string' ? req.query.city.trim() : '';
    if (cityQuery) {
      const cityId = await resolveCityId(cityQuery);
      if (!cityId) {
        res.json(successResponse([], 'Neighborhoods retrieved successfully'));
        return;
      }
      filter.cityId = cityId;
    }

    const queryText = typeof req.query.query === 'string' ? req.query.query.trim() : '';
    if (queryText) {
      filter.name = new RegExp(escapeRegExp(queryText), 'i');
    }

    const neighborhoods = await Neighborhood.find(filter)
      .select('name cityId centroid')
      .sort({ name: 1 })
      .limit(limit)
      .lean<NeighborhoodLean[]>();

    const cityInfoCache = new Map<string, CityInfo>();
    const cityStatsCache = new Map<string, RentStats>();
    const metrics = await Promise.all(
      neighborhoods.map((n) => buildMetrics(n, cityInfoCache, cityStatsCache)),
    );

    res.json(successResponse(metrics, 'Neighborhoods retrieved successfully'));
  } catch (error) {
    next(error);
  }
}

/** Aggregation row for the popular-neighborhoods ranking. */
interface PopularRow {
  _id: Types.ObjectId;
  listingCount: number;
  rentAvg: number | null;
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

    // Rank neighborhoods by listing count in ONE aggregation: join each listing
    // to its Address (scoped to the city), keep those with a neighborhood, and
    // group by neighborhood. The `let`/`pipeline` `$lookup` form is used for
    // broad server-version compatibility.
    const rows = await Property.aggregate<PopularRow>([
      { $match: { status: 'published', 'availability.isAvailable': true } },
      {
        $lookup: {
          from: 'addresses',
          let: { addrId: '$addressId' },
          pipeline: [
            { $match: { $expr: { $eq: ['$_id', '$$addrId'] }, cityId } },
            { $project: { neighborhoodId: 1 } },
          ],
          as: 'addr',
        },
      },
      { $unwind: '$addr' },
      { $match: { 'addr.neighborhoodId': { $ne: null } } },
      {
        $group: {
          _id: '$addr.neighborhoodId',
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
      { $sort: { listingCount: -1 } },
      { $limit: limit },
    ]);

    if (rows.length === 0) {
      res.json(successResponse([], 'Popular neighborhoods retrieved successfully'));
      return;
    }

    const statsById = new Map<string, RentStats>();
    for (const row of rows) {
      statsById.set(String(row._id), { listingCount: row.listingCount, rentAvg: row.rentAvg ?? null });
    }

    const neighborhoods = await Neighborhood.find({ _id: { $in: rows.map((r) => r._id) } })
      .select('name cityId centroid')
      .lean<NeighborhoodLean[]>();
    const byId = new Map(neighborhoods.map((n) => [String(n._id), n]));

    const cityInfoCache = new Map<string, CityInfo>();
    const cityStatsCache = new Map<string, RentStats>();
    // Preserve the aggregation's listing-count ordering.
    const ordered: NeighborhoodMetrics[] = [];
    for (const row of rows) {
      const neighborhood = byId.get(String(row._id));
      if (!neighborhood) continue;
      ordered.push(
        await buildMetrics(neighborhood, cityInfoCache, cityStatsCache, statsById.get(String(row._id))),
      );
    }

    res.json(successResponse(ordered, 'Popular neighborhoods retrieved successfully'));
  } catch (error) {
    next(error);
  }
}
