/**
 * usePropertySearch — paginated React Query hook for the Airbnb-2026 search.
 *
 * Wraps the public `GET /api/properties/search` endpoint (see
 * `backend/controllers/property/searchQueryBuilder.ts` for the full contract)
 * via the shared `api` client. Returns an infinite query keyed by the active
 * {@link SearchQuery} so paging through results reuses the same cache entry and
 * changing any search parameter starts a fresh fetch.
 *
 * The endpoint accepts: `q`/`city`, a bounding box (`swLat/swLng/neLat/neLng`)
 * or center+radius (`lat/lng/radius`), `propertyType` (comma list),
 * `priceMin/priceMax` (or `minSalePrice/maxSalePrice` for sale),
 * `bedrooms/bathrooms`, `amenities` (comma), `guests`, `offering`
 * ({@link OfferingType}), `sortBy` ({price|createdAt|relevance|fairness}),
 * `fairPrice` (true → `priceEthics.isFairPrice`), `sortOrder`
 * (asc|desc), `page`, `limit` (≤50). The backend resolves the price-range field
 * from the requested `offering` (long-term → monthly amount, short-term →
 * nightly rate, sale → sale price). Each returned property exposes
 * `address.coordinates.coordinates` as `[lng, lat]` for map pins.
 */
import { type InfiniteData, type UseInfiniteQueryResult } from '@tanstack/react-query';
import { useMemo } from 'react';
import { OfferingType, type Property } from '@homiio/shared-types';
import type { SearchBounds, SearchQuery } from '@/components/search/types';
import {
  PROPERTY_LIST_PAGE_SIZE,
  useInfinitePropertyList,
} from './useInfinitePropertyList';

/** Endpoint path for the public property search. */
const SEARCH_ENDPOINT = '/api/properties/search';

/**
 * Raw search response envelope. The backend returns both the nested
 * `pagination` shape and the flat aliases below; we read the flat ones.
 */
