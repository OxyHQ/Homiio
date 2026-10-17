/**
 * Listing reads and listing reports — the use cases behind the public listing
 * routes (`routes/public.ts`: search, nearby, one listing) and the
 * authenticated report route, shared by those routes and by the catalogue's
 * `searchListings`, `findNearbyListings`, `getListing` and `reportListing`.
 *
 * ## The viewer is a parameter, never a request
 *
 * A public read answers two bodies (ADR 0003): the OWNER of a listing reads its
 * exact floor and unit, everybody else its published precision. The route
 * decides that from the session the optional Oxy auth resolved; a tool decides
 * it from the effective account. Both reach {@link getListing} with one
 * `viewerOxyUserId` and nothing else, so the two cannot disagree.
 *
 * ## The search scope lives here
 *
 * The free-text query, the explicit place params and the geometry are resolved
 * to ONE predicate by {@link resolveSearchScope}, shared by the search page and
 * its price histogram (`controllers/property/priceHistogram.ts`) so the two
 * cannot answer about different scopes.
 *
 * ## The address-id round trip is gone — three times over
 *
 * A property has no coordinates of its own, so this used to resolve matching
 * Address ids FIRST and constrain properties by `addressId: { $in: … }`, in
 * three places. All three are now predicates in the property statement itself,
 * against the `addresses` row the read already joins:
 *
 *  - the box / radius → `ST_Intersects` / `ST_DWithin` on `addresses.geo`
 *    (`db/properties/propertyGeo.ts`);
 *  - an explicit `city`/`state` → `addresses.city_id` / `region_id`, resolved to
 *    ONE canonical id by `geoQueryService` before the query is built;
 *  - the free-text place match → the same two id comparisons, ORed with the
 *    listing's `search_vector` and an `ILIKE` on `addresses.street`.
 *
 * ## Free text is `websearch_to_tsquery`, which ANDs
 *
 * An OR of terms would make "apartment barcelona" match every apartment
 * anywhere. `websearch_to_tsquery` ANDs them and understands quoted phrases and
 * an explicit `or`. See `db/properties/propertyFilters`.
 */

import { sql, type SQL } from 'drizzle-orm';
import {
  type ListingCurrency,
  ListingReportReason,
  type LocationKind,
  ModerationReportedType,
} from '@homiio/shared-types';

import { buildCommonPropertyFilters } from '../controllers/property/commonFilters';
import {
  buildSearchPlan,
  buildSort,
  GeoParamError,
  MAX_LATITUDE,
  MAX_LONGITUDE,
  MIN_LATITUDE,
  MIN_LONGITUDE,
  type ParsedSearchParams,
} from '../controllers/property/searchQueryBuilder';
import { getQueryInteger, getQueryNumber, getQueryString } from '../controllers/queryParams';
import {
  DuplicateListingReportError,
  findOpenListingReport,
  insertListingReport,
} from '../db/moderation/listingReportRepository';
import { DuplicateModerationReportError } from '../db/moderation/moderationReportRepository';
import { getDb } from '../db/postgres';
import { dominantCurrency, priceCurrencyCensus } from '../db/properties/priceCurrency';
import {
  inCity,
  inCountry,
  inNeighborhood,
  inRegion,
  matchesText,
  priceInRange,
} from '../db/properties/propertyFilters';
import { withinBoundingBox, withinCircle } from '../db/properties/propertyGeo';
import {
  allOf,
  countProperties,
  findProperties,
  findPropertyById,
  NEWEST_FIRST,
  propertyOrderBy,
} from '../db/properties/propertyReads';
import {
  type PropertyAudience,
  propertyAudienceFor,
  serializeProperty,
} from '../db/properties/propertySerializer';
import { incrementPropertyViews } from '../db/properties/propertyWrites';
import { trackPropertyView } from '../db/saved/recentlyViewedRepository';
import { AppError, paginationResponse } from '../middlewares/errorHandler';
import { logger } from '../middlewares/logging';
import {
  createModerationReport,
  withReportIntakeTransaction,
} from '../services/moderation/ReportIntakeService';
import { resolveCityId, resolveNeighborhoodId, resolveRegionId } from '../services/geoQueryService';

/** A query-string-shaped input, as the public routes receive it. */
export type ListingQuery = Record<string, string | string[] | undefined>;

