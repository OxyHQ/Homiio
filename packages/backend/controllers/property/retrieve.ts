/**
 * Single-listing and own-listings reads.
 *
 * Both read Postgres, and the view counter writes it.
 *
 * **The view counter** is `properties.views`, which started at zero for every
 * listing (`db/schema/unmappedColumns.ts`), so a low count on an old listing is
 * expected rather than a lost increment.
 *
 * ## The recently-viewed write is keyed like its read
 *
 * {@link trackPropertyView} takes the Oxy user id directly, the same key the
 * read uses, so the write and the read always find each other's rows. A listing
 * view does not depend on the viewer having a profile row at all.
 */

import { AppError, successResponse, paginationResponse } from '../../middlewares/errorHandler';
import { logger } from '../../middlewares/logging';
import {
  allOf,
  countProperties,
  findProperties,
  findPropertyById,
  NEWEST_FIRST,
} from '../../db/properties/propertyReads';
import { ownedBy, statusIsNot } from '../../db/properties/propertyFilters';
import { getDb } from '../../db/postgres';
import { trackPropertyView } from '../../db/saved/recentlyViewedRepository';
import { incrementPropertyViews } from '../../db/properties/propertyWrites';
import { propertyAudienceFor, serializeProperty } from '../../db/properties/propertySerializer';
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
    // No id-SHAPE guard: a `text` primary key takes any string, so a nonsense id
    // simply matches no row and 404s (`db/MIGRATION-CONTRACT.md`).
    const hydrated = await findPropertyById(propertyId);
    if (!hydrated) return next(new AppError('Property not found', 404, 'NOT_FOUND'));

    // Soft-deleted listings, and ones a community jury has restricted, are
    // invisible to everyone except their owner. The owner keeps their own view
    // deliberately: a listing that silently vanished from its owner's account
    // with no explanation is worse than one they can still see and appeal.
    //
    // The check reads the ROW, not the serialized body — `moderation` is only
    // put on the wire when a jury really did restrict the listing.
    if (hydrated.property.deletedAt || hydrated.property.moderationRestricted) {
      const oxyUserId = req.user?.id || req.user?._id;
      const isOwner = Boolean(oxyUserId) && hydrated.property.oxyUserId === oxyUserId;
      if (!isOwner) return next(new AppError('Property not found', 404, 'NOT_FOUND'));
    }

    // Best-effort: a failed counter must never fail the read that triggered it.
    void incrementPropertyViews(propertyId).catch((error: unknown) => {
      logger.warn('Failed to increment property view count', { propertyId, error });
    });

    const oxyUserId = req.user?.id ?? req.user?._id;
    if (typeof oxyUserId === 'string' && oxyUserId.length > 0) {
      // Best-effort, like the counter above: a reading history is not worth
      // failing the read it records.
      void trackPropertyView(getDb(), oxyUserId, propertyId).catch((error: unknown) => {
        logger.warn('Failed to update recently viewed property', { propertyId, error });
      });
    }
    // The owner reads their exact floor and unit; everybody else reads the
    // listing's published precision. `req.user` is the session the optional
    // Oxy auth resolved — the same fact the deleted/restricted branch above
    // already decides visibility on — never an id the caller supplied.
    const audience = propertyAudienceFor(
      hydrated,
      typeof oxyUserId === 'string' ? oxyUserId : undefined,
    );
    // One URL now answers two bodies, so the owner's must never be stored by
    // anything in front of the API and replayed to somebody else.
    if (audience === 'owner') res.set('Cache-Control', 'private, no-store');
    res.json(
      successResponse(serializeProperty(hydrated, audience), 'Property retrieved successfully'),
    );
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
    // Deliberately WITHOUT the moderation filter every public feed applies: an
    // owner whose listing a jury restricted must still be able to see it.
    const where = allOf([ownedBy(oxyUserId), statusIsNot('archived')]);
    const skip = (page - 1) * limit;
    const [hydrated, total] = await Promise.all([
      // Newest first, and deliberately WITHOUT the `has_images DESC` key every
      // public feed leads with: this is the owner's own list, where a listing
      // they just created must appear at the top whether or not they have
      // uploaded a photo yet.
      findProperties({ where, orderBy: [NEWEST_FIRST], limit, offset: skip }),
      countProperties(where),
    ]);
    res.json(
      paginationResponse(
        hydrated.map((listing) => serializeProperty(listing, 'owner')),
        page,
        limit,
        total,
        'Your properties retrieved successfully',
      ),
    );
  } catch (error) {
    next(error);
  }
}
