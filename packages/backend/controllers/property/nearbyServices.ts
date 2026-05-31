/**
 * Nearby-services controller.
 *
 * Powers the property-detail "what's nearby" section. Given a property it
 * reports, for a fixed set of everyday services (pharmacy, school, supermarket,
 * transit, …), whether each exists NEAR the listing's coordinates — presence,
 * count and the distance to the nearest one — without ever exposing individual
 * place names.
 *
 * Public (no auth) — mirrors the auth posture of `area-insights` and the other
 * nearby/radius/stats routes in `routes/public.ts`.
 *
 * Data source: OpenStreetMap's Overpass API (free, no API key — consistent with
 * the app's Nominatim/MapLibre stack). All the Overpass interaction, caching
 * and graceful-degradation logic lives in `nearbyServicesService`; this
 * controller only resolves the property's coordinates and shapes the response.
 *
 * Never 500s on a content problem: a property with missing/invalid coordinates
 * yields a `partial` all-absent snapshot (the section simply hides), and an
 * Overpass failure is already absorbed by the service. `next(error)` is
 * reserved for genuinely unexpected bugs (e.g. a database fault).
 */

import type { Request, Response, NextFunction } from 'express';
import { Types, type Model } from 'mongoose';
import type { IProperty } from '../../models/Property';
import type { IAddress } from '../../models/Address';
import {
  getNearbyServices,
  emptyNearbyServices,
  RADIUS_M,
} from '../../services/nearbyServicesService';

const models = require('../../models');
const Property: Model<IProperty> = models.Property;
const { AppError, successResponse } = require('../../middlewares/errorHandler');

/**
 * Resolve a property's `[longitude, latitude]` from its populated address.
 *
 * After `.populate('addressId').lean()` the schema's post-find hook renames the
 * populated `addressId` to `address` (see `transformAddressFields`); read
 * `address` first, then fall back to the raw `addressId`. Returns null when no
 * usable numeric coordinate pair is present.
 */
function resolveCoordinates(property: IProperty): [number, number] | null {
  const populated = property as unknown as { address?: IAddress; addressId?: IAddress };
  const address = populated.address ?? populated.addressId ?? null;
  const coords = address?.coordinates?.coordinates;
  if (!Array.isArray(coords) || coords.length !== 2) return null;
  const [longitude, latitude] = coords;
  if (typeof longitude !== 'number' || typeof latitude !== 'number') return null;
  if (Number.isNaN(longitude) || Number.isNaN(latitude)) return null;
  return [longitude, latitude];
}

/**
 * GET /api/properties/:propertyId/nearby-services
 *
 * Returns presence/count/nearest-distance for each everyday-service category
 * around the target property. Always returns every category key (absent ones
 * are `present: false`). Degrades to a `partial` all-absent snapshot when the
 * property has no coordinates or when the upstream POI lookup fails — never a
 * 5xx for those expected cases.
 */
export async function getPropertyNearbyServices(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { propertyId } = req.params;
    if (!Types.ObjectId.isValid(propertyId)) {
      return next(new AppError('Invalid property ID', 400, 'INVALID_ID'));
    }

    const property = await Property.findById(propertyId)
      .populate('addressId')
      .lean<IProperty | null>();
    if (!property) {
      return next(new AppError('Property not found', 404, 'NOT_FOUND'));
    }

    const coordinates = resolveCoordinates(property);
    if (!coordinates) {
      // No usable coordinates — return a graceful degraded snapshot so the
      // frontend can simply hide the section rather than handle an error.
      res.json(
        successResponse(emptyNearbyServices(), 'Nearby services retrieved successfully')
      );
      return;
    }

    const [longitude, latitude] = coordinates;
    const result = await getNearbyServices(longitude, latitude, RADIUS_M);

    res.json(successResponse(result, 'Nearby services retrieved successfully'));
  } catch (error) {
    next(error);
  }
}