interface SearchResponse {
  success: boolean;
  data: Property[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasMore: boolean;
}

/** One page of results plus paging metadata used by `getNextPageParam`. */
export interface PropertySearchPage {
  properties: Property[];
  page: number;
  totalPages: number;
  total: number;
  hasMore: boolean;
}

/**
 * Translate a {@link SearchBounds} into the four corner params the endpoint
 * expects. Returns the bbox-rounded values (3dp) to keep query keys stable
 * across sub-metre map jitter.
 */
function boundsToParams(bounds: SearchBounds): Record<string, number> {
  const round = (n: number): number => Math.round(n * 1000) / 1000;
  return {
    swLat: round(bounds.south),
    swLng: round(bounds.west),
    neLat: round(bounds.north),
    neLng: round(bounds.east),
  };
}

/**
 * Map the active {@link SearchQuery} onto the endpoint's query params. Pure and
 * exported so the query key can be derived from the exact same object.
 */
export function buildSearchParams(query: SearchQuery): Record<string, string | number> {
  const isSale = query.offering === OfferingType.SALE;
  const params: Record<string, string | number> = {
    page: 1,
    limit: PROPERTY_LIST_PAGE_SIZE,
    // The single offering axis the backend filters membership on AND resolves
    // the price-range field from (long-term → monthly, short-term → nightly,
    // sale → sale price).
    offering: query.offering,
    // When scoped to sale, sort by sale price rather than rent (`price` ->
    // `salePrice`); the backend recognises the dedicated sale-price sort field.
    sortBy: isSale && query.sortBy === 'price' ? 'salePrice' : query.sortBy,
    sortOrder: query.sortOrder,
  };

  const location = query.location;
  if (location?.bounds) {
    Object.assign(params, boundsToParams(location.bounds));
  } else if (location?.center) {
    const [lng, lat] = location.center;
    params.lat = lat;
    params.lng = lng;
  }
  if (location?.label) {
    params.q = location.label;
  }

  if (query.propertyTypes.length > 0) {
    params.propertyType = query.propertyTypes.join(',');
  }
  // For a sale search the price range refers to the SALE price, so route it to
  // the dedicated sale-price params; otherwise it's the rent price range
  // (resolved server-side to the active offering's monthly/nightly field).
  if (typeof query.priceMin === 'number') {
    params[isSale ? 'minSalePrice' : 'priceMin'] = query.priceMin;
  }
  if (typeof query.priceMax === 'number') {
    params[isSale ? 'maxSalePrice' : 'priceMax'] = query.priceMax;
  }
  if (typeof query.bedrooms === 'number' && query.bedrooms > 0) {
    params.bedrooms = query.bedrooms;
  }
  if (typeof query.bathrooms === 'number' && query.bathrooms > 0) {
    params.bathrooms = query.bathrooms;
  }
  if (query.amenities.length > 0) {
    params.amenities = query.amenities.join(',');
  }
  if (typeof query.guests === 'number' && query.guests > 0) {
    params.guests = query.guests;
  }
  if (query.dates) {
    params.checkIn = query.dates.start;
    params.checkOut = query.dates.end;
  }
  if (query.fairPrice === true) {
    params.fairPrice = 'true';
  }
  // Category-lens flags. The backend gates `instantBook`/`petFriendly` on the
  // boolean and `exchangeMode` on `offering === EXCHANGE`, so these are safe to
  // always emit when set; they also fold into `searchQueryKey` so toggling a
  // home category re-keys the feed and refetches.
  if (query.instantBook === true) {
    params.instantBook = 'true';
  }
  if (query.petFriendly === true) {
    params.petFriendly = 'true';
  }
  if (query.exchangeMode) {
    params.exchangeMode = query.exchangeMode;
  }

  return params;
}

/**
 * Stable query key for the active search. Excludes `page` (the infinite query
 * owns paging) so all pages of one search share a cache entry.
 */
export function searchQueryKey(query: SearchQuery): readonly unknown[] {
  const { page: _page, limit: _limit, ...rest } = buildSearchParams(query);
  return ['propertySearch', rest];
}

/**
 * Whether the query carries enough intent to be worth executing. We allow an
 * empty query (returns the default published feed) but skip running while the
 * caller is still composing — the `enabled` arg lets the panel gate it.
 */
export interface UsePropertySearchOptions {
  /** When false, the query is held (e.g. while the panel is mid-edit). */
  enabled?: boolean;
}

export type PropertySearchResult = UseInfiniteQueryResult<
  InfiniteData<PropertySearchPage>,
  Error
> & {
  /** All loaded properties flattened across pages. */
  properties: Property[];
  /** Total match count reported by the server. */
  total: number;
};

export function usePropertySearch(
  query: SearchQuery,
  options: UsePropertySearchOptions = {},
): PropertySearchResult {
  const { enabled = true } = options;
  const baseParams = useMemo(() => buildSearchParams(query), [query]);
  // Key excludes `page`/`limit` (the infinite query owns paging) so every page of
  // one search shares a cache entry — the same shape `searchQueryKey` returns,
  // but derived from the already-built `baseParams` so the params object is
  // constructed once per query instead of a second time inside `searchQueryKey`.
  const queryKey = useMemo(() => {
    const { page: _page, limit: _limit, ...rest } = baseParams;
    return ['propertySearch', rest] as const;
  }, [baseParams]);

  return useInfinitePropertyList<SearchResponse, PropertySearchPage>({
    queryKey,
    endpoint: SEARCH_ENDPOINT,
    baseParams,
    enabled,
    mapResponse: (data, pageParam) => ({
      properties: data.data ?? [],
      page: data.page ?? pageParam,
      totalPages: data.totalPages ?? 1,
      total: data.total ?? (data.data?.length ?? 0),
      hasMore: data.hasMore ?? false,
    }),
  });
}
