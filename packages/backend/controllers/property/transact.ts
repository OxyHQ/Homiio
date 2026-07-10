/**
 * Property close (transaction) handler.
 *
 * Marks a listing as closed — rented, sold or exchanged — and fires the
 * Partner commission trigger. Owner-only: the caller must own the listing
 * (its `profileId` must match the caller's active profile). The underlying
 * {@link onPropertyTransacted} trigger is idempotent, so re-marking a property
 * never creates a second commission.
 */

import { OfferingType, PropertyStatus } from '@homiio/shared-types';
import { onPropertyTransacted } from '../../services/commissionService';

import { Property, Profile } from '../../models';
import { AppError, successResponse } from '../../middlewares/errorHandler';
import { logger } from '../../middlewares/logging';

/** Terminal statuses a listing may be moved into when its deal closes. */
const TERMINAL_STATUSES: ReadonlyArray<string> = [PropertyStatus.RENTED, PropertyStatus.SOLD];

/**
 * Pick the terminal status that matches the listing's offerings when the caller
 * does not pass one explicitly: a sale listing → SOLD, otherwise RENTED.
 */
function defaultTerminalStatus(offerings: unknown): string {
  const list = Array.isArray(offerings) ? offerings : [];
  return list.includes(OfferingType.SALE) ? PropertyStatus.SOLD : PropertyStatus.RENTED;
}

/**
 * POST /api/properties/:propertyId/mark-transacted
 *
 * Body: { status? } — optional terminal status (`rented` | `sold`); inferred
 * from the listing's offerings when omitted. Sets the status and runs the
 * commission trigger. Returns `{ property, commission }` (commission is null
 * when the listing was not sourced by a partner).
 */
export async function markPropertyTransacted(req: any, res: any, next: any) {
  try {
    const { propertyId } = req.params;

    const oxyUserId = req.user?.id || req.user?._id || req.userId;
    if (!oxyUserId) {
      return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
    }

    const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
    if (!activeProfile) {
      return next(new AppError('No active profile found', 404, 'PROFILE_NOT_FOUND'));
    }

    const property = await Property.findById(propertyId);
    if (!property) {
      return next(new AppError('Property not found', 404, 'PROPERTY_NOT_FOUND'));
    }
    if (!property.oxyUserId || property.oxyUserId.toString() !== activeProfile._id.toString()) {
      return next(new AppError('Access denied - you can only close your own properties', 403, 'FORBIDDEN'));
    }

    // Resolve the requested terminal status, defaulting from the offerings.
    const requested = typeof req.body?.status === 'string' ? req.body.status : undefined;
    if (requested !== undefined && !TERMINAL_STATUSES.includes(requested)) {
      return next(new AppError('status must be a terminal status (rented or sold)', 400, 'INVALID_STATUS'));
    }
    const nextStatus = requested ?? defaultTerminalStatus(property.offerings);

    if (property.status !== nextStatus) {
      property.status = nextStatus;
      await property.save();
    }

    // Idempotent: creates at most one commission for this property, ever.
    const commission = await onPropertyTransacted(property);

    logger.info('Property marked transacted', {
      propertyId: String(property._id),
      status: nextStatus,
      commissionCreated: Boolean(commission),
    });

    return res.json(
      successResponse(
        {
          property: property.toJSON(),
          commission: commission ? commission.toJSON() : null,
        },
        'Property marked as transacted'
      )
    );
  } catch (error) {
    next(error);
  }
}