/**
 * A malformed listing query: answered 400 with `{ success: false, message,
 * error: code }` by the routes (their historical body), and as a tool error by
 * the catalogue.
 */
export class ListingQueryError extends AppError {
  constructor(message: string, code: string) {
    super(message, 400, code);
    this.name = 'ListingQueryError';
  }
}

/**
 * The place constraints, resolved.
 *
 * `unresolved` is the "a location was asked for and it does not exist" answer —
 * distinct from "no location constraint", which is an empty condition list. The
 * caller answers the first with an empty page and applies the second.
 */
/** The named place params a caller can send, and so the ones an echo can report as unresolved. */
type UnresolvedParam = 'city' | 'state' | 'neighborhood' | 'country';

interface ResolvedPlace {
  conditions: SQL[];
  unresolved: boolean;
  /** Which named parameter failed to resolve, for the response's echo. */
  unresolvedParam?: UnresolvedParam;
  /** The canonical ids the scope was actually narrowed to, for the echo. */
  cityId?: string;
  regionId?: string;
  neighborhoodId?: string;
  /** The ISO-2 code (upper-cased) the scope was narrowed to, for the echo. */
  countryCode?: string;
}

/**
 * What the server ACTUALLY applied, echoed back on every search response.
 *
 * ADR 0002 §6.3: the map frames itself from this, not from the client's belief
 * about the request it sent, so "map in Madrid, list from Barcelona" stops
 * being reachable by a race — the two read one field of one payload.
 *
 * `unresolved` is the half that matters most and the half that costs nothing:
 * an unresolvable place has always answered with an empty page rather than an
 * unfiltered one (which is correct), but with no marker on it, so a client
 * could not tell "there are no homes here" from "we did not understand where".
 * Those are different sentences and the UI has to be able to pick one.
 */
export type LocationEcho =
  | {
      status: 'resolved';
      appliedLocationKind: LocationKind;
      cityId?: string;
      regionId?: string;
      neighborhoodId?: string;
      countryCode?: string;
      bounds?: { west: number; south: number; east: number; north: number };
      center?: { longitude: number; latitude: number };
      radiusMeters?: number;
    }
  | {
      status: 'unresolved';
      appliedLocationKind: LocationKind;
      requested: { param: UnresolvedParam; value: string };
    }
  | { status: 'none'; appliedLocationKind: LocationKind };

/**
 * The single coarse word for the scope that was APPLIED.
 *
 * Total rather than optional, and it is `'none'` in both empty cases: an
 * unresolvable place applies no filter at all, so saying "none" is the truth
 * about the query that ran, and `status` is what distinguishes it from a search
 * that never named a place. Two fields, two different questions — collapsing
 * them is how "we could not find that place" and "there are no homes here"
 * became the same bytes in the first place.
 *
 * The vocabulary is `LOCATION_KINDS` from the observability contract rather
 * than one invented here, so a scope reported in an event and a scope reported
 * in a response cannot be described in two different words.
 *
 * Precedence when place ids nest: the NARROWEST wins, because that is the one
 * that decides the result set. A shape scope cannot co-occur with a place —
 * `buildSearchPlan` refuses that combination outright.
 */
function appliedLocationKind(params: ParsedSearchParams, place: ResolvedPlace): LocationKind {
  if (place.unresolved) return 'none';
  if (params.boundingBox) return 'bbox';
  if (params.centerRadius) return 'radius';
  if (place.neighborhoodId) return 'neighborhood';
  if (place.cityId) return 'city';
  if (place.regionId) return 'region';
  if (place.countryCode) return 'country';
  return 'none';
}

