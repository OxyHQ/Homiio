/**
 * Single-listing and own-listings reads, and the record of a listing opened.
 *
 * The single-listing read is `getListing` in `domain/listings.ts`, shared with
 * the catalogue's `getListing` tool. It records nothing: cards prefetch it,
 * screens refresh it and agents read it, and none of those is a person opening
 * the listing.
 *
 * `POST /properties/:propertyId/open` is that person: the detail screen sends
 * it once per visit, and it records the view (the counter in `properties.views`
 * and, when signed in, the viewer's recently-viewed history, keyed by the Oxy
 * user id so the write and the read always find each other's rows). No tool
 * calls it, because an agent reading a listing is not the person viewing it.
 */

import { AppError, successResponse, paginationResponse } from '../../middlewares/errorHandler';
import { getListing, openListing } from '../../domain/listings';
import { listMyProperties } from '../../domain/properties';
import { getErrorName } from '../../utils/errors';
import type { ControllerNext, ControllerRequest, ControllerResponse } from '../controllerTypes';
import { getQueryInteger } from '../queryParams';

/** The session's viewer, from the optional Oxy auth — never an id the caller supplied. */
function viewerOf(req: ControllerRequest): string | undefined {
  const viewer = req.user?.id ?? req.user?._id;
  return typeof viewer === 'string' && viewer.length > 0 ? viewer : undefined;
}

export async function getPropertyById(
  req: ControllerRequest,
  res: ControllerResponse,
  next: ControllerNext,
) {
  try {
    // The use case decides visibility and audience from the viewer.
    const { listing, audience } = await getListing(viewerOf(req), req.params.propertyId);
    // One URL now answers two bodies, so the owner's must never be stored by
    // anything in front of the API and replayed to somebody else.
    if (audience === 'owner') res.set('Cache-Control', 'private, no-store');
    res.json(successResponse(listing, 'Property retrieved successfully'));
  } catch (error) {
    if (getErrorName(error) === 'CastError')
      return next(new AppError('Invalid property ID', 400, 'INVALID_ID'));
    next(error);
  }
}

/** `POST /properties/:propertyId/open` — the person opened this listing. */
export async function openPropertyById(
  req: ControllerRequest,
  res: ControllerResponse,
  next: ControllerNext,
) {
  try {
    await openListing(viewerOf(req), req.params.propertyId);
    res.json(successResponse(null, 'Property view recorded'));
  } catch (error) {
    next(error);
  }
}

export async function getMyProperties(
  req: ControllerRequest,
  res: ControllerResponse,
  next: ControllerNext,
) {
  try {
    const page = getQueryInteger(req.query.page, 1);
    const limit = getQueryInteger(req.query.limit, 10);
    const oxyUserId = req.userId;
    if (!oxyUserId) {
      return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
    }
    // Drafts included, archived excluded, no moderation filter — see
    // `domain/properties.listMyProperties`, shared with the capability tool.
    const result = await listMyProperties(oxyUserId, { page, limit });
    res.json(
      paginationResponse(
        result.items,
        result.page,
        result.limit,
        result.total,
        'Your properties retrieved successfully',
      ),
    );
  } catch (error) {
    next(error);
  }
}
