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
  deriveQueryId,
  locationKey,
  type GeoBounds,
  type GeoPoint,
  type LocationKind,
  type LocationSelection,
  type Property,
  type QueryDescriptor,
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
 * What the server says it actually applied (ADR 0002 §6.3).
 *
 * Read rather than re-derived: the client's belief about the request it sent is
 * the one thing that cannot arbitrate "map in Madrid, list from Barcelona".
 */
export interface SearchLocationEcho {
  status: 'resolved' | 'unresolved' | 'none';
  /** The coarse scope the query really ran under. Absent on an older server. */
  appliedLocationKind?: LocationKind;
  cityId?: string;
  regionId?: string;
  neighborhoodId?: string;
  bounds?: GeoBounds;
  center?: GeoPoint;
  radiusMeters?: number;
  requested?: { param: string; value: string };
}

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
  /** The `queryId` this request carried, echoed verbatim. */
  queryId?: string;
  location?: SearchLocationEcho;
}

/** One page of results plus paging metadata used by `getNextPageParam`. */
export interface PropertySearchPage {
  properties: Property[];
  page: number;
  totalPages: number;
  total: number;
  hasMore: boolean;
  /** The identity this page belongs to, as the SERVER echoed it. */
  queryId: string | null;
  /** The scope the server applied for this page, or `null` when it said nothing. */
  location: SearchLocationEcho | null;
}

/**
 * A page that came back stamped with a different query's identity.
 *
 * Thrown rather than rendered, which is the whole point: the alternative is
 * showing one query's rows under another query's heading and count, and that
 * failure looks exactly like a correct result. React Query turns it into the
 * error state, which already carries a retry and keeps the previous map and
 * filters (ADR 0002 §6.3, invariant 5 of #354).
 */
export class StaleSearchResponseError extends Error {
  constructor(
    readonly expected: string,
    readonly received: string,
  ) {
    super(`Search response belongs to query ${received}, not ${expected}`);
    this.name = 'StaleSearchResponseError';
  }
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
 *
 * **`null` means "this selection cannot be scoped", and it is NOT the same as
 * `{}`.** A homiio COUNTRY has no id param on this endpoint (`city`, `state`
 * and `neighborhood` are the three it takes), `precision: 'area'` means it
 * carries no centre, and its record may carry no bounds either — so there is
 * genuinely nothing to send. Returning `{}` there would run the query with no
 * geographic filter at all and answer globally under the country's name, which
 * is the same bug as substituting `(0,0)`, only quieter: `(0,0)` returns a
 * suspicious zero, an unscoped query returns a confident everything. The caller
 * refuses to run instead — see `usePropertySearch`.
 */
function locationParams(selection: LocationSelection): Record<string, string | number> | null {
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
        // An id scopes the search on its own and needs NO geometry, which is
        // what makes a coordinate-less city a legitimate selection rather than
        // a broken one: Homiio knows it by id, the query filters by that id,
        // and only the MAP has nothing to frame from. Dropping such a city
        // would reintroduce the homonym the disambiguation list exists to let
        // somebody reach.
        if (entity === 'city') return { city: id };
        if (entity === 'region') return { state: id };
        if (entity === 'neighborhood') return { neighborhood: id };
      }
      // An external candidate carries no id this backend can resolve, so it is
      // scoped by the geometry it inlined — which is why an `external` place is
      // required to carry its own bounds/centre in the first place.
      return geometryParams(selection);
    }

    case 'address_candidate':
      return geometryParams(selection);

    case 'map_bounds':
    case 'polygon':
      return boundsToParams(selection.bounds);

    case 'multi_area': {
      // The endpoint takes ONE scope. Rather than silently querying the first
      // area — the "quietly choose one" behaviour this contract exists to
      // remove — a multi-area selection is scoped by the box that covers all of
      // them, which is a superset and therefore honest about over-returning
      // rather than wrong about under-returning.
      const cover = coveringBounds(selection.areas);
      return cover ? boundsToParams(cover) : null;
    }

    default: {
      const exhaustive: never = selection;
      return exhaustive;
    }
  }
}