/** Describe the geographic scope the query ran under. */
function buildLocationEcho(params: ParsedSearchParams, place: ResolvedPlace): LocationEcho {
  if (place.unresolved && place.unresolvedParam) {
    return {
      status: 'unresolved',
      appliedLocationKind: appliedLocationKind(params, place),
      requested: {
        param: place.unresolvedParam,
        value: params[place.unresolvedParam] ?? '',
      },
    };
  }

  const hasScope =
    params.boundingBox !== undefined ||
    params.centerRadius !== undefined ||
    place.cityId !== undefined ||
    place.regionId !== undefined ||
    place.neighborhoodId !== undefined ||
    place.countryCode !== undefined;

  // "No location" is a legitimate query and answers normally — the failure mode
  // this contract forbids is a location REQUESTED AND LOST, never one that was
  // never asked for. Saying so explicitly is what lets a heading read "Homes
  // everywhere" honestly instead of naming a place nothing filtered on.
  if (!hasScope) return { status: 'none', appliedLocationKind: 'none' };

  return {
    status: 'resolved',
    appliedLocationKind: appliedLocationKind(params, place),
    ...(place.cityId ? { cityId: place.cityId } : {}),
    ...(place.regionId ? { regionId: place.regionId } : {}),
    ...(place.neighborhoodId ? { neighborhoodId: place.neighborhoodId } : {}),
    ...(place.countryCode ? { countryCode: place.countryCode } : {}),
    ...(params.boundingBox
      ? {
          bounds: {
            west: params.boundingBox.swLng,
            south: params.boundingBox.swLat,
            east: params.boundingBox.neLng,
            north: params.boundingBox.neLat,
          },
        }
      : {}),
    ...(params.centerRadius
      ? {
          center: {
            longitude: params.centerRadius.lng,
            latitude: params.centerRadius.lat,
          },
          radiusMeters: params.centerRadius.radiusMeters,
        }
      : {}),
  };
}

/**
 * Turn the geo and city/state intent into predicates on the joined address.
 *
 * A bounding box and a centre+radius are mutually exclusive, exactly as before —
 * the box wins when both are present. Several constraints stack with AND, so a
 * box AND a city means "in this city, inside this rectangle", which is what the
 * old id-set INTERSECTION computed by hand.
 */
async function resolvePlaceConditions(params: ParsedSearchParams): Promise<ResolvedPlace> {
  const conditions: SQL[] = [];

  if (params.boundingBox) {
    conditions.push(withinBoundingBox(params.boundingBox));
  } else if (params.centerRadius) {
    conditions.push(
      withinCircle({
        longitude: params.centerRadius.lng,
        latitude: params.centerRadius.lat,
        radiusMeters: params.centerRadius.radiusMeters,
      }),
    );
  }

  let cityId: string | undefined;
  let regionId: string | undefined;
  let neighborhoodId: string | undefined;

  if (params.city) {
    const resolved = await resolveCityId(params.city);
    if (!resolved) return { conditions: [], unresolved: true, unresolvedParam: 'city' };
    cityId = resolved;
    conditions.push(inCity(cityId));
  }
  if (params.state) {
    const resolved = await resolveRegionId(params.state);
    if (!resolved) return { conditions: [], unresolved: true, unresolvedParam: 'state' };
    regionId = resolved;
    conditions.push(inRegion(regionId));
  }

  if (params.neighborhood) {
    // Scoped by the city when one was also given, which narrows a NAME match to
    // the right "Centro" out of the several every country has. An id already
    // names one row, so the scope can only ever turn a right answer into none —
    // `resolveNeighborhoodId` applies it to the name side only.
    const resolved = await resolveNeighborhoodId(params.neighborhood, { cityId });
    if (!resolved) {
      return { conditions: [], unresolved: true, unresolvedParam: 'neighborhood' };
    }
    neighborhoodId = resolved;
    conditions.push(inNeighborhood(neighborhoodId));
  }

  let countryCode: string | undefined;
  if (params.country) {
    // The FORMAT is validated and membership is not: `ZZ` is a well-formed
    // country Homiio has no listings in, which is a legitimate empty page,
    // whereas `Spain` is a caller error and must be reported rather than
    // silently ignored into an unscoped search.
    if (!/^[A-Za-z]{2}$/.test(params.country)) {
      return { conditions: [], unresolved: true, unresolvedParam: 'country' };
    }
    countryCode = params.country.toUpperCase();
    conditions.push(inCountry(countryCode));
  }

  return { conditions, unresolved: false, cityId, regionId, neighborhoodId, countryCode };
}

/**
 * Build the public search response envelope. Combines the shared
 * `paginationResponse` shape (nested `pagination`) with the flat
 * `total`/`page`/`limit`/`totalPages`/`hasMore` aliases the frontend search
 * hook reads directly. Used by every exit path so the contract is identical.
 */
