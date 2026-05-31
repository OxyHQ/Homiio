/**
 * Area price-insights controller.
 *
 * Powers the property-detail "price range in this area" section. Given a target
 * property it computes how that listing's price compares to SIMILAR homes
 * nearby, returning min/max/avg/median, a verdict, a price distribution and a
 * set of comparable listings.
 *
 * Public (no auth) — mirrors the auth posture of the nearby/radius/stats routes
 * in `routes/public.ts`.
 *
 * Geo model: coordinates live on the referenced Address (GeoJSON Point with a
 * `2dsphere` index). Geo filtering therefore resolves the matching Address ids
 * first (via `$geoWithin`/`$near`, the same pattern as
 * `PropertySchema.statics.findWithinRadius` / `findNearby`) and then constrains
 * properties by `addressId`. This keeps every query index-backed.
 *
 * Like-for-like guarantee: prices are only ever compared within a single
 * `priceUnit` (e.g. monthly vs monthly), so a long-term €/month listing is
 * never mixed with a vacation €/night listing. `rentMode` is matched as
 * "target mode OR both", because a `RentMode.BOTH` listing participates in both
 * the long-term and vacation feeds; the `priceUnit` guard is what keeps its
 * price comparable.
 */

import type { Request, Response, NextFunction } from 'express';
import { Types, type Model } from 'mongoose';
import type { IProperty } from '../../models/Property';
import type { IAddress } from '../../models/Address';

const models = require('../../models');
const Property: Model<IProperty> = models.Property;
const Address: Model<IAddress> = models.Address;
const { AppError, successResponse } = require('../../middlewares/errorHandler');

// ---- Tunable constants (no magic numbers inline) ----
/** Radius, in kilometres, used for the primary (neighborhood-scale) comparison. */
const RADIUS_KM = 2;
/** Metres per kilometre. */
const METERS_PER_KM = 1000;
/** Minimum comparables required before we trust the radius scope; below this we fall back to city. */
const MIN_RADIUS_SAMPLE = 5;
/** Bedroom tolerance: comparables must be within ±this many bedrooms of the target. */
const BEDROOM_TOLERANCE = 1;
/** Number of even buckets in the price distribution histogram. */
const BUCKET_COUNT = 8;
/** Maximum number of full comparable property documents returned (nearest first). */
const COMPARABLES_LIMIT = 12;
/** Percent thresholds (target-vs-average) that map a price difference to a verdict. */
const VERDICT_GOOD_DEAL_MAX = -7;
const VERDICT_BELOW_AVG_MAX = -2;
const VERDICT_AVERAGE_MAX = 2;

type Basis = 'radius' | 'city';
type Verdict = 'good_deal' | 'below_average' | 'average' | 'above_average';

/** Rent-mode literals as stored on the Property (`RentMode` enum values). */
const RENT_MODE_LONG_TERM = 'long_term';
const RENT_MODE_VACATION = 'vacation';
const RENT_MODE_BOTH = 'both';

interface PriceComparison {
  min: number;
  max: number;
  avg: number;
  median: number;
  thisPrice: number;
  percentDiffFromAvg: number;
  verdict: Verdict;
}

interface DistributionBucket {
  min: number;
  max: number;
  count: number;
}

interface PriceDistribution {
  buckets: DistributionBucket[];
  thisBucketIndex: number;
}

interface PricePerSqm {
  this: number;
  areaAvg: number;
}

interface NeighborhoodVsCity {
  neighborhood: string;
  city: string;
  neighborhoodAvg: number;
  cityAvg: number;
  percentDiff: number;
}

interface AreaInsightsResponse {
  basis: Basis;
  radiusKm: number;
  areaLabel: string;
  currency: string;
  priceUnit: string;
  sampleSize: number;
  comparison: PriceComparison;
  pricePerSqm: PricePerSqm | null;
  distribution: PriceDistribution;
  neighborhoodVsCity: NeighborhoodVsCity | null;
  comparables: Record<string, unknown>[];
}

/** Aggregation row produced by the comparable price-stats pipeline. */
interface PriceStatsRow {
  count: number;
  min: number;
  max: number;
  avg: number;
  median: number | null;
  prices: number[];
}

/** Aggregation row produced by an average-only pipeline. */
interface AvgRow {
  avg: number;
  count: number;
}

/** Aggregation row produced by the price-per-sqm pipeline. */
interface SqmRow {
  avgPricePerSqm: number;
  count: number;
}

/** Lean Address projection used for geo id-resolution. */
type AddressGeoLean = { _id: Types.ObjectId };

