/**
 * Public property search controller
 *
 * Powers the Airbnb-style search/listing UI. Public (no auth) so anonymous
 * visitors can browse. Supports free-text/city queries, a geo bounding box (or
 * center+radius), structured filters, sorting and pagination.
 *
 * The search itself — the scope, the location echo, the page — is
 * `domain/listings.ts` (`searchListings`), shared with the catalogue's
 * `searchListings` tool. This file adapts it to Express and nothing else.
 */

import type { Request, Response, NextFunction } from 'express';

import { ListingQueryError, type ListingQuery, searchListings } from '../../domain/listings';
import { describeErrorForLog } from '../../middlewares/errorHandler';
import { logger } from '../../middlewares/logging';
import { GeoParamError } from './searchQueryBuilder';

/** Answer a {@link GeoParamError} with a clean 400; `false` when `error` is anything else. */
export function sendGeoParamError(res: Response, error: unknown): boolean {
  if (!(error instanceof GeoParamError) && !(error instanceof ListingQueryError)) return false;
  res.status(400).json({ success: false, message: error.message, error: error.code });
  return true;
}

export async function searchProperties(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await searchListings(req.query as ListingQuery));
  } catch (error) {
    // Geo parsing can reject malformed params, which maps to a clean 400
    // rather than a 500.
    if (sendGeoParamError(res, error)) return;
    // The parameter NAMES, never their values. Logging `req.query` wholesale
    // put full-precision `lat`/`lng` — a device fix, on the "near me" path —
    // into the log of every failed search (ADR 0002 §8.2).
    logger.error('Property search failed', {
      error: describeErrorForLog(error),
      queryParams: Object.keys(req.query).sort(),
    });
    next(error);
  }
}
