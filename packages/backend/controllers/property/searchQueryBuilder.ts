/**
 * Property search query builder
 *
 * Pure, typed helpers that translate validated HTTP query parameters into
 * Mongoose filter/sort objects for the public property search endpoint.
 *
 * Geo model note: a Property does NOT store coordinates directly. Geo data
 * lives on the referenced Address document (a GeoJSON `Point` with a
 * `2dsphere` index). Geo filtering therefore resolves matching Address ids
 * first, then constrains properties by `addressId: { $in: [...] }`. Bounding
 * boxes use a GeoJSON Polygon (`$geoWithin`/`$geometry`) so the `2dsphere`
 * index is used; center+radius uses `$centerSphere`.
 */

import { Types, type FilterQuery, type SortOrder } from 'mongoose';
import { PropertyType, PropertyStatus, OfferingType, ExchangeMode } from '@homiio/shared-types';

// ---- Per-offering price fields ----
/** Mongo field path holding the price for each offering. */
export const PRICE_FIELD_LONG_TERM = 'longTermRent.monthlyAmount';
export const PRICE_FIELD_SHORT_TERM = 'shortTermRent.nightlyRate';
export const PRICE_FIELD_SALE = 'sale.price';
/** Mongo field path for the short-term instant-book flag. */
export const FIELD_SHORT_TERM_INSTANT_BOOK = 'shortTermRent.instantBook';

/**
 * Resolve the Mongo price-field path that `priceMin`/`priceMax` apply to for a
 * given offering. `EXCHANGE` (and an absent offering) has no monetary price
 * range, so it returns null. Exported so the search endpoint and the home/list
 * feed resolve the SAME field and can't drift.
 */
export function priceFieldForOffering(offering: OfferingType | undefined): string | null {
  switch (offering) {
    case OfferingType.LONG_TERM_RENT:
      return PRICE_FIELD_LONG_TERM;
    case OfferingType.SHORT_TERM_RENT:
      return PRICE_FIELD_SHORT_TERM;
    case OfferingType.SALE:
      return PRICE_FIELD_SALE;
    default:
      return null;
  }
}

/**
 * The default price-field used when no explicit offering is requested. The
 * platform defaults to the long-term feed, so a bare `priceMin/priceMax`
 * filters monthly rent (preserving the historical `minRent/maxRent` behaviour).
 */
export const DEFAULT_PRICE_FIELD = PRICE_FIELD_LONG_TERM;

// ---- Pagination / limit constants ----
export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;

// ---- Geo constants ----
/** Latitude bounds for a valid WGS84 coordinate. */
export const MIN_LATITUDE = -90;
export const MAX_LATITUDE = 90;
/** Longitude bounds for a valid WGS84 coordinate. */
export const MIN_LONGITUDE = -180;
export const MAX_LONGITUDE = 180;
/** Mean Earth radius in metres, used to convert a radius to radians for $centerSphere. */
export const EARTH_RADIUS_METERS = 6_371_000;
/** Default radius (metres) when a center is given without an explicit radius. */
export const DEFAULT_RADIUS_METERS = 25_000;
/** Hard cap on radius (metres) to keep $centerSphere scans bounded. */
export const MAX_RADIUS_METERS = 200_000;

// ---- Sort constants ----
export const SORT_PRICE = 'price';
export const SORT_SALE_PRICE = 'salePrice';
export const SORT_CREATED_AT = 'createdAt';
export const SORT_RELEVANCE = 'relevance';
export const SORT_FAIRNESS = 'fairness';
export type SortField =
  | typeof SORT_PRICE
  | typeof SORT_SALE_PRICE
  | typeof SORT_CREATED_AT
  | typeof SORT_RELEVANCE
  | typeof SORT_FAIRNESS;
