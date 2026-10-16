/**
 * The two proximity feeds: `nearby` (a default 10 km radius) and `radius` (an
 * explicit one).
 *
 * One reader, two thin handlers that supply the radius and the message: the
 * read is `findNearbyListings` in `domain/listings.ts`, shared with the
 * catalogue's `findNearbyListings` tool.
 */

import {
  findNearbyListings,
  type ListingQuery,
  ListingQueryError,
  NEARBY_FEED,
  type ProximityFeed,
  RADIUS_FEED,
} from '../../domain/listings';
import type { ControllerNext, ControllerRequest, ControllerResponse } from '../controllerTypes';

async function serveProximityFeed(
  req: ControllerRequest,
  res: ControllerResponse,
  next: ControllerNext,
  feed: ProximityFeed,
): Promise<unknown> {
  try {
    return res.json(await findNearbyListings(req.query as ListingQuery, feed));
  } catch (error) {
    if (error instanceof ListingQueryError) {
      return res.status(400).json({ success: false, message: error.message, error: error.code });
    }
    return next(error);
  }
}

export function findNearbyProperties(
  req: ControllerRequest,
  res: ControllerResponse,
  next: ControllerNext,
) {
  return serveProximityFeed(req, res, next, NEARBY_FEED);
}

export function findPropertiesInRadius(
  req: ControllerRequest,
  res: ControllerResponse,
  next: ControllerNext,
) {
  return serveProximityFeed(req, res, next, RADIUS_FEED);
}
