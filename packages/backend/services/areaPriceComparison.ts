/**
 * Shared area price comparison helpers.
 *
 * Single authority for comparable-market verdict thresholds and aggregation
 * logic used by area-insights and price-ethics scoring.
 *
 * ## The two-phase geo query is gone, and that is the whole shape of the port
 *
 * Mongo could not join, so every scope here was a two-phase query: find the
 * matching ADDRESS ids (`$near`, by city, by neighbourhood), collect them into
 * an array, then `$in` that array against `properties.addressId`. The arrays
 * were UNCAPPED — a city-wide comparison loaded every address id in the city
 * into memory to build one aggregate.
 *
 * `properties INNER JOIN addresses` makes each of those an ordinary predicate,
 * so the functions that used to RETURN id lists now return `SQL` scopes and the
 * aggregates run in one statement. Nothing intermediate is materialised, and
 * the caps that existed only to bound the id array are unnecessary rather than
 * merely raised.
 */

import { and, eq, gt, gte, lte, ne, sql, type SQL } from 'drizzle-orm';
import { OfferingType } from '@homiio/shared-types';
import type {
  AreaPriceVerdict,
  AreaInsightsBasis,
  AreaPriceComparison,
  AreaPriceDistribution,
  AreaPriceDistributionBucket,
  AreaPricePerSqm,
  AreaNeighborhoodVsCity,
} from '@homiio/shared-types';
import { getDb } from '../db/postgres';
import { addresses, properties } from '../db/schema';
import {
  allOf,
  findProperties,
  type DistanceOrigin,
} from '../db/properties/propertyReads';
import { distanceTo, withinCircle } from '../db/properties/propertyGeo';
import { serializeProperty } from '../db/properties/propertySerializer';

export const RADIUS_KM = 2;
const METERS_PER_KM = 1000;
export const MIN_RADIUS_SAMPLE = 5;
const BEDROOM_TOLERANCE = 1;
export const BUCKET_COUNT = 8;
export const COMPARABLES_LIMIT = 12;
export const COMPARABLES_OVERFETCH_FACTOR = 3;
const VERDICT_GOOD_DEAL_MAX = -7;
const VERDICT_BELOW_AVG_MAX = -2;
const VERDICT_AVERAGE_MAX = 2;

export const PRICE_FIELD_LONG_TERM = 'longTermRent.monthlyAmount';
export const PRICE_FIELD_SHORT_TERM = 'shortTermRent.nightlyRate';
export const PRICE_FIELD_SALE = 'sale.price';
export type PriceField =
  | typeof PRICE_FIELD_LONG_TERM
  | typeof PRICE_FIELD_SHORT_TERM
  | typeof PRICE_FIELD_SALE;

const OFFERING_FOR_PRICE_FIELD: Record<PriceField, OfferingType> = {
  [PRICE_FIELD_LONG_TERM]: OfferingType.LONG_TERM_RENT,
  [PRICE_FIELD_SHORT_TERM]: OfferingType.SHORT_TERM_RENT,
  [PRICE_FIELD_SALE]: OfferingType.SALE,
};

export const PRICE_UNIT_MONTH = 'month';
export const PRICE_UNIT_NIGHT = 'night';
export const PRICE_UNIT_SALE = 'sale';

export interface PriceStatsRow {
  count: number;
  min: number;
  max: number;
  avg: number;
  median: number | null;
  prices: number[];
  avgPricePerSqm: number | null;
}

/**
 * The address a target listing carries, in the shape
 * `db/addresses/addressSerializer` puts on the wire.
 *
 * The geo ids are plain STRINGS and the geo NAMES ride alongside them — that is
 * the part that changed, and it is why the populate-or-ObjectId union this
 * module used to unwrap is gone.
 *
 * `coordinates` stays the positional GeoJSON `[lng, lat]` pair, deliberately:
 * the STORAGE is two named columns (`addresses.longitude` / `.latitude`, which
 * the table generates its PostGIS point from), but the WIRE kept its historical
 * shape so no client had to change. Reading it here means reading what the
 * serializer actually emits rather than what the row holds.
 */
export interface PopulatedGeoAddress {
  coordinates?: { coordinates?: [number, number] };
  cityId?: string | null;
  neighborhoodId?: string | null;
  cityName?: string | null;
  neighborhoodName?: string | null;
  regionName?: string | null;
}

/**
 * A listing as this module reads it — the serialized wire shape, not a row and
 * not a Mongoose document. Structural on purpose: the callers hold a
 * `serializeProperty` result and nothing here needs a column the wire omits.
 */