/** Target fields needed to build the comparable query and the response. */
interface TargetContext {
  id: Types.ObjectId;
  bedrooms: number;
  rentMode: string;
  priceUnit: string;
  currency: string;
  price: number;
  squareFootage: number;
  longitude: number;
  latitude: number;
  city: string;
  neighborhood: string | null;
}

/**
 * The set of `rentMode` values whose listings are valid comparables for the
 * target's mode. A `RentMode.BOTH` listing participates in both feeds, so:
 *  - a long-term target matches long_term + both,
 *  - a vacation target matches vacation + both,
 *  - a "both" target itself participates in both feeds, so it matches any mode.
 *
 * The `priceUnit` equality guard (applied separately) is what ultimately keeps
 * prices like-for-like, so a "both" monthly listing never compares against a
 * vacation per-night listing even though their modes are technically allowed.
 */
function compatibleRentModes(targetRentMode: string): string[] {
  if (targetRentMode === RENT_MODE_BOTH) {
    return [RENT_MODE_LONG_TERM, RENT_MODE_VACATION, RENT_MODE_BOTH];
  }
  return [targetRentMode, RENT_MODE_BOTH];
}

/**
 * Base comparable filter (everything except the geo / city scope).
 *
 * Comparable = a published, available listing that is NOT the target, within
 * ±BEDROOM_TOLERANCE bedrooms, sharing the target's `priceUnit` (like-for-like
 * pricing) and a compatible `rentMode` (see `compatibleRentModes`).
 */
function buildBaseComparableFilter(target: TargetContext): Record<string, unknown> {
  return {
    _id: { $ne: target.id },
    status: 'published',
    'availability.isAvailable': true,
    bedrooms: {
      $gte: target.bedrooms - BEDROOM_TOLERANCE,
      $lte: target.bedrooms + BEDROOM_TOLERANCE,
    },
    priceUnit: target.priceUnit,
    rentMode: { $in: compatibleRentModes(target.rentMode) },
    'rent.amount': { $gt: 0 },
  };
}

/**
 * Resolve the ordered (nearest-first) list of Address ids within `radiusKm` of
 * the target. Mirrors `PropertySchema.statics.findWithinRadius`'s geo approach
 * (`$geoWithin` on the 2dsphere index) but uses `$near` so the result is
 * distance-ordered, which lets us return comparables nearest-first.
 */
async function resolveRadiusAddressIds(
  target: TargetContext,
  radiusKm: number
): Promise<Types.ObjectId[]> {
  const maxDistanceMeters = radiusKm * METERS_PER_KM;
  const matches = await Address.find({
    coordinates: {
      $near: {
        $geometry: { type: 'Point', coordinates: [target.longitude, target.latitude] },
        $maxDistance: maxDistanceMeters,
      },
    },
  })
    .select('_id')
    .lean<AddressGeoLean[]>();
  return matches.map((a) => a._id);
}

/**
 * Resolve the ordered (nearest-first) list of Address ids in the target's city.
 * Ordered by distance from the target so the city-fallback comparables are
 * still returned nearest-first.
 */
async function resolveCityAddressIds(target: TargetContext): Promise<Types.ObjectId[]> {
  const matches = await Address.find({
    city: target.city,
    coordinates: {
      $near: {
        $geometry: { type: 'Point', coordinates: [target.longitude, target.latitude] },
      },
    },
  })
    .select('_id')
    .lean<AddressGeoLean[]>();
  return matches.map((a) => a._id);
}

/** Resolve Address ids in the target's neighborhood (within its city). */
async function resolveNeighborhoodAddressIds(
  target: TargetContext
): Promise<Types.ObjectId[]> {
  if (!target.neighborhood) return [];
  const matches = await Address.find({ city: target.city, neighborhood: target.neighborhood })
    .select('_id')
    .lean<AddressGeoLean[]>();
  return matches.map((a) => a._id);
}

/** Round to the nearest integer, treating non-finite input as 0. */
function roundInt(value: number): number {
  return Number.isFinite(value) ? Math.round(value) : 0;
}

/**
 * Run the comparable price-stats aggregation over the given address-id scope.
 * Returns null when the scope yields no comparables. Uses the `$median`
 * accumulator (MongoDB 7.0+) and also keeps the sorted price array so the
 * histogram can be built without a second pass.
 */