function buildSearchResponse(
  data: unknown[],
  page: number,
  limit: number,
  total: number,
  message: string,
  location: LocationEcho,
  queryId: string | undefined,
  priceCurrency?: ListingCurrency,
): Record<string, unknown> {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const hasMore = (page - 1) * limit + data.length < total;
  return {
    ...paginationResponse(data, page, limit, total, message),
    total,
    page,
    limit,
    totalPages,
    hasMore,
    location,
    // What unit the price bound was read in, when there was one. The server may
    // have chosen it (the caller sent a bare `priceMax`), so leaving it out
    // would make "under 1,200" a number with no unit on the one surface that
    // has to render it — the same implicitness ADR 0002 refuses for location.
    ...(priceCurrency === undefined ? {} : { priceCurrency }),
    // Absent rather than null when the caller sent none, so "this server does
    // not stamp answers" and "this answer belongs to another query" stay
    // distinguishable — a client that treated them alike would black out its
    // results surface against an older deployment.
    ...(queryId === undefined ? {} : { queryId }),
  };
}

/**
 * A search's scope, resolved: the parsed params, the location echo and — unless
 * the named place could not be resolved — the ONE `where` every read answering
 * this search runs under.
 */
export type SearchScope =
  | { status: 'unresolved'; params: ParsedSearchParams; location: LocationEcho }
  | {
      status: 'scoped';
      params: ParsedSearchParams;
      location: LocationEcho;
      where: SQL | undefined;
      /**
       * The currency the price bound was actually applied in.
       *
       * Absent when the request carried no price bound, and absent when it
       * carried one over a scope holding no priced listing that names a
       * currency. Echoed to the caller because a bound the server chose the
       * unit for is exactly the kind of decision ADR 0002 refuses to leave
       * implicit — a screen showing "up to 1,200" has to be able to say 1,200
       * of what.
       */
      priceCurrency?: ListingCurrency;
    };

/**
 * Parse a search request and resolve it to the predicate it runs under.
 *
 * Shared by the search page and its price histogram
 * (`controllers/property/priceHistogram.ts`) so the two cannot answer about
 * different scopes: a histogram built beside the search, predicate by
 * predicate, is the second copy that drifts the day a filter is added to one.
 *
 * Throws {@link GeoParamError} on a malformed geographic param; the route maps
 * it to a 400 (`sendGeoParamError` in `controllers/property/search.ts`) and
 * {@link searchListings} to a {@link ListingQueryError}.
 */
export async function resolveSearchScope(
  query: Record<string, string | string[] | undefined>,
): Promise<SearchScope> {
  const { conditions, price, params } = buildSearchPlan(query);

  const place = await resolvePlaceConditions(params);
  if (place.unresolved) {
    return { status: 'unresolved', params, location: buildLocationEcho(params, place) };
  }
  conditions.push(...place.conditions);

  // --- Free-text query ---
  //
  // `q` is matched against the listing's own text and its street. It is ALSO
  // read as a place name — but ONLY when nothing else said where, and that
  // condition is the fix rather than a tuning knob.
  //
  // With a scope already applied the place expansion is at best redundant and
  // at worst the bug: a viewport over Madrid plus `q=Barcelona` produced
  // `inside Madrid AND (text matches Barcelona OR city = Barcelona)`, whose
  // honest answer is zero, rendered as "this area is empty". A person who has
  // said where by picking a place or moving the map has already answered the
  // question `q` would be re-answering; what they typed is a description of
  // the home, not of the city (ADR 0002 §4.1 — the two dimensions are
  // independent, and only one of them is geographic).
  //
  // It also removes two place lookups per scoped request.
  if (params.text) {
    const scoped = appliedLocationKind(params, place) !== 'none';
    const [textCityId, textRegionId] = scoped
      ? [undefined, undefined]
      : await Promise.all([resolveCityId(params.text), resolveRegionId(params.text)]);
    conditions.push(matchesText(params.text, { cityId: textCityId, regionId: textRegionId }));
  }

  // --- The price bound, applied in the currency this scope is priced in ---
  //
  // Last, and deliberately: the bound narrows to ONE currency (see
  // `db/properties/propertyFilters.ts#priceInRange`), and which one is a fact
  // about the homes in scope rather than about the request. So the census runs
  // over the scope as assembled ABOVE — every other filter, no price — exactly
  // the population the histogram's bars describe. Resolving it any earlier
  // would census the catalogue and answer with some other area's currency.
  //
  // A caller who named a currency is taken at their word and no census runs, so
  // the extra query is paid only by requests that left the unit unsaid. Our own
  // client names one whenever the histogram has told it what the area is priced
  // in.
  let priceCurrency: ListingCurrency | undefined;
  if (price) {
    priceCurrency =
      price.requestedCurrency ??
      dominantCurrency(
        await priceCurrencyCensus({
          where: allOf(conditions),
          priceColumn: price.priceColumn,
          currencyColumn: price.currencyColumn,
        }),
      );

    // No currency at all means every priced listing in scope either records no
    // currency or records one this platform does not list prices in. Either way
    // the question "under 1,200 WHAT" has no answer here, so the bound matches
    // nothing — the same rule `areaInRange` gives an area stored as `0`, and
    // emphatically not the same as dropping the bound and showing the feed
    // unfiltered. The response says `priceCurrency` is absent, so a screen can
    // explain the empty page instead of reading it as "no homes here".
    const condition = priceCurrency
      ? priceInRange(price.priceColumn, price.currencyColumn, price.min, price.max, priceCurrency)
      : sql`false`;
    if (condition) conditions.push(condition);
  }

  return {
    status: 'scoped',
    params,
    location: buildLocationEcho(params, place),
    where: allOf(conditions),
    ...(priceCurrency === undefined ? {} : { priceCurrency }),
  };
}

