/**
 * The two proximity feeds: `nearby` (a default 10 km radius) and `radius` (an
 * explicit one).
 *
 * ## This file was 464 lines of two near-identical handlers
 *
 * They differed in three things — the parameter name for the radius, whether it
 * was required, and the response message — and shared ~200 lines of copy-pasted
 * filter parsing between them, including two of the four copies of the
 * `excludeIds` bug (`db/ids.ts`). The duplication is gone: one filter parser,
 * one reader, two thin handlers that supply the radius and the message.
 *
 * ## The two-phase query is gone with it
 *
 * Both handlers went through `Property.findNearby` / `Property.findWithinRadius`,
 * Mongoose statics that ran `Address.find({ coordinates: { $near: … } })
 * .select('_id')` — **uncapped** — and then fed every id in the radius back as
 * an `$in`. Here the spatial predicate is `ST_DWithin` against `addresses.geo`
 * in the same statement as the property read; nothing is materialized in the
 * application and the `LIMIT` reaches the planner. See
 * `db/properties/propertyGeo.ts`.
 *
 * Those two statics are now unreferenced. They are left on the Mongoose model
 * with the rest of it, because the model is still the WRITE path and deleting
 * half of it is the write batch's job, not this one's.
 */

import type { SQL } from 'drizzle-orm';

import { paginationResponse } from '../../middlewares/errorHandler';
import type { ControllerNext, ControllerRequest, ControllerResponse } from '../controllerTypes';
import { getQueryInteger, getQueryNumber, getQueryString } from '../queryParams';
import {
  allOf,
  countProperties,
  findProperties,
  propertyOrderBy,
  NEWEST_FIRST,
} from '../../db/properties/propertyReads';
import { withinCircle } from '../../db/properties/propertyGeo';
import { serializeProperty } from '../../db/properties/propertySerializer';
import { buildCommonPropertyFilters } from './commonFilters';
import { MAX_LATITUDE, MAX_LONGITUDE, MIN_LATITUDE, MIN_LONGITUDE } from './searchQueryBuilder';

/** The default radius when `nearby` is called without one. */
const DEFAULT_NEARBY_DISTANCE_METERS = 10_000;

interface ProximityFeed {
  /** Which query parameter carries the radius. */
  radiusParam: 'maxDistance' | 'radius';
  /** Whether a missing radius is a 400 rather than a default. */
  radiusRequired: boolean;
  successMessage: string;
  missingMessage: string;
  missingError: string;
}

/**
 * Read one page of a proximity feed.
 *
 * Shared by both handlers because the ONLY differences between them are in
 * {@link ProximityFeed} — and when they were two functions, a fix to one
 * (twice, historically) did not reach the other.
 */
async function serveProximityFeed(
  req: ControllerRequest,
  res: ControllerResponse,
  next: ControllerNext,
  feed: ProximityFeed,
): Promise<unknown> {
  try {
    const longitude = getQueryString(req.query.longitude);
    const latitude = getQueryString(req.query.latitude);
    const rawRadius = getQueryString(req.query[feed.radiusParam]);

    if (!longitude || !latitude || (feed.radiusRequired && !rawRadius)) {
      return res.status(400).json({
        success: false,
        message: feed.missingMessage,
        error: feed.missingError,
      });
    }

    const lng = getQueryNumber(longitude, Number.NaN);
    const lat = getQueryNumber(latitude, Number.NaN);
    const radiusMeters = getQueryNumber(rawRadius, DEFAULT_NEARBY_DISTANCE_METERS);

    if (
      !Number.isFinite(lat) || !Number.isFinite(lng) ||
      lat < MIN_LATITUDE || lat > MAX_LATITUDE ||
      lng < MIN_LONGITUDE || lng > MAX_LONGITUDE
    ) {
      return res.status(400).json({
        success: false,
        message: 'Invalid coordinates provided',
        error: 'INVALID_COORDINATES',
      });
    }

    const conditions: (SQL | undefined)[] = [
      withinCircle({ longitude: lng, latitude: lat, radiusMeters }),
      ...buildCommonPropertyFilters(req.query),
    ];
    const where = allOf(conditions);

    const page = getQueryInteger(req.query.page, 1);
    const limit = getQueryInteger(req.query.limit, 10);
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

    return res.json(paginationResponse(
      hydrated.map(serializeProperty),
      page,
      limit,
      total,
      feed.successMessage,
    ));
  } catch (error) {
    return next(error);
  }
}

export function findNearbyProperties(req: ControllerRequest, res: ControllerResponse, next: ControllerNext) {
  return serveProximityFeed(req, res, next, {
    radiusParam: 'maxDistance',
    radiusRequired: false,
    successMessage: 'Nearby properties found successfully',
    missingMessage: 'Longitude and latitude are required',
    missingError: 'MISSING_COORDINATES',
  });
}

export function findPropertiesInRadius(req: ControllerRequest, res: ControllerResponse, next: ControllerNext) {
  return serveProximityFeed(req, res, next, {
    radiusParam: 'radius',
    radiusRequired: true,
    successMessage: 'Properties in radius found successfully',
    missingMessage: 'Longitude, latitude, and radius are required',
    missingError: 'MISSING_PARAMETERS',
  });
}