async function aggregatePriceStats(
  baseFilter: Record<string, unknown>,
  addressIds: Types.ObjectId[]
): Promise<PriceStatsRow | null> {
  if (addressIds.length === 0) return null;
  const rows = await Property.aggregate<PriceStatsRow>([
    { $match: { ...baseFilter, addressId: { $in: addressIds } } },
    { $sort: { 'rent.amount': 1 } },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        min: { $min: '$rent.amount' },
        max: { $max: '$rent.amount' },
        avg: { $avg: '$rent.amount' },
        median: { $median: { input: '$rent.amount', method: 'approximate' } },
        prices: { $push: '$rent.amount' },
      },
    },
  ]);
  const row = rows[0];
  if (!row || row.count === 0) return null;
  return row;
}

/** Average rent over a scope; returns null when the scope is empty. */
async function aggregateAvg(
  baseFilter: Record<string, unknown>,
  addressIds: Types.ObjectId[]
): Promise<number | null> {
  if (addressIds.length === 0) return null;
  const rows = await Property.aggregate<AvgRow>([
    { $match: { ...baseFilter, addressId: { $in: addressIds } } },
    { $group: { _id: null, avg: { $avg: '$rent.amount' }, count: { $sum: 1 } } },
  ]);
  const row = rows[0];
  if (!row || row.count === 0) return null;
  return row.avg;
}

/**
 * Average price-per-sqm over comparables that have a usable `squareFootage`.
 * Returns null when none of the comparables expose square footage.
 */
async function aggregateAreaPricePerSqm(
  baseFilter: Record<string, unknown>,
  addressIds: Types.ObjectId[]
): Promise<number | null> {
  if (addressIds.length === 0) return null;
  const rows = await Property.aggregate<SqmRow>([
    { $match: { ...baseFilter, addressId: { $in: addressIds }, squareFootage: { $gt: 0 } } },
    {
      $group: {
        _id: null,
        avgPricePerSqm: { $avg: { $divide: ['$rent.amount', '$squareFootage'] } },
        count: { $sum: 1 },
      },
    },
  ]);
  const row = rows[0];
  if (!row || row.count === 0) return null;
  return row.avgPricePerSqm;
}

/** Map a percent difference from the average to a verdict. */
function classifyVerdict(percentDiffFromAvg: number): Verdict {
  if (percentDiffFromAvg <= VERDICT_GOOD_DEAL_MAX) return 'good_deal';
  if (percentDiffFromAvg <= VERDICT_BELOW_AVG_MAX) return 'below_average';
  if (percentDiffFromAvg <= VERDICT_AVERAGE_MAX) return 'average';
  return 'above_average';
}

/** Build the comparison block from the stats row (or the target alone when sparse). */
function buildComparison(stats: PriceStatsRow | null, thisPrice: number): PriceComparison {
  if (!stats) {
    // No comparables at all — describe the target against itself so the
    // frontend can render a graceful "not enough data" state without special-casing.
    return {
      min: roundInt(thisPrice),
      max: roundInt(thisPrice),
      avg: roundInt(thisPrice),
      median: roundInt(thisPrice),
      thisPrice: roundInt(thisPrice),
      percentDiffFromAvg: 0,
      verdict: 'average',
    };
  }
  const avg = stats.avg;
  const median = stats.median ?? medianFromSorted(stats.prices);
  const percentDiffFromAvg = avg > 0 ? roundInt(((thisPrice - avg) / avg) * 100) : 0;
  return {
    min: roundInt(stats.min),
    max: roundInt(stats.max),
    avg: roundInt(avg),
    median: roundInt(median),
    thisPrice: roundInt(thisPrice),
    percentDiffFromAvg,
    verdict: classifyVerdict(percentDiffFromAvg),
  };
}