export interface ComparableProperty {
  id?: unknown;
  bedrooms?: unknown;
  squareFootage?: unknown;
  address?: PopulatedGeoAddress;
  longTermRent?: { monthlyAmount?: unknown; currency?: unknown };
  shortTermRent?: { nightlyRate?: unknown; currency?: unknown };
  sale?: { price?: unknown; currency?: unknown };
}

export interface TargetContext {
  id: string;
  bedrooms: number;
  priceUnit: string;
  currency: string;
  price: number;
  priceField: PriceField;
  squareFootage: number;
  longitude: number;
  latitude: number;
  cityId: string;
  neighborhoodId: string | null;
  city: string;
  neighborhood: string | null;
}

export interface MarketVerdictResult {
  hasMarketData: boolean;
  marketVerdict?: AreaPriceVerdict;
  percentDiffFromAvg?: number;
  sampleSize: number;
}

/** The price COLUMN behind each wire price path. */
const PRICE_COLUMN = {
  [PRICE_FIELD_LONG_TERM]: properties.longTermRentMonthlyAmount,
  [PRICE_FIELD_SHORT_TERM]: properties.shortTermRentNightlyRate,
  [PRICE_FIELD_SALE]: properties.salePrice,
} as const;

/**
 * What makes another listing comparable to the target: same offering, a priced
 * one, published and available, within a bedroom of it, and not the target.
 */
export function buildBaseComparableFilter(target: TargetContext): SQL {
  const priceColumn = PRICE_COLUMN[target.priceField];
  return and(
    ne(properties.id, target.id),
    eq(properties.status, 'published'),
    eq(properties.availabilityIsAvailable, true),
    gte(properties.bedrooms, target.bedrooms - BEDROOM_TOLERANCE),
    lte(properties.bedrooms, target.bedrooms + BEDROOM_TOLERANCE),
    sql`${properties.offerings} @> array[${OFFERING_FOR_PRICE_FIELD[target.priceField]}]::text[]`,
    gt(priceColumn, 0),
  ) as SQL;
}

/**
 * The three comparison SCOPES, as predicates rather than id lists.
 *
 * Each was a separate `Address.find(...).select('_id')` whose result was `$in`'d
 * against the listings. `propertyReads` already inner-joins `addresses`, so the
 * address column is in scope and the whole first phase disappears — including
 * its uncapped intermediate array.
 */
export function radiusScope(target: TargetContext, radiusKm: number): SQL {
  return withinCircle({
    longitude: target.longitude,
    latitude: target.latitude,
    radiusMeters: radiusKm * METERS_PER_KM,
  });
}

export function cityScope(target: TargetContext): SQL {
  return eq(addresses.cityId, target.cityId);
}

/** `null` when the target has no neighbourhood — there is no scope to build. */
export function neighborhoodScope(target: TargetContext): SQL | null {
  return target.neighborhoodId ? eq(addresses.neighborhoodId, target.neighborhoodId) : null;
}

export function roundInt(value: number): number {
  return Number.isFinite(value) ? Math.round(value) : 0;
}

/**
 * Min / max / avg / median / the whole sorted price list, plus the average
 * price per m², over one scope.
 *
 * `percentile_cont` is an EXACT median where Mongo's `$median` was declared
 * `method: 'approximate'`; on the sample sizes this runs over (a
 * neighbourhood's listings) the exact one costs nothing and the approximate one
 * was never the intent, only what was available.
 *
 * `avg_price_per_sqm` filters to listings with a real area rather than dividing
 * by zero — the `$cond` + `$$REMOVE` this replaces, said in SQL.
 */
export async function aggregatePriceStats(
  baseFilter: SQL,
  scope: SQL | null,
  priceField: PriceField,
): Promise<PriceStatsRow | null> {
  if (!scope) return null;
  const priceColumn = PRICE_COLUMN[priceField];
  const [row] = await getDb()
    .select({
      count: sql<number>`count(*)::int`,
      min: sql<number>`min(${priceColumn})`,
      max: sql<number>`max(${priceColumn})`,
      avg: sql<number>`avg(${priceColumn})`,
      median: sql<number | null>`percentile_cont(0.5) within group (order by ${priceColumn})`,
      prices: sql<number[]>`array_agg(${priceColumn} order by ${priceColumn})`,
      avgPricePerSqm: sql<number | null>`avg(${priceColumn} / nullif(${properties.squareFootage}, 0))`,
    })
    .from(properties)
    .innerJoin(addresses, eq(properties.addressId, addresses.id))
    .where(and(baseFilter, scope));

  if (!row || row.count === 0) return null;
  // postgres.js returns `numeric` aggregates as strings; the contract is
  // numbers, and every consumer arithmetics on them.
  return {
    count: row.count,
    min: Number(row.min),
    max: Number(row.max),
    avg: Number(row.avg),
    median: row.median === null ? null : Number(row.median),
    prices: (row.prices ?? []).map(Number),
    avgPricePerSqm: row.avgPricePerSqm === null ? null : Number(row.avgPricePerSqm),
  };
}

