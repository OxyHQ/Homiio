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
 * Like-for-like guarantee: a target is compared only against listings carrying
 * the SAME offering (long-term monthly vs long-term monthly, short-term nightly
 * vs short-term nightly, sale price vs sale price), so a €/month listing is
 * never mixed with a €/night one.
 */

import type { Request, Response, NextFunction } from 'express';
import { Types, type Model } from 'mongoose';
import { OfferingType } from '@homiio/shared-types';
import type {
  PropertyAreaInsights,
  AreaPriceVerdict,
  AreaInsightsBasis,
  AreaPriceComparison,
  AreaPriceDistribution,
  AreaPriceDistributionBucket,
  AreaPricePerSqm,
  AreaNeighborhoodVsCity,
} from '@homiio/shared-types';
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
/**
 * Over-fetch factor for the comparables-list query. `scopeAddressIds` is
 * distance-ordered, so we slice it to `COMPARABLES_LIMIT * this` before the
 * `find` (rather than fetching the entire scope and slicing in memory). The
 * cushion absorbs addresses that have 0/multiple matching comparables so we
 * still surface ~COMPARABLES_LIMIT nearest docs without scanning hundreds.
 */
const COMPARABLES_OVERFETCH_FACTOR = 3;
/** Percent thresholds (target-vs-average) that map a price difference to a verdict. */
const VERDICT_GOOD_DEAL_MAX = -7;
const VERDICT_BELOW_AVG_MAX = -2;
const VERDICT_AVERAGE_MAX = 2;

/**
 * Mongo field paths the comparison can be denominated in, one per offering. A
 * target is compared only against listings carrying the same offering, in the
 * matching price field, so a monthly figure is never mixed with a nightly one
 * or a sale total.
 */
const PRICE_FIELD_LONG_TERM = 'longTermRent.monthlyAmount';
const PRICE_FIELD_SHORT_TERM = 'shortTermRent.nightlyRate';
const PRICE_FIELD_SALE = 'sale.price';
type PriceField =
  | typeof PRICE_FIELD_LONG_TERM
  | typeof PRICE_FIELD_SHORT_TERM
  | typeof PRICE_FIELD_SALE;

/** The offering each price field belongs to, for the comparable membership filter. */
const OFFERING_FOR_PRICE_FIELD: Record<PriceField, OfferingType> = {
  [PRICE_FIELD_LONG_TERM]: OfferingType.LONG_TERM_RENT,
  [PRICE_FIELD_SHORT_TERM]: OfferingType.SHORT_TERM_RENT,
  [PRICE_FIELD_SALE]: OfferingType.SALE,
};

/** A short-term-mode price unit label, for the response `priceUnit` field. */
const PRICE_UNIT_MONTH = 'month';
const PRICE_UNIT_NIGHT = 'night';
const PRICE_UNIT_SALE = 'sale';

/**
 * Outgoing response shape. Field-for-field the shared `PropertyAreaInsights`
 * contract, except `comparables`: the shared type exposes full `Property[]`,
 * while this controller returns lean projections (`Record<string, unknown>[]`)
 * to avoid eagerly materialising Mongoose documents. The boundary is narrowed
 * here rather than loosening the shared type.
 */
type AreaInsightsResponse = Omit<PropertyAreaInsights, 'comparables'> & {
  comparables: Record<string, unknown>[];
};

/** Aggregation row produced by the comparable price-stats pipeline. */
interface PriceStatsRow {
  count: number;
  min: number;
  max: number;
  avg: number;
  median: number | null;
  prices: number[];
  /**
   * Average of `<priceField> / squareFootage` over the SAME scope, restricted to
   * comparables with `squareFootage > 0` (others are mapped to `$$REMOVE` so the
   * `$avg` ignores them). `null` when no comparable in scope exposes a usable
   * square footage — folded into this pipeline to save a Mongo round-trip.
   */
  avgPricePerSqm: number | null;
}

/** Aggregation row produced by an average-only pipeline. */
interface AvgRow {
  avg: number;
  count: number;
}