/** Median from an ascending-sorted array — fallback when `$median` is unavailable. */
function medianFromSorted(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Build the price-distribution histogram: BUCKET_COUNT even buckets across
 * [min, max], the count of comparable prices in each, and the index of the
 * bucket the target's price falls in (-1 if outside the range).
 *
 * Prices are the comparable prices PLUS the target price, so the histogram
 * reflects where the target sits among its peers. When min == max (all equal,
 * or a single data point) a single bucket is used.
 */
function buildDistribution(stats: PriceStatsRow | null, thisPrice: number): PriceDistribution {
  const prices = stats ? [...stats.prices, thisPrice] : [thisPrice];
  const min = stats ? Math.min(stats.min, thisPrice) : thisPrice;
  const max = stats ? Math.max(stats.max, thisPrice) : thisPrice;

  if (min === max) {
    const single: DistributionBucket = {
      min: roundInt(min),
      max: roundInt(max),
      count: prices.length,
    };
    return { buckets: [single], thisBucketIndex: 0 };
  }

  const span = max - min;
  const step = span / BUCKET_COUNT;
  const buckets: DistributionBucket[] = [];
  for (let i = 0; i < BUCKET_COUNT; i += 1) {
    const bucketMin = min + step * i;
    const bucketMax = i === BUCKET_COUNT - 1 ? max : min + step * (i + 1);
    buckets.push({ min: roundInt(bucketMin), max: roundInt(bucketMax), count: 0 });
  }

  const bucketIndexFor = (price: number): number => {
    if (price < min || price > max) return -1;
    // Clamp so the inclusive upper bound (max) lands in the last bucket.
    return Math.min(BUCKET_COUNT - 1, Math.floor((price - min) / step));
  };

  for (const price of prices) {
    const idx = bucketIndexFor(price);
    if (idx >= 0) buckets[idx].count += 1;
  }

  return { buckets, thisBucketIndex: bucketIndexFor(thisPrice) };
}

/** Build pricePerSqm, or null when target or area lacks usable square footage. */
function buildPricePerSqm(
  targetSqm: number,
  targetPrice: number,
  areaAvgPricePerSqm: number | null
): PricePerSqm | null {
  if (targetSqm <= 0 || areaAvgPricePerSqm === null) return null;
  return {
    this: roundInt(targetPrice / targetSqm),
    areaAvg: roundInt(areaAvgPricePerSqm),
  };
}

/**
 * Build the neighborhood-vs-city block, or null when:
 *  - the target has no neighborhood,
 *  - the neighborhood scope is effectively the whole city (no distinct contrast), or
 *  - either the neighborhood or the city sample is empty.
 */
function buildNeighborhoodVsCity(
  target: TargetContext,
  neighborhoodAvg: number | null,
  cityAvg: number | null
): NeighborhoodVsCity | null {
  if (!target.neighborhood || neighborhoodAvg === null || cityAvg === null) return null;
  const percentDiff = cityAvg > 0 ? roundInt(((neighborhoodAvg - cityAvg) / cityAvg) * 100) : 0;
  return {
    neighborhood: target.neighborhood,
    city: target.city,
    neighborhoodAvg: roundInt(neighborhoodAvg),
    cityAvg: roundInt(cityAvg),
    percentDiff,
  };
}

/** Build the target context from the populated property document. */
function buildTargetContext(property: IProperty): TargetContext | null {
  // After `.populate('addressId').lean()`, the schema's post-find hook runs
  // `transformAddressFields`, which renames the populated `addressId` to
  // `address` (and deletes `addressId`). Read `address` first, then fall back
  // to the raw `addressId` in case the transform did not run.
  const populated = property as unknown as { address?: IAddress; addressId?: IAddress };
  const address = populated.address ?? populated.addressId ?? null;
  const coords = address?.coordinates?.coordinates;
  if (!address || !Array.isArray(coords) || coords.length !== 2) return null;
  const [longitude, latitude] = coords;
  if (typeof longitude !== 'number' || typeof latitude !== 'number') return null;
  return {
    id: property._id,
    bedrooms: typeof property.bedrooms === 'number' ? property.bedrooms : 0,
    rentMode: property.rentMode ?? 'long_term',
    priceUnit: property.priceUnit ?? 'month',
    currency: property.rent?.currency ?? 'EUR',
    price: property.rent?.amount ?? 0,
    squareFootage: typeof property.squareFootage === 'number' ? property.squareFootage : 0,
    longitude,
    latitude,
    city: address.city,
    neighborhood: address.neighborhood ?? null,
  };
}

/**
 * GET /api/properties/:propertyId/area-insights
 *
 * Returns price context (range, average, median, verdict, distribution and
 * comparable listings) for similar homes in the same area as the target
 * property. Never 500s on sparse data — falls back from a 2 km radius to the
 * whole city, and finally to a target-only "not enough data" response.
 */
export async function getAreaInsights(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { propertyId } = req.params;
    if (!Types.ObjectId.isValid(propertyId)) {
      return next(new AppError('Invalid property ID', 400, 'INVALID_ID'));
    }

    const property = await Property.findById(propertyId).populate('addressId').lean<IProperty | null>();
    if (!property) {
      return next(new AppError('Property not found', 404, 'NOT_FOUND'));
    }

    const target = buildTargetContext(property);
    if (!target) {
      return next(new AppError('Property is missing address coordinates', 422, 'MISSING_COORDINATES'));
    }

    const baseFilter = buildBaseComparableFilter(target);

    // --- Primary scope: comparables within RADIUS_KM (neighborhood scale) ---
    const radiusAddressIds = await resolveRadiusAddressIds(target, RADIUS_KM);
    const radiusStats = await aggregatePriceStats(baseFilter, radiusAddressIds);
    const radiusCount = radiusStats?.count ?? 0;

    // --- Fallback to the whole city when the radius scope is too sparse ---
    const useRadius = radiusCount >= MIN_RADIUS_SAMPLE;
    let basis: Basis;
    let scopeAddressIds: Types.ObjectId[];
    let stats: PriceStatsRow | null;

    if (useRadius) {
      basis = 'radius';
      scopeAddressIds = radiusAddressIds;
      stats = radiusStats;
    } else {
      basis = 'city';
      scopeAddressIds = await resolveCityAddressIds(target);
      stats = await aggregatePriceStats(baseFilter, scopeAddressIds);
    }

    const areaLabel =
      basis === 'radius' ? target.neighborhood ?? target.city : target.city;
    const sampleSize = stats?.count ?? 0;

    // --- Price-per-sqm over the chosen scope ---
    const areaPricePerSqm = await aggregateAreaPricePerSqm(baseFilter, scopeAddressIds);

    // --- Neighborhood vs city contrast (independent of the chosen scope) ---
    // Only meaningful when the listing has a neighborhood AND the neighborhood
    // is a strict subset of the city (otherwise the two averages are identical).
    const neighborhoodAddressIds = await resolveNeighborhoodAddressIds(target);
    const cityAddressIdsForContrast =
      basis === 'city' ? scopeAddressIds : await resolveCityAddressIds(target);
    const neighborhoodIsWholeCity =
      neighborhoodAddressIds.length > 0 &&
      neighborhoodAddressIds.length === cityAddressIdsForContrast.length;

    let neighborhoodVsCity: NeighborhoodVsCity | null = null;
    if (target.neighborhood && neighborhoodAddressIds.length > 0 && !neighborhoodIsWholeCity) {
      const [neighborhoodAvg, cityAvg] = await Promise.all([
        aggregateAvg(baseFilter, neighborhoodAddressIds),
        aggregateAvg(baseFilter, cityAddressIdsForContrast),
      ]);
      neighborhoodVsCity = buildNeighborhoodVsCity(target, neighborhoodAvg, cityAvg);
    }

    // --- Comparable documents (nearest first, excluding the target) ---
    // scopeAddressIds is already distance-ordered (via `$near`); preserve that
    // order so the closest comparables come first.
    const comparables = await fetchComparables(baseFilter, scopeAddressIds);

    const response: AreaInsightsResponse = {
      basis,
      radiusKm: RADIUS_KM,
      areaLabel,
      currency: target.currency,
      priceUnit: target.priceUnit,
      sampleSize,
      comparison: buildComparison(stats, target.price),
      pricePerSqm: buildPricePerSqm(target.squareFootage, target.price, areaPricePerSqm),
      distribution: buildDistribution(stats, target.price),
      neighborhoodVsCity,
      comparables,
    };

    res.json(successResponse(response, 'Area insights retrieved successfully'));
  } catch (error) {
    next(error);
  }
}

