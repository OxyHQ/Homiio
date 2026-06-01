/**
 * Public property search controller
 *
 * Powers the Airbnb-style search/listing UI. Public (no auth) so anonymous
 * visitors can browse. Supports free-text/city queries, a geo bounding box (or
 * center+radius), structured filters, sorting and pagination.
 *
 * Geo model: coordinates live on the referenced Address (GeoJSON Point with a
 * `2dsphere` index), so geo filtering resolves matching Address ids first and
 * then constrains properties by `addressId`. Each returned property is
 * populated with its address, exposing `address.coordinates.coordinates`
 * ([lng, lat]) so the frontend can place map pins.
 */

import type { Request, Response, NextFunction } from 'express';
import { Types, type Model } from 'mongoose';
import type { IProperty } from '../../models/Property';
import type { IAddress } from '../../models/Address';
import {
  buildSearchPlan,
  buildSort,
  boundingBoxToAddressQuery,
  centerRadiusToAddressQuery,
  escapeRegExp,
  GeoParamError,
  type PropertyFilter,
} from './searchQueryBuilder';

const models = require('../../models');
const Property: Model<IProperty> = models.Property;
const Address: Model<IAddress> = models.Address;
const { paginationResponse } = require('../../middlewares/errorHandler');
const { logger } = require('../../middlewares/logging');
const {
  resolveGeoFilterAddressIds,
  resolveCityId,
  resolveRegionId,
} = require('../../services/geoQueryService');
const {
  serializePropertyAddresses,
  ADDRESS_GEO_POPULATE,
} = require('../../services/propertyAddressSerializer');

/** Address subset selected for id-resolution lookups. */
type AddressIdLean = { _id: Types.ObjectId };

/**
 * Resolve the set of Address ids that satisfy the geo and text/city
 * constraints. Returns:
 *  - `null` when no address-scoped constraint is active (no narrowing needed)
 *  - an array of ObjectIds otherwise (possibly empty => no matches)
 *
 * When several address-scoped constraints are present (e.g. a bounding box AND
 * a city), they are intersected so all conditions hold.
 */
async function resolveAddressIds(
  params: ReturnType<typeof buildSearchPlan>['params']
): Promise<Types.ObjectId[] | null> {
  const addressConditions: Record<string, unknown>[] = [];

  if (params.boundingBox) {
    addressConditions.push(boundingBoxToAddressQuery(params.boundingBox));
  } else if (params.centerRadius) {
    addressConditions.push(centerRadiusToAddressQuery(params.centerRadius));
  }

  // Explicit city/state filters narrow by RELATIONAL geo: resolve the name (or
  // id) to a canonical City/Region id and match the Address ref. An unresolved
  // city/region name means "no matches", so short-circuit to an empty set.
  if (params.city) {
    const cityId = await resolveCityId(params.city);
    if (!cityId) return [];
    addressConditions.push({ cityId });
  }
  if (params.state) {
    const regionId = await resolveRegionId(params.state);
    if (!regionId) return [];
    addressConditions.push({ regionId });
  }

  if (addressConditions.length === 0) {
    return null;
  }

  const addressFilter = addressConditions.length === 1 ? addressConditions[0] : { $and: addressConditions };
  const matches = await Address.find(addressFilter).select('_id').lean<AddressIdLean[]>();
  return matches.map((a) => a._id);
}

/**
 * Find Address ids that match a free-text query. Used as a fallback so a search
 * like "Barcelona" also matches by location even when the property
 * title/description text index does not. Geo is relational, so the location
 * branch resolves the term against the canonical City/Region collections (via
 * `resolveGeoFilterAddressIds`); the building-level `street` is still matched
 * directly on the Address.
 */
async function resolveTextAddressIds(text: string): Promise<Types.ObjectId[]> {
  const [geoIds, streetMatches] = await Promise.all([
    // Treat the term as both a possible city and a possible region name; the
    // resolver returns the union's address ids (null when neither resolves).
    resolveGeoAddressIdsForText(text),
    Address.find({ street: new RegExp(escapeRegExp(text), 'i') })
      .select('_id')
      .lean<AddressIdLean[]>(),
  ]);

  const ids = new Map<string, Types.ObjectId>();
  for (const id of geoIds) ids.set(id.toString(), id);
  for (const a of streetMatches) ids.set(a._id.toString(), a._id);
  return Array.from(ids.values());
}

