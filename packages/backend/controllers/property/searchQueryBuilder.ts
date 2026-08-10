/**
 * Property search query builder
 *
 * Pure, typed helpers that translate validated HTTP query parameters into the
 * SQL predicates and ordering the public property search endpoint runs.
 *
 * ## What changed with the Postgres port, and why it is a rewrite
 *
 * This module used to emit Mongoose filter objects, and half of it existed to
 * work around a store that could not join. A property has no coordinates of its
 * own — geo lives on the referenced address — so every geo-scoped read resolved
 * matching Address ids FIRST and then constrained properties by
 * `addressId: { $in: [...] }`, with `boundingBoxToAddressQuery` and
 * `centerRadiusToAddressQuery` building the first half of that pair. Both are
 * gone: `db/properties/propertyGeo.ts` applies the spatial predicate to
 * `addresses.geo` in the same statement as the property read, so there is no
 * intermediate id set to build, cap or ship.
 *
 * Three other exports went with them, each because its reason for existing did:
 *
 *  - **`EARTH_RADIUS_METERS`** converted a radius to radians for
 *    `$centerSphere`. `ST_DWithin` on `geography` takes METRES.
 *  - **`escapeRegExp`** escaped a term for a Mongo `$regex`. The Postgres form
 *    is `ILIKE`, whose metacharacter set is completely different —
 *    `db/likePattern.ts` carries that escape and the table of how the two
 *    disagree.
 *  - **The Mongo field-path constants** (`'longTermRent.monthlyAmount'` and
 *    friends) are now real columns, so {@link priceColumnForOffering} returns
 *    something the compiler checks instead of a string nothing did.
 *
 * The parsing half — pagination, sort fields, bounding-box and centre+radius
 * VALIDATION — is unchanged and still pure, which is what keeps it unit
 * testable without a database.
 */