/**
 * Fetch up to COMPARABLES_LIMIT full comparable property documents, ordered
 * nearest-first. `scopeAddressIds` is distance-ordered; we query the matching
 * comparables and then re-sort them to honour that ordering (a `$in` query does
 * not preserve array order on its own).
 */
async function fetchComparables(
  baseFilter: Record<string, unknown>,
  scopeAddressIds: Types.ObjectId[]
): Promise<Record<string, unknown>[]> {
  if (scopeAddressIds.length === 0) return [];
  const orderById = new Map<string, number>();
  scopeAddressIds.forEach((id, index) => orderById.set(id.toString(), index));

  const docs = await Property.find({ ...baseFilter, addressId: { $in: scopeAddressIds } })
    .populate('addressId')
    .lean<Record<string, unknown>[]>();

  docs.sort((a, b) => {
    const aId = extractAddressId(a);
    const bId = extractAddressId(b);
    const aRank = aId ? orderById.get(aId) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
    const bRank = bId ? orderById.get(bId) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
    return aRank - bRank;
  });

  return docs.slice(0, COMPARABLES_LIMIT);
}

/**
 * Extract the address ObjectId (as a string) from a lean property document.
 * After population the address may live under `address` (post-transform) or
 * `addressId` (raw), as a nested object or a bare id.
 */
function extractAddressId(doc: Record<string, unknown>): string | null {
  const candidate = doc.address ?? doc.addressId;
  if (!candidate) return null;
  if (typeof candidate === 'object') {
    const nested = candidate as { _id?: unknown; id?: unknown };
    const id = nested._id ?? nested.id;
    return id ? String(id) : null;
  }
  return String(candidate);
}
