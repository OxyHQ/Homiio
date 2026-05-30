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

  // Explicit city/state filters narrow by address location.
  if (params.city) {
    addressConditions.push({ city: new RegExp(escapeRegExp(params.city), 'i') });
  }
  if (params.state) {
    addressConditions.push({ state: new RegExp(escapeRegExp(params.state), 'i') });
  }

  if (addressConditions.length === 0) {
    return null;
  }

  const addressFilter = addressConditions.length === 1 ? addressConditions[0] : { $and: addressConditions };
  const matches = await Address.find(addressFilter).select('_id').lean<AddressIdLean[]>();
  return matches.map((a) => a._id);
}

/**
 * Find Address ids whose human-readable fields match a free-text query. Used
 * as a fallback so a search like "Barcelona" also matches by city/street even
 * when the property title/description text index does not.
 */
async function resolveTextAddressIds(text: string): Promise<Types.ObjectId[]> {
  const regex = new RegExp(escapeRegExp(text), 'i');
  const matches = await Address.find({
    $or: [{ city: regex }, { state: regex }, { street: regex }, { neighborhood: regex }],
  })
    .select('_id')
    .lean<AddressIdLean[]>();
  return matches.map((a) => a._id);
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
        .populate('addressId')
        .sort(sort)
        .skip(skip)
        .limit(params.limit)
        .lean(),
      Property.countDocuments(filter),
    ]);

    res.json(buildSearchResponse(properties, params.page, params.limit, total, 'Search completed successfully'));
  } catch (error) {
    logger.error('Property search failed', {
      message: error instanceof Error ? error.message : String(error),
      query: req.query,
    });
    next(error);
  }
}