/** A zero-area box at a point — the identity element for a cover. */
function pointBox(center: GeoPoint): GeoBounds {
  return {
    west: center.longitude,
    east: center.longitude,
    south: center.latitude,
    north: center.latitude,
  };
}

/**
 * The geographic params for a selection scoped only by its own geometry.
 *
 * A BOX is preferred over a point: an area framed by a radius around a centre
 * is a different question with a different answer. A place with NEITHER yields
 * no geographic params at all, and the comment matters more than the code —
 * that case is refused upstream rather than handled here. `resolveLocationRef`
 * resolves only Homiio cities, which take the id branch above and never reach
 * this function, so a geometry-less place arriving here would mean a selection
 * was committed that no resolver produces. Emitting nothing is the least-wrong
 * residual, not a supported path.
 */
function geometryParams(selection: {
  bounds?: GeoBounds;
  center?: GeoPoint;
}): Record<string, string | number> | null {
  if (selection.bounds) return boundsToParams(selection.bounds);
  if (selection.center) {
    return { lat: selection.center.latitude, lng: selection.center.longitude };
  }
  return null;
}

/**
 * The smallest box containing every area's own box or centre.
 *
 * An area with no geometry contributes NOTHING rather than a `(0,0)` corner —
 * `PlaceGeometry` now says a place may legitimately have no point, and folding
 * a missing one in as the origin would drag the cover across the Atlantic and
 * quietly widen the search to half the planet.
 */
