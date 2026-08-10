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
import {
  OfferingType,
  locationKey,
  type GeoBounds,
  type LocationSelection,
  type Property,
  type SingleLocationSelection,
} from '@homiio/shared-types';
import type { SearchQuery } from '@/components/search/types';
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
 * Translate a {@link GeoBounds} into the four corner params the endpoint
 * expects. Returns the bbox-rounded values (3dp) to keep query keys stable
 * across sub-metre map jitter.
 */
function boundsToParams(bounds: GeoBounds): Record<string, number> {
  const round = (n: number): number => Math.round(n * 1000) / 1000;
  return {
    swLat: round(bounds.south),
    swLng: round(bounds.west),
    neLat: round(bounds.north),
    neLng: round(bounds.east),
  };
}

/**
 * The geographic params for a committed selection — ONE shape per selection,
 * never two at once.
 *
 * The endpoint refuses a box AND a centre+radius in the same request
 * (`INVALID_LOCATION`), which is the server half of the same rule the atomic
 * selection enforces on the client: a query has at most one authoritative
 * geographic scope. Because the selection is a discriminated union, "emit the
 * box and also the centre" is not something this function can express.
 *
 * A `place` prefers its BOUNDS over its centre when it has them — a city is an
 * area, and framing it by a radius around its centroid is a different question
 * with a different answer. `homiio`-sourced places go out as a canonical id, so
 * two cities named Barcelona stay two different requests.
 */
function locationParams(selection: LocationSelection): Record<string, string | number> {
  switch (selection.kind) {
    case 'current_location':
      // Full precision in the REQUEST — this is the one place the device fix
      // legitimately goes. It reaches no key, no URL and no log; `locationKey`
      // cannot emit it and `serializeLocationToken` writes `here.<radius>`.
      return {
        lat: selection.center.latitude,
        lng: selection.center.longitude,
        radius: selection.radiusMeters,
      };

    case 'place': {
      if (selection.source.kind === 'homiio') {
        const { entity, id } = selection.source;
        if (entity === 'city') return { city: id };
        if (entity === 'region') return { state: id };
      }
      // An external candidate carries no id this backend can resolve, so it is
      // scoped by the geometry it inlined — which is why an `external` place is
      // required to carry its own bounds/centre in the first place.
      return selection.bounds
        ? boundsToParams(selection.bounds)
        : { lat: selection.center.latitude, lng: selection.center.longitude };
    }

    case 'address_candidate':
      return selection.bounds
        ? boundsToParams(selection.bounds)
        : { lat: selection.center.latitude, lng: selection.center.longitude };

    case 'map_bounds':
    case 'polygon':
      return boundsToParams(selection.bounds);

    case 'multi_area':
      // The endpoint takes ONE scope. Rather than silently querying the first
      // area — the "quietly choose one" behaviour this contract exists to
      // remove — a multi-area selection is scoped by the box that covers all of
      // them, which is a superset and therefore honest about over-returning
      // rather than wrong about under-returning.
      return boundsToParams(coveringBounds(selection.areas));

    default: {
      const exhaustive: never = selection;
      return exhaustive;
    }
  }
}

/** The smallest box containing every area's own box or centre. */
function coveringBounds(areas: readonly SingleLocationSelection[]): GeoBounds {
  let west = 180;
  let south = 90;
  let east = -180;
  let north = -90;
  for (const area of areas) {
    // `polygon` carries bounds and no centre; `current_location` the reverse.
    // Degenerating a centre to a zero-area box is correct here — the union of
    // it with any other box is unaffected, and a lone point yields a point box
    // the backend reads as an exact-match rectangle rather than as everywhere.
    const box: GeoBounds =
      area.kind === 'polygon' || area.kind === 'map_bounds'
        ? area.bounds
        : (area.kind === 'place' || area.kind === 'address_candidate') && area.bounds
          ? area.bounds
          : {
              west: area.center.longitude,
              east: area.center.longitude,
              south: area.center.latitude,
              north: area.center.latitude,
            };
    west = Math.min(west, box.west);
    south = Math.min(south, box.south);
    east = Math.max(east, box.east);
    north = Math.max(north, box.north);
  }
  return { west, south, east, north };
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

  if (query.location) {
    Object.assign(params, locationParams(query.location));
  }
  // `q` carries free text and NOTHING else. It used to be assigned
  // `location.label` unconditionally whenever a label existed, IN ADDITION to
  // the geographic params — so a request said "listings matching the word
  // Barcelona, physically inside this Madrid rectangle", whose honest answer is
  // zero. Zero is the plausible-looking failure, which is why it went unnoticed
  // and why `__tests__/buildSearchParams.test.ts` asserts on the PARAMS rather
  // than on a result count.
  if (query.queryText) {
    params.q = query.queryText;
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
 * Stable query key for the active search.
 *
 * Excludes `page`/`limit` (the infinite query owns paging) so all pages of one
 * search share a cache entry, and — the part that matters — routes the
 * geographic dimension through `locationKey` instead of embedding the built
 * params verbatim.
 *
 * The old key WAS the param object, full-precision `lat`/`lng` included, which
 * put the user's device position into React Query's cache keys and into
 * anything that ever serialises them (devtools, a persister, an error report).
 * `locationKey` is the single function allowed to turn a selection into a
 * string for a key, and its `current_location` branch has no coordinate to
 * emit — so the rule is enforced by that function's shape rather than by
 * everyone remembering it here.
 *
 * It also fixes a cache correctness bug in the same move: two different cities
 * called Barcelona produced the same key whenever their bounding boxes rounded
 * alike, and a jittering map viewport produced a NEW key on every frame.
 * `locationKey` gives distinct ids distinct keys and grids a box to 3 dp.
 */
export function searchQueryKey(query: SearchQuery): readonly unknown[] {
  return buildSearchQueryKey(buildSearchParams(query), query.location);
}

/** Shared by {@link searchQueryKey} and the hook, so the two cannot drift. */
function buildSearchQueryKey(
  params: Record<string, string | number>,
  location: SearchQuery['location'],
): readonly unknown[] {
  const {
    page: _page,
    limit: _limit,
    // Every geographic param is replaced by `locationKey`. Dropping them here
    // is what removes the coordinates; leaving one behind would reinstate the
    // leak silently, since the key would still LOOK keyed by location.
    lat: _lat,
    lng: _lng,
    radius: _radius,
    swLat: _swLat,
    swLng: _swLng,
    neLat: _neLat,
    neLng: _neLng,
    city: _city,
    state: _state,
    ...rest
  } = params;
  return ['propertySearch', locationKey(location), rest];
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
  // Built from the already-constructed `baseParams` so the params object is not
  // built twice per query, through the SAME helper `searchQueryKey` uses so the
  // two cannot drift — a hook keyed differently from the exported key function
  // is a cache that misses in one direction and collides in the other.
  const queryKey = useMemo(
    () => buildSearchQueryKey(baseParams, query.location),
    [baseParams, query.location],
  );

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