const SORT_FIELDS: ReadonlySet<string> = new Set([
  SORT_PRICE,
  SORT_SALE_PRICE,
  SORT_CREATED_AT,
  SORT_RELEVANCE,
  SORT_FAIRNESS,
]);
/** Mongo path for the persisted price-ethics fairness score. */
export const FIELD_PRICE_ETHICS_FAIRNESS_SCORE = 'priceEthics.fairnessScore';
/** Mongo path for the fair-price badge/filter flag. */
export const FIELD_PRICE_ETHICS_IS_FAIR_PRICE = 'priceEthics.isFairPrice';

export const SORT_ASC = 'asc';
export const SORT_DESC = 'desc';
export type SortDirection = typeof SORT_ASC | typeof SORT_DESC;

/** Offerings a caller may filter by. */
const OFFERING_VALUES: ReadonlySet<string> = new Set(Object.values(OfferingType));

/** All valid exchange modes (used to validate the `exchangeMode` filter). */
const EXCHANGE_MODE_VALUES: ReadonlySet<string> = new Set(Object.values(ExchangeMode));

/** Property document fields, keyed for type-safe filter construction. */
interface PropertyDoc {
  _id: Types.ObjectId;
  addressId: Types.ObjectId;
  oxyUserId: string;
  type: string;
  status: string;
  deletedAt: Date | null;
  bedrooms: number;
  bathrooms: number;
  amenities: string[];
  isVerified: boolean;
  isEcoFriendly: boolean;
  maxGuests: number;
  createdAt: Date;
  availability: { isAvailable: boolean };
  // Per-offering (long_term_rent / short_term_rent / sale / exchange)
  offerings: OfferingType[];
  longTermRent: { monthlyAmount: number };
  shortTermRent: { nightlyRate: number; instantBook: boolean };
  sale: { price: number };
  exchange: { mode: ExchangeMode };
}

export type PropertyFilter = FilterQuery<PropertyDoc>;

/** Express query values can be string | string[] | ParsedQs | undefined. */
type RawQueryValue = string | string[] | undefined | null | Record<string, unknown>;

/**
 * Coerce a raw query value to a single trimmed string.
 * Arrays collapse to their first element; non-strings yield undefined.
 */
function asString(value: RawQueryValue): string | undefined {
  if (Array.isArray(value)) return asString(value[0]);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
}