/**
 * One page of the public search, as the route's whole JSON body.
 *
 * The body is the shared `paginationResponse` shape plus the flat
 * `total`/`page`/`limit`/`totalPages`/`hasMore` aliases and the `location` echo
 * (ADR 0002 §6.3). An unresolvable place answers an EMPTY page with
 * `location.status: 'unresolved'` — never an unfiltered one.
 */
export async function searchListings(query: ListingQuery): Promise<Record<string, unknown>> {
  let scope: SearchScope;
  try {
    scope = await resolveSearchScope(query);
  } catch (error) {
    if (error instanceof GeoParamError) throw new ListingQueryError(error.message, error.code);
    throw error;
  }
  const { params } = scope;

  if (scope.status === 'unresolved') {
    return buildSearchResponse(
      [],
      params.page,
      params.limit,
      0,
      'No properties found for the specified location',
      scope.location,
      params.queryId,
    );
  }

  // ONE `where`, built once, handed to BOTH reads. The count and the page
  // must answer the same question: a count assembled separately drifts from
  // the list it is labelling the moment a predicate is added to one of them.
  const { where } = scope;
  const orderBy = propertyOrderBy(...buildSort(params, params.text));
  const skip = (params.page - 1) * params.limit;

  const [hydrated, total] = await Promise.all([
    findProperties({ where, orderBy, limit: params.limit, offset: skip }),
    countProperties(where),
  ]);

  return buildSearchResponse(
    hydrated.map((listing) => serializeProperty(listing, 'public')),
    params.page,
    params.limit,
    total,
    'Search completed successfully',
    scope.location,
    params.queryId,
    scope.priceCurrency,
  );
}

/** The default radius when `nearby` is called without one. */
const DEFAULT_NEARBY_DISTANCE_METERS = 10_000;

/** What distinguishes the two proximity feeds (`nearby`, `radius`). */
export interface ProximityFeed {
  /** Which query parameter carries the radius. */
  radiusParam: 'maxDistance' | 'radius';
  /** Whether a missing radius is a 400 rather than a default. */
  radiusRequired: boolean;
  successMessage: string;
  missingMessage: string;
  missingError: string;
}

export const NEARBY_FEED: ProximityFeed = {
  radiusParam: 'maxDistance',
  radiusRequired: false,
  successMessage: 'Nearby properties found successfully',
  missingMessage: 'Longitude and latitude are required',
  missingError: 'MISSING_COORDINATES',
};

export const RADIUS_FEED: ProximityFeed = {
  radiusParam: 'radius',
  radiusRequired: true,
  successMessage: 'Properties in radius found successfully',
  missingMessage: 'Longitude, latitude, and radius are required',
  missingError: 'MISSING_PARAMETERS',
};

/**
 * One page of a proximity feed, as the route's whole JSON body.
 *
 * The spatial predicate is `ST_DWithin` against `addresses.geo` in the same
 * statement as the property read; no uncapped list of address ids is
 * materialized in the application, and the `LIMIT` reaches the planner.
 */
