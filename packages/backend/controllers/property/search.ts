/**
 * Public property search controller
 *
 * Powers the Airbnb-style search/listing UI. Public (no auth) so anonymous
 * visitors can browse. Supports free-text/city queries, a geo bounding box (or
 * center+radius), structured filters, sorting and pagination.
 *
 * ## The address-id round trip is gone — three times over
 *
 * A property has no coordinates of its own, so this endpoint used to resolve
 * matching Address ids FIRST and constrain properties by `addressId: { $in: … }`.
 * It did that in three places: `resolveAddressIds` for the geo/city constraint,
 * `resolveTextAddressIds` for a street match, and `resolveGeoAddressIdsForText`
 * for a place-name match — the last one calling `resolveGeoFilterAddressIds`
 * TWICE per request, each of which loads every address id in a city into memory
 * with no `.limit()`. A search for "Barcelona" therefore materialized Barcelona
 * twice before it looked at a single property.
 *
 * All three are now predicates in the property statement itself, against the
 * `addresses` row the read already joins:
 *
 *  - the box / radius → `ST_Intersects` / `ST_DWithin` on `addresses.geo`
 *    (`db/properties/propertyGeo.ts`);
 *  - an explicit `city`/`state` → `addresses.city_id` / `region_id`, resolved to
 *    ONE canonical id by `geoQueryService` before the query is built;
 *  - the free-text place match → the same two id comparisons, ORed with the
 *    listing's `search_vector` and an `ILIKE` on `addresses.street`.
 *
 * ## `$text` became `websearch_to_tsquery`, which is narrower
 *
 * Mongo's `$text` ORs its terms, so "apartment barcelona" matched every
 * apartment anywhere. `websearch_to_tsquery` ANDs them and understands quoted
 * phrases and an explicit `or`. Stated because it is a deliberate change of what
 * this endpoint returns, not a mechanical translation — see
 * `db/properties/propertyFilters`.
 */

import type { Request, Response, NextFunction } from 'express';
import type { SQL } from 'drizzle-orm';
import type { LocationKind } from '@homiio/shared-types';

import {
  buildSearchPlan,
  buildSort,
  GeoParamError,
  type ParsedSearchParams,
} from './searchQueryBuilder';
import { paginationResponse } from '../../middlewares/errorHandler';
import { logger } from '../../middlewares/logging';
import {
  resolveCityId,
  resolveNeighborhoodId,
  resolveRegionId,
} from '../../services/geoQueryService';
import {
  allOf,
  countProperties,
  findProperties,
  propertyOrderBy,
} from '../../db/properties/propertyReads';
import { withinBoundingBox, withinCircle } from '../../db/properties/propertyGeo';
import {
  inCity,
  inNeighborhood,
  inRegion,
  matchesText,
} from '../../db/properties/propertyFilters';
import { serializeProperty } from '../../db/properties/propertySerializer';

/**
 * The place constraints, resolved.
 *
 * `unresolved` is the "a location was asked for and it does not exist" answer —
 * distinct from "no location constraint", which is an empty condition list. The
 * caller answers the first with an empty page and applies the second.
 */
interface ResolvedPlace {
  conditions: SQL[];
  unresolved: boolean;
  /** Which named parameter failed to resolve, for the response's echo. */
  unresolvedParam?: 'city' | 'state' | 'neighborhood';
  /** The canonical ids the scope was actually narrowed to, for the echo. */
  cityId?: string;
  regionId?: string;
  neighborhoodId?: string;
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
type LocationEcho =
  | {
      status: 'resolved';
      appliedLocationKind: LocationKind;
      cityId?: string;
      regionId?: string;
      neighborhoodId?: string;
      bounds?: { west: number; south: number; east: number; north: number };
      center?: { longitude: number; latitude: number };
      radiusMeters?: number;
    }
  | {
      status: 'unresolved';
      appliedLocationKind: LocationKind;
      requested: { param: 'city' | 'state' | 'neighborhood'; value: string };
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
    place.neighborhoodId !== undefined;

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
    conditions.push(withinCircle({
      longitude: params.centerRadius.lng,
      latitude: params.centerRadius.lat,
      radiusMeters: params.centerRadius.radiusMeters,
    }));
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

  return { conditions, unresolved: false, cityId, regionId, neighborhoodId };
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
    // Absent rather than null when the caller sent none, so "this server does
    // not stamp answers" and "this answer belongs to another query" stay
    // distinguishable — a client that treated them alike would black out its
    // results surface against an older deployment.
    ...(queryId === undefined ? {} : { queryId }),
  };
}

export async function searchProperties(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Parse + validate the request. Geo parsing can reject malformed params
    // with a GeoParamError, which maps to a clean 400 rather than a 500.
    let plan: ReturnType<typeof buildSearchPlan>;
    try {
      plan = buildSearchPlan(req.query as Record<string, string | string[] | undefined>);
    } catch (error) {
      if (error instanceof GeoParamError) {
        res.status(400).json({ success: false, message: error.message, error: error.code });
        return;
      }
      throw error;
    }
    const { conditions, params } = plan;

    const place = await resolvePlaceConditions(params);
    if (place.unresolved) {
      // Still an empty page rather than an unfiltered one — a location that was
      // requested and lost must never widen into a global feed — but now it
      // says so, so the screen can render "we could not find that place".
      res.json(buildSearchResponse(
        [],
        params.page,
        params.limit,
        0,
        'No properties found for the specified location',
        buildLocationEcho(params, place),
        params.queryId,
      ));
      return;
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

    // ONE `where`, built once, handed to BOTH reads. The count and the page
    // must answer the same question: a count assembled separately drifts from
    // the list it is labelling the moment a predicate is added to one of them,
    // and the result — "1,204 homes" over eleven cards — looks like paging
    // rather than like a bug.
    const where = allOf(conditions);
    const orderBy = propertyOrderBy(...buildSort(params, params.text));
    const skip = (params.page - 1) * params.limit;

    const [hydrated, total] = await Promise.all([
      findProperties({ where, orderBy, limit: params.limit, offset: skip }),
      countProperties(where),
    ]);

    res.json(buildSearchResponse(
      hydrated.map(serializeProperty),
      params.page,
      params.limit,
      total,
      'Search completed successfully',
      buildLocationEcho(params, place),
      params.queryId,
    ));
  } catch (error) {
    // The parameter NAMES, never their values. This used to log `req.query`
    // wholesale, which put full-precision `lat`/`lng` — a device fix, on the
    // "near me" path — into the log of every failed search, where it is
    // retained far longer than the request and read by people debugging
    // something else entirely (ADR 0002 §8.2). The names are what a diagnosis
    // actually needs: they say which shape of request broke.
    logger.error('Property search failed', {
      message: error instanceof Error ? error.message : String(error),
      queryParams: Object.keys(req.query).sort(),
    });
    next(error);
  }
}
