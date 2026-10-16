/**
 * Single-listing and own-listings reads.
 *
 * The single-listing read is `getListing` in `domain/listings.ts`, shared with
 * the catalogue's `getListing` tool. The route records the view (the counter in
 * `properties.views` and the viewer's recently-viewed history, keyed by the Oxy
 * user id so the write and the read always find each other's rows); the tool
 * does not, because an agent reading a listing is not the person viewing it.
 */

import { AppError, successResponse, paginationResponse } from '../../middlewares/errorHandler';
import { getListing } from '../../domain/listings';
import { listMyProperties } from '../../domain/properties';
import { getErrorName } from '../../utils/errors';
import type { ControllerNext, ControllerRequest, ControllerResponse } from '../controllerTypes';
import { getQueryInteger } from '../queryParams';

export async function getPropertyById(
  req: ControllerRequest,
  res: ControllerResponse,
  next: ControllerNext,
) {
  try {
    const { propertyId } = req.params;
    // `req.user` is the session the optional Oxy auth resolved — never an id
    // the caller supplied. The use case decides visibility and audience from it.
    const viewer = req.user?.id ?? req.user?._id;
    const { listing, audience } = await getListing(
      typeof viewer === 'string' && viewer.length > 0 ? viewer : undefined,
      propertyId,
      { recordView: true },
    );
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