export async function findNearbyListings(
  query: ListingQuery,
  feed: ProximityFeed = NEARBY_FEED,
): Promise<Record<string, unknown>> {
  const longitude = getQueryString(query.longitude);
  const latitude = getQueryString(query.latitude);
  const rawRadius = getQueryString(query[feed.radiusParam]);

  if (!longitude || !latitude || (feed.radiusRequired && !rawRadius)) {
    throw new ListingQueryError(feed.missingMessage, feed.missingError);
  }

  const lng = getQueryNumber(longitude, Number.NaN);
  const lat = getQueryNumber(latitude, Number.NaN);
  const radiusMeters = getQueryNumber(rawRadius, DEFAULT_NEARBY_DISTANCE_METERS);

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < MIN_LATITUDE ||
    lat > MAX_LATITUDE ||
    lng < MIN_LONGITUDE ||
    lng > MAX_LONGITUDE
  ) {
    throw new ListingQueryError('Invalid coordinates provided', 'INVALID_COORDINATES');
  }

  const conditions: (SQL | undefined)[] = [
    withinCircle({ longitude: lng, latitude: lat, radiusMeters }),
    ...buildCommonPropertyFilters(query),
  ];
  const where = allOf(conditions);

  const page = getQueryInteger(query.page, 1);
  const limit = getQueryInteger(query.limit, 10);
  const skip = (page - 1) * limit;

  const [hydrated, total] = await Promise.all([
    // Image-bearing listings first (product rule), then newest.
    findProperties({
      where,
      orderBy: propertyOrderBy(NEWEST_FIRST),
      limit,
      offset: skip,
      distanceFrom: { longitude: lng, latitude: lat },
    }),
    countProperties(where),
  ]);

  return paginationResponse(
    hydrated.map((listing) => serializeProperty(listing, 'public')),
    page,
    limit,
    total,
    feed.successMessage,
  );
}

/**
 * Record that a person opened a listing: the counter, and their history when
 * signed in.
 *
 * Best-effort — a failed record must never fail the read that triggered it —
 * but AWAITED, so the recently-viewed history a client re-reads once the
 * listing has arrived already holds this view.
 */
async function recordListingView(
  viewerOxyUserId: string | undefined,
  propertyId: string,
): Promise<void> {
  const writes: Promise<unknown>[] = [
    incrementPropertyViews(propertyId).catch((error: unknown) => {
      logger.warn('Failed to increment property view count', { propertyId, error });
    }),
  ];
  if (viewerOxyUserId) {
    writes.push(
      trackPropertyView(getDb(), viewerOxyUserId, propertyId).catch((error: unknown) => {
        logger.warn('Failed to update recently viewed property', { propertyId, error });
      }),
    );
  }
  await Promise.all(writes);
}

/** One listing, serialized for the viewer, and which audience it was serialized for. */
export interface ListingView {
  readonly listing: ReturnType<typeof serializeProperty>;
  readonly audience: PropertyAudience;
}

/**
 * One listing, as `viewerOxyUserId` may see it.
 *
 * Soft-deleted listings, and ones a community jury has restricted, are
 * invisible to everyone except their owner, who keeps their own view: a
 * listing that silently vanished from its owner's account with no explanation
 * is worse than one they can still see and appeal. The check reads the ROW, not
 * the serialized body.
 *
 * `recordView` is the person OPENING it — the view counter and their
 * recently-viewed history, both best-effort. Only `GET /properties/:id/open`
 * records; the plain read and the tool do not, because a card prefetching a
 * listing or an agent reading one is not the person viewing it.
 */
export async function getListing(
  viewerOxyUserId: string | undefined,
  propertyId: string,
  options: { readonly recordView: boolean },
): Promise<ListingView> {
  // No id-SHAPE guard: a `text` primary key takes any string, so a nonsense id
  // simply matches no row and 404s (`db/MIGRATION-CONTRACT.md`).
  const hydrated = await findPropertyById(propertyId);
  if (!hydrated) throw new AppError('Property not found', 404, 'NOT_FOUND');

  if (hydrated.property.deletedAt || hydrated.property.moderationRestricted) {
    const isOwner = Boolean(viewerOxyUserId) && hydrated.property.oxyUserId === viewerOxyUserId;
    if (!isOwner) throw new AppError('Property not found', 404, 'NOT_FOUND');
  }

  if (options.recordView) await recordListingView(viewerOxyUserId, propertyId);

  // The owner reads their exact floor and unit; everybody else reads the
  // listing's published precision.
  const audience = propertyAudienceFor(hydrated, viewerOxyUserId);
  return { listing: serializeProperty(hydrated, audience), audience };
}

