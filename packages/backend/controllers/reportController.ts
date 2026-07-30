/**
 * Listing Report Controller
 *
 * Handles trust & safety reports filed against a property listing. A signed-in
 * user flags a problem (inaccurate info, suspected scam, inappropriate content,
 * an already-rented listing, an exposed address, an unsafe home, …).
 *
 * The report is written TWICE, in one transaction, and the two rows answer
 * different questions. `ListingReport` is what it always was — the local record,
 * with the reporter's optional reply-to address and its own `open` triage state.
 * `ModerationReport` is the durable delivery record: it is what the outbox
 * drains, what a case id is written back onto, and what a decision lands on.
 * Neither can commit without the other, because a report answered 201 with no
 * delivery event is one nobody will ever review and nothing would ever report
 * that.
 *
 * Distinct from `Review` (public address rating).
 */

import { Property, ListingReport } from '../models';
import { logger } from '../middlewares/logging';
import { AppError, successResponse } from '../middlewares/errorHandler';
import {
  ListingReportReason,
  ListingReportStatus,
  ModerationReportedType,
} from '@homiio/shared-types';
import {
  createModerationReport,
  DuplicateModerationReportError,
  withReportIntakeSession,
} from '../services/moderation/ReportIntakeService';

const ALLOWED_REASONS = new Set(Object.values(ListingReportReason));
const MAX_DETAILS_LENGTH = 4000;

class ReportController {
  /**
   * POST /api/properties/:propertyId/report
   *
   * Body: { reason, details?, contactEmail? }
   * Records the report against the property, attributed to the reporter's
   * active profile. Re-filing while an earlier report is still open is a no-op
   * (the existing open report is returned) so a user can't spam the queue.
   */
  async createListingReport(req: any, res: any, next: any) {
    try {
      const { propertyId } = req.params;
      const { reason, details, contactEmail } = req.body || {};

      const oxyUserId = req.user?.id || req.user?._id || req.userId;
      if (!oxyUserId) {
        return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
      }

      if (!reason || !ALLOWED_REASONS.has(reason)) {
        return next(new AppError('A valid report reason is required', 400, 'INVALID_REASON'));
      }

      const trimmedDetails = typeof details === 'string' ? details.trim() : '';
      if (trimmedDetails.length > MAX_DETAILS_LENGTH) {
        return next(new AppError('Details are too long', 400, 'DETAILS_TOO_LONG'));
      }
      // Free-text context is mandatory when the reason is "other" — otherwise
      // the report carries no actionable information.
      if (reason === ListingReportReason.OTHER && !trimmedDetails) {
        return next(new AppError('Details are required when the reason is "other"', 400, 'DETAILS_REQUIRED'));
      }

      const property = await Property.findById(propertyId).lean();
      if (!property) return next(new AppError('Property not found', 404, 'NOT_FOUND'));

      const existingOpen = await ListingReport.findOne({
        propertyId,
        reporterOxyUserId: oxyUserId,
        status: ListingReportStatus.OPEN
      });
      if (existingOpen) {
        return res.status(200).json(successResponse(existingOpen.toJSON(), 'Report already submitted'));
      }

      /**
       * Both rows, or neither. `createModerationReport` writes the delivery
       * record and its outbox event with THIS session, so a crash between the
       * two is not a state the database can be left in — and a reporter who got
       * a 201 can be told truthfully that their report will be reviewed.
       */
      let outcome;
      try {
        outcome = await withReportIntakeSession(async (session) => {
          const [listingReport] = await ListingReport.create(
            [
              {
                propertyId,
                reporterOxyUserId: oxyUserId,
                reason,
                details: trimmedDetails || undefined,
                contactEmail:
                  typeof contactEmail === 'string' && contactEmail.trim()
                    ? contactEmail.trim()
                    : undefined,
                status: ListingReportStatus.OPEN
              }
            ],
            { session }
          );

          const moderation = await createModerationReport(
            {
              reportedType: ModerationReportedType.PROPERTY,
              reportedId: String(propertyId),
              reporter: oxyUserId,
              reason,
              details: trimmedDetails || undefined
            },
            session
          );

          return { listingReport, moderation };
        });
      } catch (error) {
        /**
         * The moderation record already knows this reporter reported this
         * listing, but no OPEN `ListingReport` did — a re-file after an earlier
         * one was resolved. The reporter is told the same thing either way,
         * because from where they sit it is the same thing: the report is on
         * record. Letting it through would mean a second case about material a
         * jury has already answered on.
         */
        if (error instanceof DuplicateModerationReportError) {
          return res
            .status(200)
            .json(successResponse({ id: String(error.existing._id) }, 'Report already submitted'));
        }
        throw error;
      }

      logger.info('Listing report created', {
        reportId: String(outcome.listingReport._id),
        moderationReportId: outcome.moderation.report.id,
        propertyId: String(propertyId),
        reporterOxyUserId: oxyUserId,
        reason,
        queuedForReview: outcome.moderation.outboxEventId !== undefined
      });

      res.status(201).json(successResponse(outcome.listingReport.toJSON(), 'Report submitted'));
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new ReportController();