/** Lean Address projection used for geo id-resolution. */
type AddressGeoLean = { _id: Types.ObjectId };

/** Target fields needed to build the comparable query and the response. */
interface TargetContext {
  id: Types.ObjectId;
  bedrooms: number;
  /** Human price-unit label for the response (`month` / `night` / `sale`). */
  priceUnit: string;
  currency: string;
  /** The target's own price in the comparison basis (the offering's price field). */
  price: number;
  /**
   * Which price the comparison is denominated in — the price field of the
   * target's primary offering. Comparables are matched on the SAME offering and
   * the SAME field, so a monthly figure is never mixed with a nightly one.
   */
  priceField: PriceField;
  squareFootage: number;
  longitude: number;
  latitude: number;
  city: string;
  neighborhood: string | null;
}

/**
 * Base comparable filter (everything except the geo / city scope).
 *
 * Comparable = a published, available listing that is NOT the target, within
 * ±BEDROOM_TOLERANCE bedrooms, carrying the SAME offering as the target's
 * primary basis, with a positive price in the matching field. Matching on the
 * offering (rather than a price-unit string) is what keeps prices like-for-like.
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
    offerings: OFFERING_FOR_PRICE_FIELD[target.priceField],
    [target.priceField]: { $gt: 0 },
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
 * Run the comparable price-stats aggregation over the given address-id scope,
 * denominated in `priceField` (the target offering's price field). Returns null
 * when the scope yields no comparables. Uses the `$median` accumulator (MongoDB 7.0+)
 * and also keeps the sorted price array so the histogram can be built without a
 * second pass.
 *
 * `avgPricePerSqm` is folded into this same `$group` (same `$match` scope) to
 * avoid a separate Mongo round-trip: it averages `<priceField> / squareFootage`
 * over comparables with `squareFootage > 0`, mapping the rest to `$$REMOVE` so
 * the `$avg` ignores them — yielding the identical value a `squareFootage > 0`
 * `$match` would. `$avg` returns `null` when every comparable is removed.
 */
async function aggregatePriceStats(
  baseFilter: Record<string, unknown>,
  addressIds: Types.ObjectId[],
  priceField: PriceField
): Promise<PriceStatsRow | null> {
  if (addressIds.length === 0) return null;
  const priceRef = `$${priceField}`;
  const rows = await Property.aggregate<PriceStatsRow>([
    { $match: { ...baseFilter, addressId: { $in: addressIds } } },
    { $sort: { [priceField]: 1 } },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        min: { $min: priceRef },
        max: { $max: priceRef },
        avg: { $avg: priceRef },
        median: { $median: { input: priceRef, method: 'approximate' } },
        prices: { $push: priceRef },
        avgPricePerSqm: {
          $avg: {
            $cond: [
              { $gt: ['$squareFootage', 0] },
              { $divide: [priceRef, '$squareFootage'] },
              '$$REMOVE',
            ],
          },
        },
      },
    },
  ]);
  const row = rows[0];
  if (!row || row.count === 0) return null;
  return row;
}

/** Average price (in `priceField`) over a scope; returns null when empty. */
async function aggregateAvg(
  baseFilter: Record<string, unknown>,
  addressIds: Types.ObjectId[],
  priceField: PriceField
): Promise<number | null> {
  if (addressIds.length === 0) return null;
  const rows = await Property.aggregate<AvgRow>([
    { $match: { ...baseFilter, addressId: { $in: addressIds } } },
    { $group: { _id: null, avg: { $avg: `$${priceField}` }, count: { $sum: 1 } } },
  ]);
  const row = rows[0];
  if (!row || row.count === 0) return null;
  return row.avg;
}

/** Map a percent difference from the average to a verdict. */
function classifyVerdict(percentDiffFromAvg: number): AreaPriceVerdict {
  if (percentDiffFromAvg <= VERDICT_GOOD_DEAL_MAX) return 'good_deal';
  if (percentDiffFromAvg <= VERDICT_BELOW_AVG_MAX) return 'below_average';
  if (percentDiffFromAvg <= VERDICT_AVERAGE_MAX) return 'average';
  return 'above_average';
}

