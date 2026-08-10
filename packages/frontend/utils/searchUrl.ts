/**
 * The URL is the authoritative copy of a committed search; the store is a cache
 * of it.
 *
 * ## Why this file exists
 *
 * The URL used to be a write-once SEED. `/explore` read `?city`, `?query` and
 * `?offering` on mount, pushed them into Zustand, and nothing ever wrote back —
 * every entry point navigated with a bare `router.push('/explore')`. A search
 * therefore could not be shared, bookmarked, reloaded or reached with Back, and
 * the store was the only thing that knew what the user was looking at.
 *
 * This module is the whole of the URL contract: one serialiser, one parser, and
 * they are inverses. Nothing else in the app builds or reads a search URL.
 *
 * ## `loc` is ONE parameter, and that is the point
 *
 * The entire bug class this contract exists for is "half of the previous
 * location survived". A single atomic token makes a half-update unrepresentable
 * in the URL exactly as the store's atomic `commitLocation` does in memory —
 * there is no `?city=` to leave behind when `?bbox=` is written, because there
 * is no `?city=` and no `?bbox=`.
 *
 * ## An unparseable `loc` is a FAILURE, never an absence
 *
 * {@link parseSearchParams} returns a discriminated result. A caller cannot
 * accidentally treat "this token is broken" as "no location was requested",
 * because the two are different variants and neither is `null`. That
 * distinction is the whole of ADR 0002 decision 5 at the URL layer: a location
 * that was requested and lost must never widen into a global feed.
 */
import {
  OfferingType,
  ExchangeMode,
  PropertyType,
  parseLocationToken,
  serializeLocationToken,
  type LocationRef,
  type LocationTokenFailure,
} from '@homiio/shared-types';

import {
  DEFAULT_SEARCH_QUERY,
  type SearchFilterPatch,
} from '@/store/searchQueryStore';
import type {
  SearchQuery,
  SearchSortBy,
  SearchSortOrder,
} from '@/components/search/types';

/** Route params as expo-router hands them over, on web AND native. */
export type RouteParams = Record<string, string | string[] | undefined>;