function coveringBounds(areas: readonly SingleLocationSelection[]): GeoBounds | null {
  /**
   * The area an entry covers, or `null` when it carries no geometry.
   *
   * Switched on `kind` rather than probed with `in`, because
   * `current_location` has no `bounds` FIELD at all while `place` has an
   * optional one — a property test cannot tell "this kind has no such field"
   * from "this instance left it out", and only one of those is a real absence.
   */
  function boxOf(area: SingleLocationSelection): GeoBounds | null {
    switch (area.kind) {
      case 'polygon':
      case 'map_bounds':
        return area.bounds;
      case 'current_location':
        return pointBox(area.center);
      case 'place':
      case 'address_candidate':
        return area.bounds ?? (area.center ? pointBox(area.center) : null);
    }
  }

  let west = 180;
  let south = 90;
  let east = -180;
  let north = -90;
  let contributors = 0;

  for (const area of areas) {
    const box = boxOf(area);
    if (!box) continue;

    contributors += 1;
    west = Math.min(west, box.west);
    south = Math.min(south, box.south);
    east = Math.max(east, box.east);
    north = Math.max(north, box.north);
  }

  // No area brought any geometry, so there is no cover. Returning the initial
  // sentinels would emit an INVERTED box spanning the world.
  return contributors > 0 ? { west, south, east, north } : null;
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
    // `null` is handled by `unscopeableLocation` below and by the hook's
    // `enabled` gate; the params object simply carries no geographic filter,
    // and nothing is allowed to SEND it in that state.
    Object.assign(params, locationParams(query.location) ?? {});
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
 * Whether a committed location cannot be expressed as a scope this endpoint
 * accepts.
 *
 * Exported so a screen can say "we cannot search that area yet" rather than
 * rendering a global feed under a place's name. Today the only shape that
 * reaches it is a homiio place that is neither a city, a region nor a
 * neighborhood — a COUNTRY — carrying no geometry.
 */
export function isUnscopeableLocation(location: SearchQuery['location']): boolean {
  return location !== null && locationParams(location) === null;
}

/**
 * The COARSE scope label a query id is stamped with.
 *
 * Coarse is the right word and the reason it is safe: identity comes from
 * `placeKey`, which is `locationKey` and therefore carries the canonical id, so
 * two places that share a label here still produce different ids. A `district`
 * and a `postcode` both reporting `neighborhood` merges nothing; it only means
 * the vocabulary the observability schema publishes (`LOCATION_KINDS`) has no
 * finer word, and inventing one here would put a second vocabulary in the repo.
 */
function descriptorLocationKind(selection: LocationSelection | null): LocationKind {
  if (!selection) return 'none';
  switch (selection.kind) {
    case 'current_location':
      return 'radius';
    case 'map_bounds':
    case 'polygon':
      return 'bbox';
    // A multi-area selection goes out as the box that COVERS its areas (see
    // `locationParams`), so `bbox` is what the request actually applied rather
    // than a compromise.
    case 'multi_area':
      return 'bbox';
    case 'address_candidate':
      return 'neighborhood';
    case 'place':
      switch (selection.placeType) {
        case 'country':
          return 'country';
        case 'region':
          return 'region';
        case 'city':
          return 'city';
        case 'district':
        case 'neighborhood':
        case 'postcode':
          return 'neighborhood';
        default: {
          const exhaustive: never = selection.placeType;
          return exhaustive;
        }
      }
    default: {
      const exhaustive: never = selection;
      return exhaustive;
    }
  }
}

/** Read a numeric param back out of the built params, or `undefined`. */
function numericParam(
  params: Record<string, string | number>,
  key: string,
): number | undefined {
  const value = params[key];
  return typeof value === 'number' ? value : undefined;
}

/**
 * The descriptor a query's id is the digest of.
 *
 * ## It is built FROM the request params, not beside them
 *
 * `filters` is the same `rest` object the cache key uses — everything
 * `buildSearchParams` emitted minus paging and the geographic dimension — so a
 * new filter cannot be added to the request and forgotten here. A descriptor
 * assembled field-by-field would need editing every time a filter lands, and
 * the failure of forgetting is silent: two different searches would share one
 * id, one cache entry and one heading.
 *
 * ## NO COORDINATE EVER ENTERS IT
 *
 * `bounds` is a map viewport, which is not anybody's position. Everything else
 * geographic reaches the descriptor as `placeKey` (a canonical id) or as
 * `radiusKm` (a distance). In particular `current_location` contributes its
 * RADIUS and nothing else, exactly as `locationKey` does — the device fix goes
 * in the request and reaches no key, no id, no URL and no log (ADR 0002 §8.2).
 *
 * The inherited consequence, stated because it is real: two device searches at
 * the same radius from positions 50 km apart produce one id and therefore one
 * cache entry. That is `locationKey`'s existing behaviour, decided by the ADR
 * rather than by this function.
 */
export function searchQueryDescriptor(query: SearchQuery): QueryDescriptor {
  const params = buildSearchParams(query);
  const west = numericParam(params, 'swLng');
  const south = numericParam(params, 'swLat');
  const east = numericParam(params, 'neLng');
  const north = numericParam(params, 'neLat');
  const bounds =
    west !== undefined && south !== undefined && east !== undefined && north !== undefined
      ? { west, south, east, north }
      : undefined;
  const radiusMeters = numericParam(params, 'radius');

  return {
    locationKind: descriptorLocationKind(query.location),
    placeKey: locationKey(query.location),
    ...(bounds ? { bounds } : {}),
    ...(radiusMeters === undefined ? {} : { radiusKm: radiusMeters / 1000 }),
    ...(query.queryText ? { freeText: query.queryText } : {}),
    sort: `${query.sortBy}:${query.sortOrder}`,
    filters: identifyingParams(params),
  };
}

/**
 * The ONE identity the map, the list, the heading, the count, the cache key and
 * the server's echo all quote.
 *
 * It is `deriveQueryId` from the observability contract rather than a second
 * hash of this module's own, because the analytics events #350 defines already
 * carry a `queryId` on exactly this shape (`schema.ts`, `opaqueId`). Two
 * derivations would guarantee that a divergence report and the UI disagree
 * about which search they are describing.
 */
export function searchQueryId(query: SearchQuery): string {
  return deriveQueryId(searchQueryDescriptor(query));
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
  return buildSearchQueryKey(buildSearchParams(query), query.location, searchQueryId(query));
}

/**
 * Everything a request carries that is neither paging nor geography.
 *
 * Shared by the cache key and {@link searchQueryDescriptor} so the identity and
 * the key cannot disagree about which dimensions matter, and so a filter added
 * to `buildSearchParams` reaches both without being named twice.
 */
function identifyingParams(
  params: Record<string, string | number>,
): Record<string, string | number> {
  const {
    // Paging is the infinite query's own business: all pages of one search
    // share a cache entry.
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
    // `neighborhood` is a canonical id rather than a coordinate, so it leaks
    // nothing — but it IS the geographic dimension, and `locationKey` already
    // carries it as `homiio:neighborhood:<id>`. Leaving it here would make the
    // comment above false for one param, which is how the next person removing
    // a leak misses one.
    neighborhood: _neighborhood,
    ...rest
  } = params;
  return rest;
}

/** Shared by {@link searchQueryKey} and the hook, so the two cannot drift. */
function buildSearchQueryKey(
  params: Record<string, string | number>,
  location: SearchQuery['location'],
  queryId: string,
): readonly unknown[] {
  // `queryId` leads, because it is the identity every other surface quotes and
  // "the list, the map and the heading share a query id" has to be true of the
  // cache too. It is REDUNDANT with the two elements after it, by construction:
  // the descriptor it digests is built from this same params object and this
  // same `locationKey`. They stay because a hash cannot be read — the leak test
  // in `__tests__/buildSearchParams.test.ts` inspects the key for a coordinate,
  // and against a key that was only a digest that assertion could never fail.
  return ['propertySearch', queryId, locationKey(location), identifyingParams(params)];
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
  /**
   * The identity of the query this result describes.
   *
   * Every surface that renders any part of it — the heading, the count, the
   * markers, the map camera — is showing THIS query and can say so.
   */
  queryId: string;
  /**
   * The scope the SERVER applied, or `null` until a page has arrived.
   *
   * ADR 0002 §6.3: the map frames itself from this rather than from the
   * client's belief about the request it sent.
   */
  appliedLocation: SearchLocationEcho | null;
};

export function usePropertySearch(
  query: SearchQuery,
  options: UsePropertySearchOptions = {},
): PropertySearchResult {
  const { enabled = true } = options;
  // A location that cannot be scoped must not run. Letting it through would
  // send a request with no geographic filter and render everything on earth
  // under that place's name — the failure ADR 0002 §4.3 forbids, arrived at
  // from the params side rather than the resolution side.
  const unscopeable = isUnscopeableLocation(query.location);
  const searchParams = useMemo(() => buildSearchParams(query), [query]);
  const queryId = useMemo(() => searchQueryId(query), [query]);
  // Sent so the server can stamp its answer with the identity it was asked
  // under. It is an echo, never an input: nothing server-side reads it as a
  // filter, and a response carrying somebody else's stamp is refused below.
  const baseParams = useMemo(
    () => ({ ...searchParams, queryId }),
    [searchParams, queryId],
  );
  // Built from the already-constructed params so the object is not built twice
  // per query, through the SAME helper `searchQueryKey` uses so the two cannot
  // drift — a hook keyed differently from the exported key function is a cache
  // that misses in one direction and collides in the other.
  const queryKey = useMemo(
    () => buildSearchQueryKey(searchParams, query.location, queryId),
    [searchParams, query.location, queryId],
  );

  const result = useInfinitePropertyList<SearchResponse, PropertySearchPage>({
    queryKey,
    endpoint: SEARCH_ENDPOINT,
    baseParams,
    enabled: enabled && !unscopeable,
    mapResponse: (data, pageParam) => {
      // A server that says NOTHING is not a mismatch — an older deployment
      // echoes no id, and refusing its answers would black out the results
      // surface for a shape that is merely older, not wrong. A server that
      // names a DIFFERENT query is refused, because rendering it would put one
      // search's rows under another's heading and count, which is precisely the
      // failure that cannot be seen by looking at the screen.
      if (typeof data.queryId === 'string' && data.queryId.length > 0 && data.queryId !== queryId) {
        throw new StaleSearchResponseError(queryId, data.queryId);
      }
      return {
        properties: data.data ?? [],
        page: data.page ?? pageParam,
        totalPages: data.totalPages ?? 1,
        total: data.total ?? (data.data?.length ?? 0),
        hasMore: data.hasMore ?? false,
        queryId: data.queryId ?? null,
        location: data.location ?? null,
      };
    },
  });

  return {
    ...result,
    queryId,
    appliedLocation: result.data?.pages[0]?.location ?? null,
  };
}
