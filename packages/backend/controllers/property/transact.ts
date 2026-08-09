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

import { findPropertyById } from '../../db/properties/propertyReads';
import { serializeProperty } from '../../db/properties/propertySerializer';
import { updateProperty } from '../../db/properties/propertyWrites';
import { AppError, successResponse } from '../../middlewares/errorHandler';
import { logger } from '../../middlewares/logging';
import type { ControllerNext, ControllerRequest, ControllerResponse } from '../controllerTypes';

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
export async function markPropertyTransacted(
  req: ControllerRequest,
  res: ControllerResponse,
  next: ControllerNext,
) {
  try {
    const { propertyId } = req.params;

    const oxyUserId = req.user?.id ?? req.userId;
    if (!oxyUserId) {
      return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
    }

    const existing = await findPropertyById(propertyId);
    if (!existing) {
      return next(new AppError('Property not found', 404, 'PROPERTY_NOT_FOUND'));
    }
    if (!existing.property.oxyUserId || existing.property.oxyUserId !== oxyUserId) {
      return next(new AppError('Access denied - you can only close your own properties', 403, 'FORBIDDEN'));
    }

    // Resolve the requested terminal status, defaulting from the offerings.
    const requested = typeof req.body?.status === 'string' ? req.body.status : undefined;
    if (requested !== undefined && !TERMINAL_STATUSES.includes(requested)) {
      return next(new AppError('status must be a terminal status (rented or sold)', 400, 'INVALID_STATUS'));
    }
    const nextStatus = requested ?? defaultTerminalStatus(existing.property.offerings);

    // Only write when the status actually moves. The endpoint is idempotent by
    // contract — an owner re-marking a closed listing must not touch the row —
    // and the commission trigger below is idempotent independently of this.
    const hydrated =
      existing.property.status === nextStatus
        ? existing
        : ((await updateProperty(propertyId, { status: nextStatus }, { ownedBy: oxyUserId })) ??
          existing);
    const property = serializeProperty(hydrated);

    // Idempotent: creates at most one commission for this property, ever.
    const commission = await onPropertyTransacted({
      ...property,
      _id: hydrated.property.id,
      sourcedByPartner: hydrated.property.sourcedByPartnerId,
    });

    logger.info('Property marked transacted', {
      propertyId: hydrated.property.id,
      status: nextStatus,
      commissionCreated: Boolean(commission),
    });

    return res.json(
      successResponse(
        {
          property,
          commission: commission ? commission.toJSON() : null,
        },
        'Property marked as transacted'
      )
    );
  } catch (error) {
    next(error);
  }
}