/** Read a single optional string param (expo-router unions string | string[]). */
export function readParam(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

const OFFERING_VALUES = new Set<string>(Object.values(OfferingType));
const PROPERTY_TYPE_VALUES = new Set<string>(Object.values(PropertyType));
const EXCHANGE_MODE_VALUES = new Set<string>(Object.values(ExchangeMode));
const SORT_BY_VALUES = new Set<string>(['relevance', 'price', 'createdAt', 'fairness']);

/**
 * How a URL's location was supplied.
 *
 * `legacy` is the one that has to be visible to the caller: a `?city=` needs a
 * gateway lookup that may find several candidates, and a request that resolves
 * ambiguously must open the disambiguation list rather than auto-picking. A
 * parser that folded it into `ref` would have thrown away the fact that nothing
 * has been resolved yet.
 */
export type ParsedLocation =
  /** No location was requested. A legitimate query — answer normally. */
  | { readonly kind: 'none' }
  /** A `loc` token that parsed. Still needs resolving against the gateway. */
  | { readonly kind: 'ref'; readonly ref: LocationRef; readonly token: string }
  /** A legacy `?city=` awaiting resolution. Never auto-picked (ADR §5.3). */
  | { readonly kind: 'legacy_city'; readonly value: string }
  /** A `loc` that could not be read. NOT an absence — the screen shows an error. */
  | { readonly kind: 'invalid'; readonly token: string; readonly reason: LocationTokenFailure };

export interface ParsedSearchUrl {
  readonly location: ParsedLocation;
  /** The non-geographic half of the query, ready to seed the store. */
  readonly query: SearchQuery;
  /**
   * True when the URL carried legacy params that have been normalised, so the
   * screen knows to rewrite the address bar with `replace` (not `push` — a
   * normalisation is not a navigation the user made).
   */
  readonly needsNormalising: boolean;
}

function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Split a comma list into trimmed, non-empty entries. */
function splitCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** Split a comma list and keep only the values in a known enum. */
function parseList<T extends string>(value: string | undefined, allowed: Set<string>): T[] {
  return splitCsv(value).filter((entry): entry is T => allowed.has(entry));
}

/**
 * Read a search URL.
 *
 * Legacy `?city=` and `?query=` are accepted for one release and normalised on
 * arrival (§5.3). Note what `?query=` becomes: **`q` verbatim, and it is NOT
 * geocoded**. It used to be, which is how typing a word turned silently into a
 * place search — the same conflation of the two dimensions that `q = label` was
 * on the way out.
 */
export function parseSearchParams(params: RouteParams): ParsedSearchUrl {
  const loc = readParam(params.loc);
  const legacyCity = readParam(params.city);
  const legacyQuery = readParam(params.query);
  const q = readParam(params.q) ?? legacyQuery;

  let location: ParsedLocation;
  if (loc !== undefined) {
    const parsed = parseLocationToken(loc);
    location = parsed.ok
      ? { kind: 'ref', ref: parsed.value, token: loc }
      : { kind: 'invalid', token: loc, reason: parsed.reason };
  } else if (legacyCity !== undefined) {
    location = { kind: 'legacy_city', value: legacyCity };
  } else {
    location = { kind: 'none' };
  }

  const offeringRaw = readParam(params.offering);
  const offering =
    offeringRaw !== undefined && OFFERING_VALUES.has(offeringRaw)
      ? (offeringRaw as OfferingType)
      : DEFAULT_SEARCH_QUERY.offering;

  const sortByRaw = readParam(params.sortBy);
  const sortOrderRaw = readParam(params.sortOrder);
  const checkIn = readParam(params.checkIn);
  const checkOut = readParam(params.checkOut);
  const exchangeModeRaw = readParam(params.exchangeMode);

  const query: SearchQuery = {
    ...DEFAULT_SEARCH_QUERY,
    offering,
    // The URL never carries a resolved selection — only a token to resolve. The
    // screen commits the location once the gateway answers, which is what stops
    // a half-resolved place ever reaching the store.
    location: null,
    queryText: q ?? null,
    propertyTypes: parseList<PropertyType>(readParam(params.propertyType), PROPERTY_TYPE_VALUES),
    priceMin: parseNumber(readParam(params.priceMin)),
    priceMax: parseNumber(readParam(params.priceMax)),
    bedrooms: parseNumber(readParam(params.bedrooms)),
    bathrooms: parseNumber(readParam(params.bathrooms)),
    // Amenity slugs are open-ended (the catalogue grows), so there is no
    // allowlist to check them against — an unknown slug simply matches nothing
    // server-side, which is the correct outcome for a link written against a
    // newer or older build than the one opening it.
    amenities: splitCsv(readParam(params.amenities)),
    dates: checkIn && checkOut ? { start: checkIn, end: checkOut } : undefined,
    guests: parseNumber(readParam(params.guests)),
    sortBy:
      sortByRaw !== undefined && SORT_BY_VALUES.has(sortByRaw)
        ? (sortByRaw as SearchSortBy)
        : DEFAULT_SEARCH_QUERY.sortBy,
    sortOrder: sortOrderRaw === 'asc' ? 'asc' : ('desc' as SearchSortOrder),
    fairPrice: readParam(params.fairPrice) === 'true' ? true : undefined,
    instantBook: readParam(params.instantBook) === 'true' ? true : undefined,
    petFriendly: readParam(params.petFriendly) === 'true' ? true : undefined,
    exchangeMode:
      exchangeModeRaw !== undefined && EXCHANGE_MODE_VALUES.has(exchangeModeRaw)
        ? (exchangeModeRaw as ExchangeMode)
        : undefined,
  };

  return {
    location,
    query,
    needsNormalising: legacyCity !== undefined || legacyQuery !== undefined,
  };
}

/**
 * The result of serialising a query to URL params.
 *
 * `droppedLocation` is a RETURN VALUE rather than a silent omission because the
 * caller is the only one that can decide what to do about it, and the previous
 * shape gave it no way to find out: a `Record<string, string>` missing its
 * `loc` is indistinguishable from a query that never had a location.
 */
export interface SerializedSearchUrl {
  readonly params: Record<string, string>;
  /**
   * Why the committed location could not be written to the URL, or `null`.
   *
   * A caller that navigates anyway commits a query the URL cannot reproduce —
   * so reloading, sharing or pressing Back yields a DIFFERENT search presented
   * as the user's own.
   */
  readonly droppedLocation: LocationTokenFailure | null;
}

/**
 * Build the params for a committed query.
 *
 * Insertion order is fixed (`loc`, `q`, `offering`, then filters alphabetically)
 * so one query has ONE URL. Two spellings of the same search would split the
 * React Query cache and break the round trip the contract requires.
 *
 * A selection the grammar cannot express — today only `polygon`, whose wire
 * format §2.1 reserves deliberately — omits `loc` rather than degrading to its
 * bounding box. Silently substituting a rectangle for a drawn area is the same
 * "half the location survived" bug in a new place.
 */
export function buildSearchParamsForUrl(query: SearchQuery): SerializedSearchUrl {
  const params: Record<string, string> = {};
  let droppedLocation: LocationTokenFailure | null = null;

  if (query.location) {
    const token = serializeLocationToken(query.location);
    if (token.ok) {
      params.loc = token.value;
    } else {
      // NOT silently omitted. `parseSearchParams` reads an absent `loc` as
      // `{ kind: 'none' }` — "no location was requested, answer normally" — so
      // dropping it here turns a committed location into a GLOBAL SEARCH the
      // moment the URL is written, which is the §4.3 failure this module's own
      // header says it exists to prevent. Two shapes reach it: `polygon`, whose
      // wire format §2.1 reserves, and `unencodable_id`, which is not
      // hypothetical — any provider ref containing `+` produces it.
      droppedLocation = token.reason;
    }
  }
  if (query.queryText) params.q = query.queryText;
  if (query.offering !== DEFAULT_SEARCH_QUERY.offering) params.offering = query.offering;

  if (query.propertyTypes.length > 0) params.propertyType = query.propertyTypes.join(',');
  if (query.amenities.length > 0) params.amenities = query.amenities.join(',');
  if (typeof query.priceMin === 'number') params.priceMin = String(query.priceMin);
  if (typeof query.priceMax === 'number') params.priceMax = String(query.priceMax);
  if (typeof query.bedrooms === 'number') params.bedrooms = String(query.bedrooms);
  if (typeof query.bathrooms === 'number') params.bathrooms = String(query.bathrooms);
  if (typeof query.guests === 'number') params.guests = String(query.guests);
  if (query.dates) {
    params.checkIn = query.dates.start;
    params.checkOut = query.dates.end;
  }
  if (query.fairPrice === true) params.fairPrice = 'true';
  if (query.instantBook === true) params.instantBook = 'true';
  if (query.petFriendly === true) params.petFriendly = 'true';
  if (query.exchangeMode) params.exchangeMode = query.exchangeMode;
  if (query.sortBy !== DEFAULT_SEARCH_QUERY.sortBy) params.sortBy = query.sortBy;
  if (query.sortOrder !== DEFAULT_SEARCH_QUERY.sortOrder) params.sortOrder = query.sortOrder;

  return { params, droppedLocation };
}

/**
 * The `/explore` href for a committed query — the one way to navigate to a
 * search.
 *
 * A query whose location cannot be serialised yields `null` rather than a link
 * that silently drops it. Callers render nothing, or a disabled control, rather
 * than a share link that opens somebody else's search.
 */
export function exploreHref(query: SearchQuery): string | null {
  const { params, droppedLocation } = buildSearchParamsForUrl(query);
  if (droppedLocation) return null;
  const search = new URLSearchParams(params).toString();
  return search ? `/explore?${search}` : '/explore';
}

/**
 * Whether a change is a NAVIGATION or a refinement.
 *
 * A location change is something the user should be able to undo with Back, so
 * it is a `push`. A filter or sort tweak is not a place they navigated to, so it
 * is a `replace` — otherwise a session of adjusting a price slider buries the
 * previous search under twenty history entries and Back stops meaning anything.
 */
export function isNavigationChange(previous: SearchQuery, next: SearchQuery): boolean {
  const before = previous.location ? serializeLocationToken(previous.location) : null;
  const after = next.location ? serializeLocationToken(next.location) : null;
  const beforeToken = before?.ok ? before.value : null;
  const afterToken = after?.ok ? after.value : null;
  return beforeToken !== afterToken;
}

/** Narrow a patch to the filter dimensions the store's `patchFilters` accepts. */
export type { SearchFilterPatch };