import { asc, desc, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { PropertyType, PropertyStatus, OfferingType, ExchangeMode } from '@homiio/shared-types';

import { properties } from '../../db/schema';
import {
  booleanIs,
  exchangeModeIn,
  hasAllAmenities,
  hasOffering,
  hasPhotos,
  idNotIn,
  inRange,
  isAvailable,
  notDeleted,
  notModerationRestricted,
  statusIs,
  textRank,
  typeIn,
} from '../../db/properties/propertyFilters';
import { nullsLast } from '../../db/properties/propertyReads';

// ---- Per-offering price columns ----

/**
 * Resolve the price column that `priceMin`/`priceMax` apply to for a given
 * offering. `EXCHANGE` (and an absent offering) has no monetary price range, so
 * it returns null. Exported so the search endpoint and the home/list feed
 * resolve the SAME column and can't drift.
 */
export function priceColumnForOffering(offering: OfferingType | undefined): AnyPgColumn | null {
  switch (offering) {
    case OfferingType.LONG_TERM_RENT:
      return properties.longTermRentMonthlyAmount;
    case OfferingType.SHORT_TERM_RENT:
      return properties.shortTermRentNightlyRate;
    case OfferingType.SALE:
      return properties.salePrice;
    default:
      return null;
  }
}

/**
 * The default price column used when no explicit offering is requested. The
 * platform defaults to the long-term feed, so a bare `priceMin/priceMax`
 * filters monthly rent (preserving the historical `minRent/maxRent` behaviour).
 */
export const DEFAULT_PRICE_COLUMN: AnyPgColumn = properties.longTermRentMonthlyAmount;

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
/** Default radius (metres) when a center is given without an explicit radius. */
export const DEFAULT_RADIUS_METERS = 25_000;
/** Hard cap on radius (metres) to keep spatial scans bounded. */
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

export const SORT_ASC = 'asc';
export const SORT_DESC = 'desc';
export type SortDirection = typeof SORT_ASC | typeof SORT_DESC;

/** Offerings a caller may filter by. */
const OFFERING_VALUES: ReadonlySet<string> = new Set(Object.values(OfferingType));

/** All valid exchange modes (used to validate the `exchangeMode` filter). */
const EXCHANGE_MODE_VALUES: ReadonlySet<string> = new Set(Object.values(ExchangeMode));

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

/**
 * A geographic parameter the server refuses to guess about.
 *
 * Carries a machine-readable {@link code} because ADR 0002 requires the client
 * to tell "we did not understand where" from "there is nothing there" — two
 * answers that look identical when both arrive as an empty list.
 */
export class GeoParamError extends Error {
  constructor(
    message: string,
    readonly code: 'INVALID_LOCATION' = 'INVALID_LOCATION',
  ) {
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
function statusConditions(statusRaw: string | undefined): SQL[] {
  const publishedAndAvailable = [statusIs(PropertyStatus.PUBLISHED), isAvailable(true)];
  if (statusRaw === undefined) {
    // Default browsing view: only published & available, never drafts.
    return publishedAndAvailable;
  }

  const status = statusRaw.toLowerCase();
  if (status === 'available') return publishedAndAvailable;
  if (PROPERTY_STATUS_VALUES.has(status)) return [statusIs(status)];
  // Unknown status value: fall back to the safe default rather than leaking drafts.
  return publishedAndAvailable;
}

export interface ParsedSearchParams {
  page: number;
  limit: number;
  /** Free-text query (matches description via the tsvector, plus street/place). */
  text?: string;
  /** Explicit city filter (case-insensitive). */
  city?: string;
  state?: string;
  boundingBox?: BoundingBox;
  centerRadius?: CenterRadius;
  sortField: SortField;
  sortDirection: SortDirection;
  // Per-offering filters (mirror the conditions for downstream visibility).
  /** Offering the query was scoped to, when valid. */
  offering?: OfferingType;
  /** Minimum sale price applied to `sale_price`, when present. */
  minSalePrice?: number;
  /** Maximum sale price applied to `sale_price`, when present. */
  maxSalePrice?: number;
  /** Exchange mode the query was scoped to, when valid. */
  exchangeMode?: ExchangeMode;
  /** When true, only listings with `price_ethics_is_fair_price`. */
  fairPrice?: boolean;
}

/**
 * Build the non-geo predicates and parse pagination, sorting and geo intent from
 * the request query.
 *
 * The GEO and place constraints are deliberately left to the controller: both
 * need an async lookup (a place name resolved to a canonical id) and this
 * function stays pure so it can be unit tested with no database at all.
 */
export function buildSearchPlan(
  query: Record<string, RawQueryValue>
): { conditions: SQL[]; params: ParsedSearchParams } {
  const conditions: SQL[] = [];

  // Public search: never surface soft-deleted (archived) listings, nor ones a
  // community jury has restricted — regardless of any explicit `status` value
  // the caller passes.
  conditions.push(notDeleted(), notModerationRestricted());

  // --- Status / availability (also excludes drafts) ---
  conditions.push(...statusConditions(asString(query.status)));

  // --- Property type (one or many) ---
  const typeCondition = typeIn(parseList(query.propertyType ?? query.type).filter((t) => PROPERTY_TYPE_VALUES.has(t)));
  if (typeCondition) conditions.push(typeCondition);

  // --- Offering (long_term_rent / short_term_rent / sale / exchange). Parsed
  //     early because the price-range column below is resolved from it. ---
  const offeringRaw = asString(query.offering)?.toLowerCase();
  const offering = offeringRaw && OFFERING_VALUES.has(offeringRaw)
    ? (offeringRaw as OfferingType)
    : undefined;
  if (offering !== undefined) {
    conditions.push(hasOffering(offering));
  }

  // --- Price range (accept Airbnb-style priceMin/priceMax and legacy minRent/maxRent) ---
  // The range applies to the price column of the REQUESTED offering, so a
  // monthly price is never compared against a nightly one. When no offering is
  // requested it defaults to the long-term column. SALE uses its dedicated
  // minSalePrice/maxSalePrice params below, so a bare price range is not
  // applied to a sale query here.
  const priceMin = parseFloatParam(query.priceMin) ?? parseFloatParam(query.minRent);
  const priceMax = parseFloatParam(query.priceMax) ?? parseFloatParam(query.maxRent);
  if (offering !== OfferingType.SALE) {
    const priceRange = inRange(priceColumnForOffering(offering) ?? DEFAULT_PRICE_COLUMN, priceMin, priceMax);
    if (priceRange) conditions.push(priceRange);
  }

  // --- Bedrooms (minimum) / bathrooms (minimum) ---
  const bedrooms = parseIntParam(query.bedrooms) ?? parseIntParam(query.minBedrooms);
  if (bedrooms !== undefined && bedrooms > 0) {
    const condition = inRange(properties.bedrooms, bedrooms, undefined);
    if (condition) conditions.push(condition);
  }
  const bathrooms = parseIntParam(query.bathrooms) ?? parseIntParam(query.minBathrooms);
  if (bathrooms !== undefined && bathrooms > 0) {
    const condition = inRange(properties.bathrooms, bathrooms, undefined);
    if (condition) conditions.push(condition);
  }

  // --- Amenities (must include all requested) ---
  const amenities = hasAllAmenities(parseList(query.amenities).map((a) => a.toLowerCase()));
  if (amenities) conditions.push(amenities);

  // --- Boolean feature flags ---
  const verified = parseBoolParam(query.verified);
  if (verified !== undefined) conditions.push(booleanIs(properties.isVerified, verified));
  const eco = parseBoolParam(query.eco);
  if (eco !== undefined) conditions.push(booleanIs(properties.isEcoFriendly, eco));
  const instantBook = parseBoolParam(query.instantBook);
  if (instantBook !== undefined) conditions.push(booleanIs(properties.shortTermRentInstantBook, instantBook));
  const petFriendly = parseBoolParam(query.petFriendly);
  if (petFriendly !== undefined) conditions.push(booleanIs(properties.petFriendly, petFriendly));
  if (parseBoolParam(query.hasPhotos) === true) conditions.push(hasPhotos());
  const fairPrice = parseBoolParam(query.fairPrice);
  if (fairPrice === true) conditions.push(booleanIs(properties.priceEthicsIsFairPrice, true));

  // --- Minimum guests (short-term) ---
  const minGuests = parseIntParam(query.minGuests ?? query.guests);
  if (minGuests !== undefined && minGuests > 0) {
    const condition = inRange(properties.maxGuests, minGuests, undefined);
    if (condition) conditions.push(condition);
  }

  // --- Sale price range (ONLY applied for an explicit SALE query) ---
  // Gated on `offering === SALE` so the dedicated sale range never stacks onto
  // a non-sale query. The values are still echoed in `params` regardless.
  const minSalePrice = parseFloatParam(query.minSalePrice);
  const maxSalePrice = parseFloatParam(query.maxSalePrice);
  if (offering === OfferingType.SALE) {
    const saleRange = inRange(properties.salePrice, minSalePrice, maxSalePrice);
    if (saleRange) conditions.push(saleRange);
  }

  // --- Exchange mode (ONLY applied for an explicit EXCHANGE query) ---
  // The offering condition already constrains the query to exchange listings;
  // the mode filter is gated on `offering === EXCHANGE`. A `both` listing
  // matches a swap or a host request.
  const exchangeMode = asString(query.exchangeMode)?.toLowerCase();
  if (exchangeMode && EXCHANGE_MODE_VALUES.has(exchangeMode) && offering === OfferingType.EXCHANGE) {
    const condition = exchangeMode === ExchangeMode.BOTH
      ? exchangeModeIn([ExchangeMode.BOTH])
      : exchangeModeIn([exchangeMode, ExchangeMode.BOTH]);
    if (condition) conditions.push(condition);
  }

  // --- Exclude ids ---
  // No id-SHAPE filter: see `db/properties/propertyFilters.idNotIn`.
  const excludeIds = idNotIn(parseList(query.excludeIds));
  if (excludeIds) conditions.push(excludeIds);

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

  // A request may name AT MOST ONE authoritative geographic scope. Sending
  // both a box and a centre+radius used to be resolved by the controller
  // silently preferring the box, which is the "choose one quietly" behaviour
  // ADR 0002 forbids: the caller asked two different questions and got an
  // answer to one of them with nothing saying which. It is a client bug every
  // time, and the loud failure is the one that gets it fixed.
  const boundingBox = parseBoundingBox(query);
  const centerRadius = parseCenterRadius(query);
  if (boundingBox && centerRadius) {
    throw new GeoParamError(
      'A search may carry a bounding box or a centre and radius, not both. ' +
        'Send swLat/swLng/neLat/neLng, or lat/lng/radius.',
    );
  }

  return {
    conditions,
    params: {
      page,
      limit,
      text: asString(query.q) ?? asString(query.query) ?? asString(query.search),
      city: asString(query.city),
      state: asString(query.state),
      boundingBox,
      centerRadius,
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
 * Build the ORDER BY. `relevance` only carries a text rank when a text search is
 * active; otherwise it falls back to recency.
 *
 * The `price` sort resolves to the requested offering's price column so the feed
 * never sorts a monthly price against a nightly one. `salePrice` always sorts on
 * `sale_price`.
 *
 * `has_images DESC` is NOT prepended here — `propertyOrderBy` in
 * `db/properties/propertyReads` does it for every feed, so a caller cannot
 * forget it. In the Mongo original that prepending was duplicated at four call
 * sites.
 */
export function buildSort(params: ParsedSearchParams, textTerm?: string): SQL[] {
  const direction = params.sortDirection === SORT_ASC ? SORT_ASC : SORT_DESC;

  if (params.sortField === SORT_PRICE) {
    return [nullsLast(priceColumnForOffering(params.offering) ?? DEFAULT_PRICE_COLUMN, direction)];
  }
  if (params.sortField === SORT_SALE_PRICE) {
    return [nullsLast(properties.salePrice, direction)];
  }
  if (params.sortField === SORT_RELEVANCE && textTerm) {
    return [desc(textRank(textTerm)), desc(properties.createdAt)];
  }
  if (params.sortField === SORT_FAIRNESS) {
    return [nullsLast(properties.priceEthicsFairnessScore, direction), desc(properties.createdAt)];
  }
  return [direction === SORT_ASC ? asc(properties.createdAt) : desc(properties.createdAt)];
}
