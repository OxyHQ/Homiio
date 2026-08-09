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
import {
  getNearbyServices,
  emptyNearbyServices,
  RADIUS_M,
} from '../../services/nearbyServicesService';

import { AppError, successResponse } from '../../middlewares/errorHandler';
import { findPropertyById } from '../../db/properties/propertyReads';
import { serializeProperty } from '../../db/properties/propertySerializer';

/**
 * Resolve a property's `[longitude, latitude]` from its populated address.
 *
 * The address is nested under `address` on the wire and carries the historical
 * GeoJSON `[lng, lat]` pair, so that is what this reads. The
 * populate-or-raw-`addressId` fallback it replaces existed because Mongoose's
 * post-find hook renamed the populated reference; a join has no such ambiguity.
 * Returns null when no usable numeric coordinate pair is present.
 */
function resolveCoordinates(property: Record<string, unknown>): [number, number] | null {
  const address = property.address as { coordinates?: { coordinates?: unknown } } | undefined;
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
    // No id-SHAPE guard — `Types.ObjectId.isValid` rejects every uuid v7 id
    // minted after the cutover. See `db/ids.ts`.
    const hydrated = await findPropertyById(propertyId);
    if (!hydrated) {
      return next(new AppError('Property not found', 404, 'NOT_FOUND'));
    }

    const coordinates = resolveCoordinates(serializeProperty(hydrated));
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
