/**
 * Recently-viewed listings — Express adapters over `domain/saved.ts`.
 *
 * The read and the clear are also catalogue tools; recording a view is not,
 * because an agent reading a listing is not the person viewing it
 * (`capabilities/routeCoverage/saved.ts`).
 */

import type { NextFunction, Request, Response } from 'express';

import {
  clearRecentlyViewedHomes,
  listRecentlyViewedHomes,
  recordRecentlyViewedHome,
} from '../../domain/saved';
import { getQueryInteger } from '../queryParams';
import { sendAuthenticationRequired, sendSavedError } from './savedErrors';
import { successResponse } from './shared';

/** Resolve the owner from the session, in the shape the auth layer sets. */
function ownerOf(req: Request): string | undefined {
  return req.user?.id || req.user?._id || undefined;
}

/** Get recently viewed properties for the current user's profile */
export async function getRecentProperties(req: Request, res: Response, next: NextFunction) {
  const oxyUserId = ownerOf(req);
  if (!oxyUserId) return sendAuthenticationRequired(res);
  try {
    // `getQueryInteger` floors at 1 by falling back on a non-positive value;
    // the use case applies the default and the ceiling.
    const limit = req.query.limit === undefined ? undefined : getQueryInteger(req.query.limit, 10);
    const recent = await listRecentlyViewedHomes(oxyUserId, limit);
    res.json(successResponse(recent, 'Recent properties retrieved successfully'));
  } catch (error) {
    sendSavedError(res, next, error);
  }
}

/** Track property view for the current user's profile */
export async function trackPropertyView(req: Request, res: Response, next: NextFunction) {
  const oxyUserId = ownerOf(req);
  if (!oxyUserId) return sendAuthenticationRequired(res);
  try {
    await recordRecentlyViewedHome(oxyUserId, req.params.propertyId);
    res.json(successResponse(null, 'Property view tracked successfully'));
  } catch (error) {
    sendSavedError(res, next, error);
  }
}

/** Clear recently viewed properties for the current user's profile */
export async function clearRecentProperties(req: Request, res: Response, next: NextFunction) {
  const oxyUserId = ownerOf(req);
  if (!oxyUserId) return sendAuthenticationRequired(res);
  try {
    const cleared = await clearRecentlyViewedHomes(oxyUserId);
    res.json(successResponse(cleared, 'Recently viewed properties cleared successfully'));
  } catch (error) {
    sendSavedError(res, next, error);
  }
}