/** Build the comparison block from the stats row (or the target alone when sparse). */
function buildComparison(stats: PriceStatsRow | null, thisPrice: number): AreaPriceComparison {
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
function buildDistribution(stats: PriceStatsRow | null, thisPrice: number): AreaPriceDistribution {
  const prices = stats ? [...stats.prices, thisPrice] : [thisPrice];
  const min = stats ? Math.min(stats.min, thisPrice) : thisPrice;
  const max = stats ? Math.max(stats.max, thisPrice) : thisPrice;

  if (min === max) {
    const single: AreaPriceDistributionBucket = {
      min: roundInt(min),
      max: roundInt(max),
      count: prices.length,
    };
    return { buckets: [single], thisBucketIndex: 0 };
  }

  const span = max - min;
  const step = span / BUCKET_COUNT;
  const buckets: AreaPriceDistributionBucket[] = [];
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
): AreaPricePerSqm | null {
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
): AreaNeighborhoodVsCity | null {
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

/**
 * Resolve the comparison BASIS for a target listing — the single offering its
 * price comparison is denominated in.
 *
 * Precedence (a multi-offering listing has ONE comparison basis): long-term
 * monthly rent → short-term nightly rate → sale price. EXCHANGE carries no
 * monetary price, so an exchange-only listing has no basis (the caller then
 * returns `sampleSize: 0` rather than comparing against a 0 basis).
 */
function resolvePriceBasis(
  property: IProperty
): { priceField: PriceField; price: number; currency: string; priceUnit: string } | null {
  const monthly = property.longTermRent?.monthlyAmount;
  if (typeof monthly === 'number' && monthly > 0) {
    return {
      priceField: PRICE_FIELD_LONG_TERM,
      price: monthly,
      currency: property.longTermRent?.currency ?? 'EUR',
      priceUnit: PRICE_UNIT_MONTH,
    };
  }
  const nightly = property.shortTermRent?.nightlyRate;
  if (typeof nightly === 'number' && nightly > 0) {
    return {
      priceField: PRICE_FIELD_SHORT_TERM,
      price: nightly,
      currency: property.shortTermRent?.currency ?? 'EUR',
      priceUnit: PRICE_UNIT_NIGHT,
    };
  }
  const salePrice = property.sale?.price;
  if (typeof salePrice === 'number' && salePrice > 0) {
    return {
      priceField: PRICE_FIELD_SALE,
      price: salePrice,
      currency: property.sale?.currency ?? 'EUR',
      priceUnit: PRICE_UNIT_SALE,
    };
  }
  return null;
}

/**
 * Build the target context from the populated property document.
 *
 * Returns null when the property lacks usable address coordinates (the caller
 * maps this to a 422) OR when it has no positive price in either basis (the
 * caller maps this to a graceful `sampleSize: 0` response). The two cases are
 * distinguished by `reason`.
 */
function buildTargetContext(
  property: IProperty
): { context: TargetContext } | { reason: 'no_coordinates' | 'no_price' } {
  // After `.populate('addressId').lean()`, the schema's post-find hook runs
  // `transformAddressFields`, which renames the populated `addressId` to
  // `address` (and deletes `addressId`). Read `address` first, then fall back
  // to the raw `addressId` in case the transform did not run.
  const populated = property as unknown as { address?: IAddress; addressId?: IAddress };
  const address = populated.address ?? populated.addressId ?? null;
  const coords = address?.coordinates?.coordinates;
  if (!address || !Array.isArray(coords) || coords.length !== 2) return { reason: 'no_coordinates' };
  const [longitude, latitude] = coords;
  if (typeof longitude !== 'number' || typeof latitude !== 'number') return { reason: 'no_coordinates' };

  const basis = resolvePriceBasis(property);
  if (!basis) return { reason: 'no_price' };

  return {
    context: {
      id: property._id,
      bedrooms: typeof property.bedrooms === 'number' ? property.bedrooms : 0,
      priceUnit: basis.priceUnit,
      currency: basis.currency,
      price: basis.price,
      priceField: basis.priceField,
      squareFootage: typeof property.squareFootage === 'number' ? property.squareFootage : 0,
      longitude,
      latitude,
      city: address.city,
      neighborhood: address.neighborhood ?? null,
    },
  };
}

/**
 * Compute the neighborhood-vs-city contrast block (or null).
 *
 * Returns null without issuing ANY query when the target has no neighborhood —
 * so neighborhood-less listings never pay for an unbounded city `$near` scan
 * whose result would only be discarded. Otherwise resolves the neighborhood
 * scope and the city-wide contrast scope (reusing `cityScopeAddressIds` when
 * the chosen scope already IS the city), and returns null when the neighborhood
 * is effectively the whole city (no distinct contrast) or either sample is
 * empty.
 *
 * `cityScopeAddressIds` is the already-resolved city scope when `basis==='city'`
 * (so the contrast reuses it instead of re-querying); null on the radius path,
 * where the contrast city scope is resolved here on demand.
 */
async function buildNeighborhoodContrast(
  target: TargetContext,
  baseFilter: Record<string, unknown>,
  cityScopeAddressIds: Types.ObjectId[] | null
): Promise<AreaNeighborhoodVsCity | null> {
  if (!target.neighborhood) return null;

  const [neighborhoodAddressIds, cityAddressIdsForContrast] = await Promise.all([
    resolveNeighborhoodAddressIds(target),
    cityScopeAddressIds ? Promise.resolve(cityScopeAddressIds) : resolveCityAddressIds(target),
  ]);

  const neighborhoodIsWholeCity =
    neighborhoodAddressIds.length > 0 &&
    neighborhoodAddressIds.length === cityAddressIdsForContrast.length;
  if (neighborhoodAddressIds.length === 0 || neighborhoodIsWholeCity) return null;

  const [neighborhoodAvg, cityAvg] = await Promise.all([
    aggregateAvg(baseFilter, neighborhoodAddressIds, target.priceField),
    aggregateAvg(baseFilter, cityAddressIdsForContrast, target.priceField),
  ]);
  return buildNeighborhoodVsCity(target, neighborhoodAvg, cityAvg);
}

/**
 * Build the graceful empty (`sampleSize: 0`) payload for a listing that has no
 * positive price in any basis. Reuses the same null-stats comparison/distribution
 * shape as the "no comparables found" path so the frontend's "not enough data"
 * state renders identically. No queries are issued.
 */
function buildEmptyInsights(property: IProperty): AreaInsightsResponse {
  return {
    basis: 'city',
    radiusKm: RADIUS_KM,
    areaLabel: '',
    currency:
      property.longTermRent?.currency ??
      property.shortTermRent?.currency ??
      property.sale?.currency ??
      'EUR',
    priceUnit: PRICE_UNIT_MONTH,
    sampleSize: 0,
    comparison: buildComparison(null, 0),
    pricePerSqm: null,
    distribution: buildDistribution(null, 0),
    neighborhoodVsCity: null,
    comparables: [],
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

    const targetResult = buildTargetContext(property);
    if ('reason' in targetResult) {
      if (targetResult.reason === 'no_coordinates') {
        return next(new AppError('Property is missing address coordinates', 422, 'MISSING_COORDINATES'));
      }
      // `no_price`: no positive rent and no positive sale price — there is no
      // meaningful basis to compare against, so return a graceful empty result
      // (sampleSize 0) rather than a comparison against a 0 basis. The frontend
      // hides the section when sampleSize === 0.
      res.json(successResponse(buildEmptyInsights(property), 'Area insights retrieved successfully'));
      return;
    }
    const target = targetResult.context;

    const baseFilter = buildBaseComparableFilter(target);

    // --- Primary scope: comparables within RADIUS_KM (neighborhood scale) ---
    // Inherently sequential: the radius price-stats decide whether the radius
    // scope is dense enough, which in turn decides the scope everything below
    // operates on. Price-per-sqm is folded into `aggregatePriceStats`, so this
    // is the only stats round-trip per scope.
    const radiusAddressIds = await resolveRadiusAddressIds(target, RADIUS_KM);
    const radiusStats = await aggregatePriceStats(baseFilter, radiusAddressIds, target.priceField);
    const radiusCount = radiusStats?.count ?? 0;

    // --- Fallback to the whole city when the radius scope is too sparse ---
    const useRadius = radiusCount >= MIN_RADIUS_SAMPLE;
    let basis: AreaInsightsBasis;
    let scopeAddressIds: Types.ObjectId[];
    let stats: PriceStatsRow | null;

    if (useRadius) {
      basis = 'radius';
      scopeAddressIds = radiusAddressIds;
      stats = radiusStats;
    } else {
      basis = 'city';
      scopeAddressIds = await resolveCityAddressIds(target);
      stats = await aggregatePriceStats(baseFilter, scopeAddressIds, target.priceField);
    }

    const areaLabel =
      basis === 'radius' ? target.neighborhood ?? target.city : target.city;
    const sampleSize = stats?.count ?? 0;

    // --- Independent work, run concurrently once the scope is fixed ---
    //  - comparable documents over the chosen scope (nearest-first ordering is
    //    preserved by `fetchComparables`, since `$in` does not honour the
    //    distance-ordered `scopeAddressIds`); and
    //  - the neighborhood-vs-city contrast, which resolves its own scopes
    //    (reusing `scopeAddressIds` on the city path).
    // Neither depends on the other, so they overlap on the wire.
    const [comparables, neighborhoodVsCity] = await Promise.all([
      fetchComparables(baseFilter, scopeAddressIds),
      buildNeighborhoodContrast(target, baseFilter, basis === 'city' ? scopeAddressIds : null),
    ]);

    const response: AreaInsightsResponse = {
      basis,
      radiusKm: RADIUS_KM,
      areaLabel,
      currency: target.currency,
      priceUnit: target.priceUnit,
      sampleSize,
      comparison: buildComparison(stats, target.price),
      // Price-per-sqm comes from the folded `avgPricePerSqm` accumulator on the
      // chosen scope's stats row (null when the scope is empty or sqm-less).
      pricePerSqm: buildPricePerSqm(target.squareFootage, target.price, stats?.avgPricePerSqm ?? null),
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
 * nearest-first.
 *
 * `scopeAddressIds` is distance-ordered, so we cap the query to the nearest
 * `COMPARABLES_LIMIT * COMPARABLES_OVERFETCH_FACTOR` addresses (the cushion
 * absorbs addresses with 0/multiple comparables) instead of fetching+populating
 * the ENTIRE scope and slicing to 12 in memory. We then re-sort the returned
 * docs to honour the distance ordering (a `$in` query does not preserve array
 * order on its own) and slice to COMPARABLES_LIMIT. The full-scope STATS
 * aggregation is unaffected — only this comparables-list fetch is capped.
 */
async function fetchComparables(
  baseFilter: Record<string, unknown>,
  scopeAddressIds: Types.ObjectId[]
): Promise<Record<string, unknown>[]> {
  if (scopeAddressIds.length === 0) return [];
  // Over-fetch only the nearest slice of the distance-ordered scope.
  const nearestAddressIds = scopeAddressIds.slice(0, COMPARABLES_LIMIT * COMPARABLES_OVERFETCH_FACTOR);
  const orderById = new Map<string, number>();
  nearestAddressIds.forEach((id, index) => orderById.set(id.toString(), index));

  const docs = await Property.find({ ...baseFilter, addressId: { $in: nearestAddressIds } })
    .limit(COMPARABLES_LIMIT * COMPARABLES_OVERFETCH_FACTOR)
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
