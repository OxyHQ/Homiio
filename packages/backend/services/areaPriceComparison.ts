/**
 * Shared area price comparison helpers.
 *
 * Single authority for comparable-market verdict thresholds and aggregation
 * logic used by area-insights and price-ethics scoring.
 */

import { Types, type Model } from 'mongoose';
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
import type { IProperty } from '../models/Property';
import type { IAddress } from '../models/Address';

import * as models from '../models';
const Property: Model<IProperty> = models.Property;
const Address: Model<IAddress> = models.Address;

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

interface AvgRow {
  avg: number;
  count: number;
}

type AddressGeoLean = { _id: Types.ObjectId };
type GeoRefField = Types.ObjectId | { _id: Types.ObjectId; name?: string } | null | undefined;

export interface PopulatedGeoAddress {
  coordinates?: { coordinates?: [number, number] };
  cityId?: GeoRefField;
  neighborhoodId?: GeoRefField;
  cityName?: string;
  regionName?: string;
}

export interface TargetContext {
  id: Types.ObjectId;
  bedrooms: number;
  priceUnit: string;
  currency: string;
  price: number;
  priceField: PriceField;
  squareFootage: number;
  longitude: number;
  latitude: number;
  cityId: Types.ObjectId;
  neighborhoodId: Types.ObjectId | null;
  city: string;
  neighborhood: string | null;
}

export interface MarketVerdictResult {
  hasMarketData: boolean;
  marketVerdict?: AreaPriceVerdict;
  percentDiffFromAvg?: number;
  sampleSize: number;
}

function extractGeoRef(ref: GeoRefField): { id: Types.ObjectId; name?: string } | null {
  if (!ref) return null;
  if (ref instanceof Types.ObjectId) return { id: ref };
  if (typeof ref === 'object' && '_id' in ref && ref._id) {
    return { id: ref._id, name: typeof ref.name === 'string' ? ref.name : undefined };
  }
  return null;
}

export function buildBaseComparableFilter(target: TargetContext): Record<string, unknown> {
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

export async function resolveRadiusAddressIds(
  target: TargetContext,
  radiusKm: number,
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

export async function resolveCityAddressIds(target: TargetContext): Promise<Types.ObjectId[]> {
  const matches = await Address.find({
    cityId: target.cityId,
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

export async function resolveNeighborhoodAddressIds(
  target: TargetContext,
): Promise<Types.ObjectId[]> {
  if (!target.neighborhoodId) return [];
  const matches = await Address.find({ neighborhoodId: target.neighborhoodId })
    .select('_id')
    .lean<AddressGeoLean[]>();
  return matches.map((a) => a._id);
}

export function roundInt(value: number): number {
  return Number.isFinite(value) ? Math.round(value) : 0;
}

export async function aggregatePriceStats(
  baseFilter: Record<string, unknown>,
  addressIds: Types.ObjectId[],
  priceField: PriceField,
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

export async function aggregateAvg(
  baseFilter: Record<string, unknown>,
  addressIds: Types.ObjectId[],
  priceField: PriceField,
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

export function resolvePriceBasis(
  property: IProperty,
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

export function buildTargetContext(
  property: IProperty,
): { context: TargetContext } | { reason: 'no_coordinates' | 'no_price' } {
  const populated = property as unknown as { address?: PopulatedGeoAddress; addressId?: PopulatedGeoAddress };
  const address = populated.address ?? populated.addressId ?? null;
  const coords = address?.coordinates?.coordinates;
  if (!address || !Array.isArray(coords) || coords.length !== 2) return { reason: 'no_coordinates' };
  const [longitude, latitude] = coords;
  if (typeof longitude !== 'number' || typeof latitude !== 'number') return { reason: 'no_coordinates' };

  const cityRef = extractGeoRef(address.cityId);
  if (!cityRef) return { reason: 'no_coordinates' };
  const neighborhoodRef = extractGeoRef(address.neighborhoodId);

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
      cityId: cityRef.id,
      neighborhoodId: neighborhoodRef?.id ?? null,
      city: cityRef.name ?? address.cityName ?? '',
      neighborhood: neighborhoodRef?.name ?? null,
    },
  };
}

export async function buildNeighborhoodContrast(
  target: TargetContext,
  baseFilter: Record<string, unknown>,
  cityScopeAddressIds: Types.ObjectId[] | null,
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

export async function fetchComparables(
  baseFilter: Record<string, unknown>,
  scopeAddressIds: Types.ObjectId[],
): Promise<Record<string, unknown>[]> {
  if (scopeAddressIds.length === 0) return [];
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

export function extractAddressId(doc: Record<string, unknown>): string | null {
  const candidate = doc.address ?? doc.addressId;
  if (!candidate) return null;
  if (typeof candidate === 'object') {
    const nested = candidate as { _id?: unknown; id?: unknown };
    const id = nested._id ?? nested.id;
    return id ? String(id) : null;
  }
  return String(candidate);
}

export async function computeMarketVerdictForProperty(
  property: IProperty,
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

  const radiusAddressIds = await resolveRadiusAddressIds(target, RADIUS_KM);
  const radiusStats = await aggregatePriceStats(baseFilter, radiusAddressIds, target.priceField);
  const radiusCount = radiusStats?.count ?? 0;

  const useRadius = radiusCount >= MIN_RADIUS_SAMPLE;
  let stats: PriceStatsRow | null;
  if (useRadius) {
    stats = radiusStats;
  } else {
    const cityAddressIds = await resolveCityAddressIds(target);
    stats = await aggregatePriceStats(baseFilter, cityAddressIds, target.priceField);
  }

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