const ALLOWED_REPORT_REASONS: ReadonlySet<string> = new Set(Object.values(ListingReportReason));
const MAX_REPORT_DETAILS_LENGTH = 4000;

/** Narrow a supplied reason to the stored vocabulary (a predicate, not a cast). */
function isListingReportReason(value: string): value is ListingReportReason {
  return ALLOWED_REPORT_REASONS.has(value);
}

export interface ListingReportInput {
  readonly reason: unknown;
  readonly details?: unknown;
  readonly contactEmail?: unknown;
}

/** A report outcome: newly filed (201), or the one already on record (200). */
export type ListingReportOutcome =
  | { readonly status: 'created'; readonly report: unknown }
  | { readonly status: 'existing'; readonly report: unknown };

/**
 * File a community report against a listing.
 *
 * The report is written TWICE, in one transaction, and the two rows answer
 * different questions. `listing_reports` is the local record, with the
 * reporter's optional reply-to address and its own `open` triage state.
 * `moderation_reports` is the durable delivery record the outbox drains.
 * Neither can commit without the other, because a report answered 201 with no
 * delivery event is one nobody will ever review.
 *
 * Re-filing while an earlier report is still open is a no-op that returns the
 * existing one, so nobody can spam the queue. Community reports only — there is
 * no moderator action here, by the owner's veto (`AGENTS.md`).
 */
export async function reportListing(
  reporterOxyUserId: string,
  propertyId: string,
  input: ListingReportInput,
): Promise<ListingReportOutcome> {
  const { reason, details, contactEmail } = input;
  if (typeof reason !== 'string' || !isListingReportReason(reason)) {
    throw new AppError('A valid report reason is required', 400, 'INVALID_REASON');
  }

  const trimmedDetails = typeof details === 'string' ? details.trim() : '';
  if (trimmedDetails.length > MAX_REPORT_DETAILS_LENGTH) {
    throw new AppError('Details are too long', 400, 'DETAILS_TOO_LONG');
  }
  // Free-text context is mandatory when the reason is "other" — otherwise the
  // report carries no actionable information.
  if (reason === ListingReportReason.OTHER && !trimmedDetails) {
    throw new AppError('Details are required when the reason is "other"', 400, 'DETAILS_REQUIRED');
  }

  const property = await findPropertyById(propertyId);
  if (!property) throw new AppError('Property not found', 404, 'NOT_FOUND');

  const existingOpen = await findOpenListingReport(propertyId, reporterOxyUserId);
  if (existingOpen) return { status: 'existing', report: existingOpen };

  // Both rows, or neither: see the function header.
  const fileReport = () =>
    withReportIntakeTransaction(async (tx) => {
      const listingReport = await insertListingReport(tx, {
        propertyId,
        reporterOxyUserId,
        reason,
        details: trimmedDetails || undefined,
        contactEmail:
          typeof contactEmail === 'string' && contactEmail.trim() ? contactEmail.trim() : undefined,
        status: 'open',
      });

      const moderation = await createModerationReport(
        {
          reportedType: ModerationReportedType.PROPERTY,
          reportedId: propertyId,
          reporter: reporterOxyUserId,
          reason,
          details: trimmedDetails || undefined,
        },
        tx,
      );

      return { listingReport, moderation };
    });

  let outcome: Awaited<ReturnType<typeof fileReport>>;
  try {
    outcome = await fileReport();
  } catch (error) {
    /**
     * Two ways to land here, and the reporter is told the same thing by both:
     * the report is on record. `DuplicateListingReportError` — the partial
     * unique index caught a second open report that raced the read above.
     * `DuplicateModerationReportError` — the moderation record already knows
     * this reporter reported this listing (a re-file after an earlier one was
     * resolved); letting it through would open a second case about material a
     * jury has already answered on.
     */
    if (error instanceof DuplicateListingReportError) {
      return { status: 'existing', report: error.existing };
    }
    if (error instanceof DuplicateModerationReportError) {
      return { status: 'existing', report: { id: error.existing.id } };
    }
    throw error;
  }

  logger.info('Listing report created', {
    reportId: outcome.listingReport.id,
    moderationReportId: outcome.moderation.report.id,
    propertyId,
    reporterOxyUserId,
    reason,
    queuedForReview: outcome.moderation.outboxEventId !== undefined,
  });

  return { status: 'created', report: outcome.listingReport };
}