export async function aggregateAvg(
  baseFilter: SQL,
  scope: SQL | null,
  priceField: PriceField,
): Promise<number | null> {
  if (!scope) return null;
  const [row] = await getDb()
    .select({
      count: sql<number>`count(*)::int`,
      avg: sql<number>`avg(${PRICE_COLUMN[priceField]})`,
    })
    .from(properties)
    .innerJoin(addresses, eq(properties.addressId, addresses.id))
    .where(and(baseFilter, scope));
  if (!row || row.count === 0) return null;
  return Number(row.avg);
}

export function classifyVerdict(percentDiffFromAvg: number): AreaPriceVerdict {
  if (percentDiffFromAvg <= VERDICT_GOOD_DEAL_MAX) return 'good_deal';
  if (percentDiffFromAvg <= VERDICT_BELOW_AVG_MAX) return 'below_average';
  if (percentDiffFromAvg <= VERDICT_AVERAGE_MAX) return 'average';
  return 'above_average';
}

export function buildComparison(stats: PriceStatsRow | null, thisPrice: number): AreaPriceComparison {
  if (!stats) {
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

function medianFromSorted(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function buildDistribution(stats: PriceStatsRow | null, thisPrice: number): AreaPriceDistribution {
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
    return Math.min(BUCKET_COUNT - 1, Math.floor((price - min) / step));
  };

  for (const price of prices) {
    const idx = bucketIndexFor(price);
    if (idx >= 0) buckets[idx].count += 1;
  }

  return { buckets, thisBucketIndex: bucketIndexFor(thisPrice) };
}

export function buildPricePerSqm(
  targetSqm: number,
  targetPrice: number,
  areaAvgPricePerSqm: number | null,
): AreaPricePerSqm | null {
  if (targetSqm <= 0 || areaAvgPricePerSqm === null) return null;
  return {
    this: roundInt(targetPrice / targetSqm),
    areaAvg: roundInt(areaAvgPricePerSqm),
  };
}

export function buildNeighborhoodVsCity(
  target: TargetContext,
  neighborhoodAvg: number | null,
  cityAvg: number | null,
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

/** A currency code off the wire, defaulting to the schema's own default. */
function asCurrency(value: unknown): string {
  return typeof value === 'string' && value.length > 0 ? value : 'EUR';
}

export function resolvePriceBasis(
  property: ComparableProperty,
): { priceField: PriceField; price: number; currency: string; priceUnit: string } | null {
  const monthly = property.longTermRent?.monthlyAmount;
  if (typeof monthly === 'number' && monthly > 0) {
    return {
      priceField: PRICE_FIELD_LONG_TERM,
      price: monthly,
      currency: asCurrency(property.longTermRent?.currency),
      priceUnit: PRICE_UNIT_MONTH,
    };
  }
  const nightly = property.shortTermRent?.nightlyRate;
  if (typeof nightly === 'number' && nightly > 0) {
    return {
      priceField: PRICE_FIELD_SHORT_TERM,
      price: nightly,
      currency: asCurrency(property.shortTermRent?.currency),
      priceUnit: PRICE_UNIT_NIGHT,
    };
  }
  const salePrice = property.sale?.price;
  if (typeof salePrice === 'number' && salePrice > 0) {
    return {
      priceField: PRICE_FIELD_SALE,
      price: salePrice,
      currency: asCurrency(property.sale?.currency),
      priceUnit: PRICE_UNIT_SALE,
    };
  }
  return null;
}

export function buildTargetContext(
  property: ComparableProperty,
): { context: TargetContext } | { reason: 'no_coordinates' | 'no_price' } {
  const address = property.address;
  const coords = address?.coordinates?.coordinates;
  if (!Array.isArray(coords) || coords.length !== 2) return { reason: 'no_coordinates' };
  const [longitude, latitude] = coords;
  if (typeof longitude !== 'number' || typeof latitude !== 'number') {
    return { reason: 'no_coordinates' };
  }
  if (!address?.cityId) return { reason: 'no_coordinates' };

  const basis = resolvePriceBasis(property);
  if (!basis) return { reason: 'no_price' };

  return {
    context: {
      id: String(property.id),
      bedrooms: typeof property.bedrooms === 'number' ? property.bedrooms : 0,
      priceUnit: basis.priceUnit,
      currency: basis.currency,
      price: basis.price,
      priceField: basis.priceField,
      squareFootage: typeof property.squareFootage === 'number' ? property.squareFootage : 0,
      longitude,
      latitude,
      cityId: address.cityId,
      neighborhoodId: address.neighborhoodId ?? null,
      // The geo NAMES ride on the serialized address (the four LEFT JOINs
      // `propertyReads` already makes), so there is no populate-or-id union
      // left to unwrap — which is what `extractGeoRef` existed for.
      city: address.cityName ?? '',
      neighborhood: address.neighborhoodName ?? null,
    },
  };
}

/**
 * "This neighbourhood versus the rest of the city", or null when the contrast
 * would be meaningless.
 *
 * The Mongo version decided "the neighbourhood IS the whole city" by comparing
 * the LENGTHS of two address-id arrays — which is what it could do, having
 * materialised both. With scopes there are no arrays to compare, so the same
 * question is asked directly: count the listings in each and refuse when the
 * neighbourhood contributes every one of the city's. Same answer, and it no
 * longer needs the city's every address id in memory to reach it.
 */
export async function buildNeighborhoodContrast(
  target: TargetContext,
  baseFilter: SQL,
): Promise<AreaNeighborhoodVsCity | null> {
  if (!target.neighborhood) return null;
  const neighborhood = neighborhoodScope(target);
  if (!neighborhood) return null;
  const city = cityScope(target);

  const [neighborhoodCount, cityCount] = await Promise.all([
    countComparables(baseFilter, neighborhood),
    countComparables(baseFilter, city),
  ]);
  if (neighborhoodCount === 0 || neighborhoodCount === cityCount) return null;

  const [neighborhoodAvg, cityAvg] = await Promise.all([
    aggregateAvg(baseFilter, neighborhood, target.priceField),
    aggregateAvg(baseFilter, city, target.priceField),
  ]);
  return buildNeighborhoodVsCity(target, neighborhoodAvg, cityAvg);
}

/** How many comparable listings fall in one scope. */
export async function countComparables(baseFilter: SQL, scope: SQL): Promise<number> {
  const [row] = await getDb()
    .select({ total: sql<number>`count(*)::int` })
    .from(properties)
    .innerJoin(addresses, eq(properties.addressId, addresses.id))
    .where(and(baseFilter, scope));
  return row?.total ?? 0;
}

/**
 * The nearest comparable listings, closest first.
 *
 * The Mongo version could not order by distance — `$near` gave it a
 * distance-ordered ADDRESS list, it over-fetched listings by an arbitrary
 * factor, and then re-sorted them in JS against a `Map` of that address order,
 * which is what `COMPARABLES_OVERFETCH_FACTOR` and `extractAddressId` existed
 * for. `ORDER BY <geo distance>` does it in the statement, so the over-fetch is
 * gone and the limit is the real limit.
 */
export async function fetchComparables(
  baseFilter: SQL,
  scope: SQL | null,
  origin: DistanceOrigin,
): Promise<Record<string, unknown>[]> {
  if (!scope) return [];
  const hydrated = await findProperties({
    where: allOf([baseFilter, scope]),
    orderBy: [distanceTo(origin.longitude, origin.latitude)],
    limit: COMPARABLES_LIMIT,
    distanceFrom: origin,
  });
  return hydrated.map(serializeProperty);
}

export async function computeMarketVerdictForProperty(
  property: ComparableProperty,
): Promise<MarketVerdictResult | null> {
  const targetResult = buildTargetContext(property);
  if ('reason' in targetResult) {
    if (targetResult.reason === 'no_price') {
      return { hasMarketData: false, sampleSize: 0 };
    }
    return null;
  }

  const target = targetResult.context;
  const baseFilter = buildBaseComparableFilter(target);

  const radiusStats = await aggregatePriceStats(
    baseFilter,
    radiusScope(target, RADIUS_KM),
    target.priceField,
  );
  const radiusCount = radiusStats?.count ?? 0;

  // Widen to the whole city only when the immediate radius has too few
  // comparables to say anything — the same rule, one fewer round trip.
  const stats =
    radiusCount >= MIN_RADIUS_SAMPLE
      ? radiusStats
      : await aggregatePriceStats(baseFilter, cityScope(target), target.priceField);

  const sampleSize = stats?.count ?? 0;
  if (sampleSize === 0) {
    return { hasMarketData: false, sampleSize: 0 };
  }

  const comparison = buildComparison(stats, target.price);
  return {
    hasMarketData: true,
    marketVerdict: comparison.verdict,
    percentDiffFromAvg: comparison.percentDiffFromAvg,
    sampleSize,
  };
}

export type AreaInsightsBasisType = AreaInsightsBasis;