/**
 * Resolve a free-text term to Address ids by matching it against canonical city
 * AND region names (union). Returns the combined address-id set (empty when the
 * term resolves to no city or region).
 */
async function resolveGeoAddressIdsForText(text: string): Promise<Types.ObjectId[]> {
  const [byCity, byRegion] = await Promise.all([
    resolveGeoFilterAddressIds({ city: text }),
    resolveGeoFilterAddressIds({ state: text }),
  ]);
  const ids = new Map<string, Types.ObjectId>();
  for (const id of byCity ?? []) ids.set(id.toString(), id);
  for (const id of byRegion ?? []) ids.set(id.toString(), id);
  return Array.from(ids.values());
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

/** Merge a resolved address-id set into the property filter under `addressId`. */
function constrainByAddressIds(filter: PropertyFilter, ids: Types.ObjectId[]): void {
  const existing = filter.addressId;
  if (existing && typeof existing === 'object' && '$in' in existing && Array.isArray(existing.$in)) {
    // Intersect with any previously-applied address constraint.
    const previous = new Set(existing.$in.map((id: Types.ObjectId) => id.toString()));
    filter.addressId = { $in: ids.filter((id) => previous.has(id.toString())) };
  } else {
    filter.addressId = { $in: ids };
  }
}

export async function searchProperties(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Parse + validate the request. Geo parsing can reject malformed params
    // with a GeoParamError, which maps to a clean 400 rather than a 500.
    let plan: ReturnType<typeof buildSearchPlan>;
    let addressIds: Types.ObjectId[] | null;
    try {
      plan = buildSearchPlan(req.query as Record<string, string | string[] | undefined>);
      // --- Resolve geo + city/state address constraints ---
      addressIds = await resolveAddressIds(plan.params);
    } catch (error) {
      if (error instanceof GeoParamError) {
        res.status(400).json({ success: false, message: error.message, error: 'INVALID_GEO_PARAMS' });
        return;
      }
      throw error;
    }
    const { filter, params } = plan;

    if (addressIds !== null) {
      if (addressIds.length === 0) {
        // A location constraint was given but matched no addresses.
        res.json(buildSearchResponse([], params.page, params.limit, 0, 'No properties found for the specified location'));
        return;
      }
      constrainByAddressIds(filter, addressIds);
    }

    // --- Free-text query: prefer the title/description text index, fall back
    //     to address (city/street) matches so location words still work. ---
    let useTextScore = false;
    if (params.text) {
      const textIds = await resolveTextAddressIds(params.text);
      const textOr: PropertyFilter[] = [{ $text: { $search: params.text } }];
      if (textIds.length > 0) {
        textOr.push({ addressId: { $in: textIds } });
      }
      // Combine the text OR-branch with the structured filter. When a geo/city
      // address constraint is already present we must keep both: the address
      // text match is restricted to that constraint via the base filter's
      // own addressId clause already merged above.
      if (Array.isArray(filter.$and)) {
        filter.$and.push({ $or: textOr });
      } else {
        filter.$and = [{ $or: textOr }];
      }
      useTextScore = true;
    }

    const sort = buildSort(params, useTextScore);
    const skip = (params.page - 1) * params.limit;

    const projection = useTextScore ? { score: { $meta: 'textScore' } } : undefined;

    const [properties, total] = await Promise.all([
      Property.find(filter, projection)
        .populate(ADDRESS_GEO_POPULATE)
        .sort(sort)
        .skip(skip)
        .limit(params.limit)
        .lean(),
      Property.countDocuments(filter),
    ]);

    // Resolve each address's city/region/country NAMES from the deep-populated
    // geo refs, then flatten the refs back to ids, so result cards/map pins
    // render a location label without an N+1 lookup.
    serializePropertyAddresses(properties);

    res.json(buildSearchResponse(properties, params.page, params.limit, total, 'Search completed successfully'));
  } catch (error) {
    logger.error('Property search failed', {
      message: error instanceof Error ? error.message : String(error),
      query: req.query,
    });
    next(error);
  }
}