/** Parse a finite float from a raw query value, or undefined when absent/invalid. */
export function parseFloatParam(value: RawQueryValue): number | undefined {
  const str = asString(value);
  if (str === undefined) return undefined;
  const parsed = Number.parseFloat(str);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Parse a finite integer from a raw query value, or undefined when absent/invalid. */
export function parseIntParam(value: RawQueryValue): number | undefined {
  const str = asString(value);
  if (str === undefined) return undefined;
  const parsed = Number.parseInt(str, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Parse a boolean from a raw query value; only the literal `'true'`/`'false'` count. */
function parseBoolParam(value: RawQueryValue): boolean | undefined {
  const str = asString(value)?.toLowerCase();
  if (str === 'true') return true;
  if (str === 'false') return false;
  return undefined;
}

/** Clamp the requested page to a sane lower bound. */
export function resolvePage(value: RawQueryValue): number {
  const parsed = parseIntParam(value);
  if (parsed === undefined || parsed < 1) return DEFAULT_PAGE;
  return parsed;
}

/** Clamp the requested limit between 1 and {@link MAX_LIMIT}. */
export function resolveLimit(value: RawQueryValue): number {
  const parsed = parseIntParam(value);
  if (parsed === undefined || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

/** Escape a user string for safe use inside a RegExp. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isLatitude(value: number): boolean {
  return value >= MIN_LATITUDE && value <= MAX_LATITUDE;
}

function isLongitude(value: number): boolean {
  return value >= MIN_LONGITUDE && value <= MAX_LONGITUDE;
}

// ---- Geo parsing ----

export interface BoundingBox {
  swLat: number;
  swLng: number;
  neLat: number;
  neLng: number;
}

export interface CenterRadius {
  lat: number;
  lng: number;
  /** Radius in metres, already clamped to {@link MAX_RADIUS_METERS}. */
  radiusMeters: number;
}

export class GeoParamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeoParamError';
  }
}

/**
 * Parse a bounding box from explicit corner params or a legacy
 * comma-separated `bounds=swLng,swLat,neLng,neLat` string.
 * Returns undefined when no box params are present; throws on malformed input.
 */
export function parseBoundingBox(query: Record<string, RawQueryValue>): BoundingBox | undefined {
  let swLat = parseFloatParam(query.swLat);
  let swLng = parseFloatParam(query.swLng);
  let neLat = parseFloatParam(query.neLat);
  let neLng = parseFloatParam(query.neLng);

  // Legacy single-string form used by the existing map view:
  // `bounds=west,south,east,north` => [swLng, swLat, neLng, neLat].
  const boundsStr = asString(query.bounds);
  if (boundsStr && [swLat, swLng, neLat, neLng].some((v) => v === undefined)) {
    const parts = boundsStr.split(',').map((p) => Number.parseFloat(p.trim()));
    if (parts.length === 4 && parts.every((p) => Number.isFinite(p))) {
      const [west, south, east, north] = parts;
      swLng = west;
      swLat = south;
      neLng = east;
      neLat = north;
    } else {
      throw new GeoParamError('bounds must be "west,south,east,north" with four numeric values');
    }
  }

  const provided = [swLat, swLng, neLat, neLng].filter((v) => v !== undefined).length;
  if (provided === 0) return undefined;
  if (provided !== 4 || swLat === undefined || swLng === undefined || neLat === undefined || neLng === undefined) {
    throw new GeoParamError('A bounding box requires swLat, swLng, neLat and neLng');
  }

  if (!isLatitude(swLat) || !isLatitude(neLat) || !isLongitude(swLng) || !isLongitude(neLng)) {
    throw new GeoParamError('Bounding box coordinates are out of range');
  }
  if (swLat > neLat) {
    throw new GeoParamError('swLat must be less than or equal to neLat');
  }

  return { swLat, swLng, neLat, neLng };
}

/**
 * Parse a center + radius geo constraint. Returns undefined when no center is
 * present; throws on malformed input. Radius defaults/clamps to safe bounds.
 */
export function parseCenterRadius(query: Record<string, RawQueryValue>): CenterRadius | undefined {
  const lat = parseFloatParam(query.lat);
  const lng = parseFloatParam(query.lng);

  if (lat === undefined && lng === undefined) return undefined;
  if (lat === undefined || lng === undefined) {
    throw new GeoParamError('Both lat and lng are required for a radius search');
  }
  if (!isLatitude(lat) || !isLongitude(lng)) {
    throw new GeoParamError('Center coordinates are out of range');
  }

  const rawRadius = parseFloatParam(query.radius);
  let radiusMeters = rawRadius === undefined || rawRadius <= 0 ? DEFAULT_RADIUS_METERS : rawRadius;
  radiusMeters = Math.min(radiusMeters, MAX_RADIUS_METERS);

  return { lat, lng, radiusMeters };
}

// ---- Non-geo filter parsing ----

/** Split a comma-separated or repeated query param into a unique, trimmed list. */
function parseList(value: RawQueryValue): string[] {
  const collect = (raw: string): string[] => raw.split(',').map((p) => p.trim()).filter(Boolean);
  if (Array.isArray(value)) {
    return Array.from(new Set(value.flatMap((v) => (typeof v === 'string' ? collect(v) : []))));
  }
  if (typeof value === 'string') {
    return Array.from(new Set(collect(value)));
  }
  return [];
}

const PROPERTY_TYPE_VALUES: ReadonlySet<string> = new Set(Object.values(PropertyType));
const PROPERTY_STATUS_VALUES: ReadonlySet<string> = new Set(Object.values(PropertyStatus));

/**
 * Map a public `status` query value to a canonical {@link PropertyStatus}.
 * The Airbnb-style `available` alias maps to `published` + isAvailable.
 */
function applyStatusFilter(filter: PropertyFilter, statusRaw: string | undefined): void {
  if (statusRaw === undefined) {
    // Default browsing view: only published & available, never drafts.
    filter.status = PropertyStatus.PUBLISHED;
    filter['availability.isAvailable'] = true;
    return;
  }

  const status = statusRaw.toLowerCase();
  if (status === 'available') {
    filter.status = PropertyStatus.PUBLISHED;
    filter['availability.isAvailable'] = true;
    return;
  }
  if (PROPERTY_STATUS_VALUES.has(status)) {
    filter.status = status;
    return;
  }
  // Unknown status value: fall back to the safe default rather than leaking drafts.
  filter.status = PropertyStatus.PUBLISHED;
  filter['availability.isAvailable'] = true;
}

/**
 * Constrain the filter to listings carrying a given offering. `offerings` is an
 * array, so equality matches membership — clean single-axis filter, no
 * back-compat fallbacks.
 */
function applyOfferingFilter(filter: PropertyFilter, offering: OfferingType): void {
  filter.offerings = offering;
}

export interface ParsedSearchParams {
  page: number;
  limit: number;
  /** Free-text query (matches title/description via index, address via lookup). */
  text?: string;
  /** Explicit city filter (case-insensitive). */
  city?: string;
  state?: string;
  boundingBox?: BoundingBox;
  centerRadius?: CenterRadius;
  sortField: SortField;
  sortDirection: SortDirection;
  // Per-offering filters (mirror the `filter` clauses for downstream visibility).
  /** Offering the query was scoped to, when valid. */
  offering?: OfferingType;
  /** Minimum sale price applied to `sale.price`, when present. */
  minSalePrice?: number;
  /** Maximum sale price applied to `sale.price`, when present. */
  maxSalePrice?: number;
  /** Exchange mode the query was scoped to, when valid. */
  exchangeMode?: ExchangeMode;
  /** When true, only listings with `priceEthics.isFairPrice`. */
  fairPrice?: boolean;
}

/**
 * Build the non-geo portion of the Mongoose filter and parse pagination,
 * sorting and geo intent from the request query. Geo id-resolution is done
 * by the controller (it needs an async Address lookup).
 */
export function buildSearchPlan(
  query: Record<string, RawQueryValue>
): { filter: PropertyFilter; params: ParsedSearchParams } {
  const filter: PropertyFilter = {};

  // Public search: never surface soft-deleted (archived) listings, regardless
  // of any explicit `status` value the caller passes.
  filter.deletedAt = null;

  // --- Status / availability (also excludes drafts) ---
  applyStatusFilter(filter, asString(query.status));

  // --- Property type (one or many) ---
  const typeList = parseList(query.propertyType ?? query.type).filter((t) => PROPERTY_TYPE_VALUES.has(t));
  if (typeList.length === 1) {
    filter.type = typeList[0];
  } else if (typeList.length > 1) {
    filter.type = { $in: typeList };
  }

  // --- Offering (long_term_rent / short_term_rent / sale / exchange). Parsed
  //     early because the price-range field below is resolved from it. ---
  const offeringRaw = asString(query.offering)?.toLowerCase();
  const offering = offeringRaw && OFFERING_VALUES.has(offeringRaw)
    ? (offeringRaw as OfferingType)
    : undefined;
  if (offering !== undefined) {
    applyOfferingFilter(filter, offering);
  }

  // --- Price range (accept Airbnb-style priceMin/priceMax and legacy minRent/maxRent) ---
  // The range applies to the price field of the REQUESTED offering
  // (long_term→monthlyAmount, short_term→nightlyRate, sale→sale.price), so a
  // monthly price is never compared against a nightly one. When no offering is
  // requested it defaults to the long-term field. SALE uses its dedicated
  // minSalePrice/maxSalePrice params below, so a bare price range is not
  // applied to a sale query here.
  const priceMin = parseFloatParam(query.priceMin) ?? parseFloatParam(query.minRent);
  const priceMax = parseFloatParam(query.priceMax) ?? parseFloatParam(query.maxRent);
  if ((priceMin !== undefined || priceMax !== undefined) && offering !== OfferingType.SALE) {
    const priceField = priceFieldForOffering(offering) ?? DEFAULT_PRICE_FIELD;
    const priceRange: { $gte?: number; $lte?: number } = {};
    if (priceMin !== undefined) priceRange.$gte = priceMin;
    if (priceMax !== undefined) priceRange.$lte = priceMax;
    filter[priceField] = priceRange;
  }

  // --- Bedrooms (minimum) / bathrooms (minimum) ---
  const bedrooms = parseIntParam(query.bedrooms) ?? parseIntParam(query.minBedrooms);
  if (bedrooms !== undefined && bedrooms > 0) {
    filter.bedrooms = { $gte: bedrooms };
  }
  const bathrooms = parseIntParam(query.bathrooms) ?? parseIntParam(query.minBathrooms);
  if (bathrooms !== undefined && bathrooms > 0) {
    filter.bathrooms = { $gte: bathrooms };
  }

  // --- Amenities (must include all requested) ---
  const amenities = parseList(query.amenities).map((a) => a.toLowerCase());
  if (amenities.length > 0) {
    filter.amenities = { $all: amenities };
  }

  // --- Boolean feature flags ---
  const verified = parseBoolParam(query.verified);
  if (verified !== undefined) filter.isVerified = verified;
  const eco = parseBoolParam(query.eco);
  if (eco !== undefined) filter.isEcoFriendly = eco;
  const instantBook = parseBoolParam(query.instantBook);
  if (instantBook !== undefined) filter[FIELD_SHORT_TERM_INSTANT_BOOK] = instantBook;
  const hasPhotos = parseBoolParam(query.hasPhotos);
  if (hasPhotos === true) filter['images.url'] = { $exists: true, $nin: [null, ''] };
  const fairPrice = parseBoolParam(query.fairPrice);
  if (fairPrice === true) filter[FIELD_PRICE_ETHICS_IS_FAIR_PRICE] = true;

  // --- Minimum guests (short-term) ---
  const minGuests = parseIntParam(query.minGuests ?? query.guests);
  if (minGuests !== undefined && minGuests > 0) {
    filter.maxGuests = { $gte: minGuests };
  }

  // --- Sale price range (ONLY applied for an explicit SALE query) ---
  // Gated on `offering === SALE` so the dedicated sale range never stacks onto
  // a non-sale query. The values are still echoed in `params` regardless.
  const minSalePrice = parseFloatParam(query.minSalePrice);
  const maxSalePrice = parseFloatParam(query.maxSalePrice);
  if ((minSalePrice !== undefined || maxSalePrice !== undefined) && offering === OfferingType.SALE) {
    const saleFilter: { $gte?: number; $lte?: number } = {};
    if (minSalePrice !== undefined) saleFilter.$gte = minSalePrice;
    if (maxSalePrice !== undefined) saleFilter.$lte = maxSalePrice;
    filter[PRICE_FIELD_SALE] = saleFilter;
  }

  // --- Exchange mode (ONLY applied for an explicit EXCHANGE query) ---
  // `applyOfferingFilter` already constrains the query to exchange listings; the
  // mode filter is gated on `offering === EXCHANGE`. A `both` listing matches a
  // swap or host request.
  const exchangeMode = asString(query.exchangeMode)?.toLowerCase();
  if (exchangeMode && EXCHANGE_MODE_VALUES.has(exchangeMode) && offering === OfferingType.EXCHANGE) {
    if (exchangeMode === ExchangeMode.BOTH) {
      filter['exchange.mode'] = ExchangeMode.BOTH;
    } else {
      filter['exchange.mode'] = { $in: [exchangeMode, ExchangeMode.BOTH] };
    }
  }

  // --- Exclude ids ---
  const excludeIds = parseList(query.excludeIds)
    .filter((id) => Types.ObjectId.isValid(id))
    .map((id) => new Types.ObjectId(id));
  if (excludeIds.length > 0) {
    filter._id = { $nin: excludeIds };
  }

  // --- Pagination ---
  const page = resolvePage(query.page);
  const limit = resolveLimit(query.limit);

  // --- Sorting ---
  const requestedSort = asString(query.sortBy)?.toLowerCase();
  const sortField: SortField = requestedSort && SORT_FIELDS.has(requestedSort)
    ? (requestedSort as SortField)
    : SORT_CREATED_AT;
  const sortDirection: SortDirection = asString(query.sortOrder)?.toLowerCase() === SORT_ASC ? SORT_ASC : SORT_DESC;

  const exchangeModeParam = exchangeMode && EXCHANGE_MODE_VALUES.has(exchangeMode)
    ? (exchangeMode as ExchangeMode)
    : undefined;

  return {
    filter,
    params: {
      page,
      limit,
      text: asString(query.q) ?? asString(query.query) ?? asString(query.search),
      city: asString(query.city),
      state: asString(query.state),
      boundingBox: parseBoundingBox(query),
      centerRadius: parseCenterRadius(query),
      sortField,
      sortDirection,
      offering,
      minSalePrice,
      maxSalePrice,
      exchangeMode: exchangeModeParam,
      fairPrice: fairPrice === true ? true : undefined,
    },
  };
}

/**
 * Build a Mongoose sort spec. `relevance` only carries a text score when a
 * text search is active; otherwise it falls back to recency.
 *
 * The `price` sort resolves to the requested offering's price field
 * (long_term→monthlyAmount, short_term→nightlyRate, sale→sale.price; defaults
 * to long-term when no offering is set) so the feed never sorts a monthly price
 * against a nightly one. `salePrice` always sorts on `sale.price`.
 */
export function buildSort(
  params: ParsedSearchParams,
  hasTextScore: boolean
): Record<string, SortOrder | { $meta: 'textScore' }> {
  const direction: SortOrder = params.sortDirection === SORT_ASC ? 1 : -1;

  if (params.sortField === SORT_PRICE) {
    const priceField = priceFieldForOffering(params.offering) ?? DEFAULT_PRICE_FIELD;
    return { [priceField]: direction };
  }
  if (params.sortField === SORT_SALE_PRICE) {
    return { [PRICE_FIELD_SALE]: direction };
  }
  if (params.sortField === SORT_RELEVANCE && hasTextScore) {
    return { score: { $meta: 'textScore' }, createdAt: -1 };
  }
  if (params.sortField === SORT_FAIRNESS) {
    return { [FIELD_PRICE_ETHICS_FAIRNESS_SCORE]: direction, createdAt: -1 };
  }
  return { createdAt: direction };
}

/**
 * Build the $geoWithin clause for an Address query from a bounding box.
 *
 * Uses a GeoJSON Polygon rectangle (lng/lat order, closed CCW ring) rather
 * than the legacy `$box` operator: `$box` is only served by a flat `2d` index
 * and forces a COLLSCAN against our `2dsphere` index, whereas `$geoWithin` with
 * a `$geometry` polygon is index-backed (IXSCAN) and returns identical results.
 */
export function boundingBoxToAddressQuery(box: BoundingBox): FilterQuery<{ coordinates: unknown }> {
  const ring: [number, number][] = [
    [box.swLng, box.swLat],
    [box.neLng, box.swLat],
    [box.neLng, box.neLat],
    [box.swLng, box.neLat],
    [box.swLng, box.swLat],
  ];
  return {
    coordinates: {
      $geoWithin: { $geometry: { type: 'Polygon', coordinates: [ring] } },
    },
  };
}

/** Build the $geoWithin/$centerSphere clause for an Address query from a center+radius. */
export function centerRadiusToAddressQuery(center: CenterRadius): FilterQuery<{ coordinates: unknown }> {
  return {
    coordinates: {
      $geoWithin: {
        $centerSphere: [[center.lng, center.lat], center.radiusMeters / EARTH_RADIUS_METERS],
      },
    },
  };
}
