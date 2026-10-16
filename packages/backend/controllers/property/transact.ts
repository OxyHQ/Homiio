/**
 * `POST /api/properties/:propertyId/mark-transacted` — close a deal (rented /
 * sold) and fire the partner commission trigger.
 *
 * Body: `{ status? }` — optional terminal status (`rented` | `sold`), inferred
 * from the listing's offerings when omitted. Returns `{ property, commission }`
 * (commission is null when the listing was not sourced by a partner). Owner
 * only — a non-owner gets 403, as this route always answered. The trigger is
 * idempotent, so re-marking never creates a second commission. The rules live
 * in `domain/properties.ts`, shared with the `markPropertyTransacted` tool.
 */

import { markPropertyTransacted as markTransactedForOwner } from '../../domain/properties';
import { AppError, successResponse } from '../../middlewares/errorHandler';
import type { ControllerNext, ControllerRequest, ControllerResponse } from '../controllerTypes';

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
    const requested = typeof req.body?.status === 'string' ? req.body.status : undefined;
    const result = await markTransactedForOwner(oxyUserId, propertyId, requested);
    return res.json(successResponse(result, 'Property marked as transacted'));
  } catch (error) {
    next(error);
  }
}
