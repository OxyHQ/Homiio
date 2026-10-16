/**
 * Listing Report Controller
 *
 * Handles trust & safety reports filed against a property listing. A signed-in
 * user flags a problem (inaccurate info, suspected scam, inappropriate content,
 * an already-rented listing, an exposed address, an unsafe home, …).
 *
 * The use case — validation, the two rows written in one transaction, the
 * re-file no-op — is `reportListing` in `domain/listings.ts`, shared with the
 * catalogue's `reportListing` tool. Distinct from `Review` (public address
 * rating).
 */

import { reportListing } from '../domain/listings';
import { successResponse } from '../middlewares/errorHandler';
import { requireSessionOxyUserId } from '../utils/sessionUser';
import type { ControllerNext, ControllerRequest, ControllerResponse } from './controllerTypes';

/**
 * POST /api/properties/:propertyId/report
 *
 * Body: `{ reason, details?, contactEmail? }`. Re-filing while an earlier report
 * is still open is a no-op (the existing open report is returned, 200) so a user
 * cannot spam the queue.
 */
export async function createListingReport(
  req: ControllerRequest,
  res: ControllerResponse,
  next: ControllerNext,
) {
  try {
    const { propertyId } = req.params;
    const { reason, details, contactEmail } = req.body || {};
    const oxyUserId = requireSessionOxyUserId(req);

    const outcome = await reportListing(oxyUserId, propertyId, { reason, details, contactEmail });
    if (outcome.status === 'existing') {
      return res.status(200).json(successResponse(outcome.report, 'Report already submitted'));
    }
    res.status(201).json(successResponse(outcome.report, 'Report submitted'));
  } catch (error) {
    next(error);
  }
}
