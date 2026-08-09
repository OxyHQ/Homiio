/**
 * Listing Report Controller
 *
 * Handles trust & safety reports filed against a property listing. A signed-in
 * user flags a problem (inaccurate info, suspected scam, inappropriate content,
 * an already-rented listing, an exposed address, an unsafe home, …).
 *
 * The report is written TWICE, in one transaction, and the two rows answer
 * different questions. `listing_reports` is what it always was — the local
 * record, with the reporter's optional reply-to address and its own `open`
 * triage state. `moderation_reports` is the durable delivery record: it is what
 * the outbox drains, what a case id is written back onto, and what a decision
 * lands on. Neither can commit without the other, because a report answered 201
 * with no delivery event is one nobody will ever review and nothing would ever
 * report that.
 *
 * Distinct from `Review` (public address rating).
 */

import { AppError, successResponse } from '../middlewares/errorHandler';
import { logger } from '../middlewares/logging';
import { ListingReportReason, ModerationReportedType } from '@homiio/shared-types';
import {
  DuplicateListingReportError,
  findOpenListingReport,
  insertListingReport,
} from '../db/moderation/listingReportRepository';
import { DuplicateModerationReportError } from '../db/moderation/moderationReportRepository';
import { findPropertyById } from '../db/properties/propertyReads';
import {
  createModerationReport,
  withReportIntakeTransaction,
} from '../services/moderation/ReportIntakeService';
import { requireSessionOxyUserId } from '../utils/sessionUser';
import type { ControllerNext, ControllerRequest, ControllerResponse } from './controllerTypes';

const ALLOWED_REASONS: ReadonlySet<string> = new Set(Object.values(ListingReportReason));
const MAX_DETAILS_LENGTH = 4000;

/**
 * Narrow a request-supplied reason to the stored vocabulary.
 *
 * A predicate rather than a cast, so the enum stays the single source of truth:
 * `listing_reports.reason` carries a CHECK derived from the same tuple, and a
 * cast here would let a value the database refuses reach the insert and surface
 * as a 500 instead of the 400 below.
 */
function isListingReportReason(value: string): value is ListingReportReason {
  return ALLOWED_REASONS.has(value);
}

/**
 * POST /api/properties/:propertyId/report
 *
 * Body: `{ reason, details?, contactEmail? }`. Re-filing while an earlier report
 * is still open is a no-op (the existing open report is returned) so a user
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

    if (typeof reason !== 'string' || !isListingReportReason(reason)) {
      return next(new AppError('A valid report reason is required', 400, 'INVALID_REASON'));
    }

    const trimmedDetails = typeof details === 'string' ? details.trim() : '';
    if (trimmedDetails.length > MAX_DETAILS_LENGTH) {
      return next(new AppError('Details are too long', 400, 'DETAILS_TOO_LONG'));
    }
    // Free-text context is mandatory when the reason is "other" — otherwise the
    // report carries no actionable information.
    if (reason === ListingReportReason.OTHER && !trimmedDetails) {
      return next(
        new AppError('Details are required when the reason is "other"', 400, 'DETAILS_REQUIRED'),
      );
    }

    const property = await findPropertyById(propertyId);
    if (!property) return next(new AppError('Property not found', 404, 'NOT_FOUND'));

    const existingOpen = await findOpenListingReport(propertyId, oxyUserId);
    if (existingOpen) {
      return res.status(200).json(successResponse(existingOpen, 'Report already submitted'));
    }

    /**
     * Both rows, or neither. `createModerationReport` writes the delivery record
     * and its outbox event with THIS transaction handle, so a crash between the
     * two is not a state the database can be left in — and a reporter who got a
     * 201 can be told truthfully that their report will be reviewed.
     */
    let outcome;
    try {
      outcome = await withReportIntakeTransaction(async (tx) => {
        const listingReport = await insertListingReport(tx, {
          propertyId,
          reporterOxyUserId: oxyUserId,
          reason,
          details: trimmedDetails || undefined,
          contactEmail:
            typeof contactEmail === 'string' && contactEmail.trim()
              ? contactEmail.trim()
              : undefined,
          status: 'open',
        });

        const moderation = await createModerationReport(
          {
            reportedType: ModerationReportedType.PROPERTY,
            reportedId: propertyId,
            reporter: oxyUserId,
            reason,
            details: trimmedDetails || undefined,
          },
          tx,
        );

        return { listingReport, moderation };
      });
    } catch (error) {
      /**
       * Two ways to land here, and the reporter is told the same thing by both,
       * because from where they sit it IS the same thing: the report is on
       * record.
       *
       * `DuplicateListingReportError` — the partial unique index caught a second
       * open report that raced the read above (the read is an ANSWER path, not
       * the check; see `listingReportRepository.ts` on why the invariant lives
       * in the database even though this is the table's only writer).
       * `DuplicateModerationReportError` — the moderation record already knows
       * this reporter reported this listing even though no OPEN listing report
       * remained, i.e. a re-file after an earlier one was resolved. Letting that
       * through would mean a second case about material a jury has already
       * answered on.
       */
      if (error instanceof DuplicateListingReportError) {
        return res.status(200).json(successResponse(error.existing, 'Report already submitted'));
      }
      if (error instanceof DuplicateModerationReportError) {
        return res
          .status(200)
          .json(successResponse({ id: error.existing.id }, 'Report already submitted'));
      }
      throw error;
    }

    logger.info('Listing report created', {
      reportId: outcome.listingReport.id,
      moderationReportId: outcome.moderation.report.id,
      propertyId,
      reporterOxyUserId: oxyUserId,
      reason,
      queuedForReview: outcome.moderation.outboxEventId !== undefined,
    });

    res.status(201).json(successResponse(outcome.listingReport, 'Report submitted'));
  } catch (error) {
    next(error);
  }
}
