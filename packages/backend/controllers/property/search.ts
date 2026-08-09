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

import {
  buildSearchPlan,
  buildSort,
  GeoParamError,
  type ParsedSearchParams,
} from './searchQueryBuilder';
import { paginationResponse } from '../../middlewares/errorHandler';
import { logger } from '../../middlewares/logging';
import { resolveCityId, resolveRegionId } from '../../services/geoQueryService';
import {
  allOf,
  countProperties,
  findProperties,
  propertyOrderBy,
} from '../../db/properties/propertyReads';
import { withinBoundingBox, withinCircle } from '../../db/properties/propertyGeo';
import { inCity, inRegion, matchesText } from '../../db/properties/propertyFilters';
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

  if (params.city) {
    const cityId = await resolveCityId(params.city);
    if (!cityId) return { conditions: [], unresolved: true };
    conditions.push(inCity(cityId));
  }
  if (params.state) {
    const regionId = await resolveRegionId(params.state);
    if (!regionId) return { conditions: [], unresolved: true };
    conditions.push(inRegion(regionId));
  }

  return { conditions, unresolved: false };
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
  message: string
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
        res.status(400).json({ success: false, message: error.message, error: 'INVALID_GEO_PARAMS' });
        return;
      }
      throw error;
    }
    const { conditions, params } = plan;

    const place = await resolvePlaceConditions(params);
    if (place.unresolved) {
      res.json(buildSearchResponse([], params.page, params.limit, 0, 'No properties found for the specified location'));
      return;
    }
    conditions.push(...place.conditions);

    // --- Free-text query ---
    // Matches the listing's own text OR the place it is in, so a location word
    // still works when the description does not carry it. The two place ids are
    // resolved here rather than expanded into an address-id set.
    if (params.text) {
      const [textCityId, textRegionId] = await Promise.all([
        resolveCityId(params.text),
        resolveRegionId(params.text),
      ]);
      conditions.push(matchesText(params.text, { cityId: textCityId, regionId: textRegionId }));
    }

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
    ));
  } catch (error) {
    logger.error('Property search failed', {
      message: error instanceof Error ? error.message : String(error),
      query: req.query,
    });
    next(error);
  }
}
